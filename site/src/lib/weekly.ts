// Weekly reports (prd.md FR-WK, port of hooks/weekly.py): docs/weekly/YYYY-MM-DD.md checked (front matter, file
// name = date, title, `from` = previous report, published needs commit, the four bullets of every work item),
// `weekly-index`, `weekly-threads` (every work item across the reports, newest first), the card under the title, and
// on report pages `#12`, `!27`, `VR-0004` / `ADR-0011` / `EXP-0001` / `P-0001` become links.
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { slug } from 'github-slugger';
import { DOCS_DIR } from '../config/paths.ts';
import { enabled, type KitConfig } from '../config/load.ts';
import { escapeHtml as esc, splitFrontMatter, type MarkerHandler } from '../markdown/pre.ts';
import { warn } from './warnings.ts';

const STATUS: Record<string, [string, string]> = { draft: ['작성 중', 'running'], published: ['발행', 'done'] };
const BULLETS = ['배경', '한 일', '결과', '다음'];
const FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const NUMFILE = /^(\d{4})-[a-z0-9-]+\.md$/;
const DOCS: Record<string, string> = { VR: 'records', ADR: 'adr', EXP: 'experiments', P: 'publications' };

interface Work {
	name: string;
	anchor: string;
	b: Record<string, string>;
}
interface Report {
	date: string;
	file: string; // weekly/2026-01-12.md
	meta: Record<string, any>;
	prev: string | null;
	next: string | null;
	work: Work[];
}

const str = (v: any) => (v === undefined || v === null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

function workItems(body: string, where: string): Work[] {
	const items: Work[] = [];
	let cur: Work | null = null;
	let inWork = false;
	let bullet: string | null = null;
	for (const line of body.split('\n')) {
		if (line.startsWith('## ')) {
			const h = /^##\s+(?:\d+\.\s*)?(.+?)\s*$/.exec(line);
			inWork = !!h && h[1].includes('업무별 진행');
			cur = null;
			continue;
		}
		if (!inWork) continue;
		if (line.startsWith('### ')) {
			const heading = line.slice(4).trim();
			const name = (/^###\s+(?:[\d.]+\s+)?(.+?)\s*$/.exec(line) ?? [, heading])[1] as string;
			cur = { name, anchor: slug(heading), b: {} };
			items.push(cur);
			bullet = null;
			continue;
		}
		if (!cur) continue;
		const m = /^- \*\*(.+?)\*\*\s*:?\s*(.*)$/.exec(line);
		if (m) {
			bullet = m[1].trim();
			cur.b[bullet] = m[2].trim();
		} else if (bullet && line.startsWith('  ') && line.trim()) cur.b[bullet] += '\n' + line.trimEnd();
		else if (line.startsWith('- ') || (line.trim() && !line.startsWith(' '))) bullet = null;
	}
	for (const w of items) {
		const missing = BULLETS.filter((k) => !(k in w.b));
		if (missing.length) warn('weekly', where, `work item '${w.name}' has no ${missing.map((k) => `**${k}**`).join(', ')}`);
	}
	return items;
}

let cache: { key: string; reports: Map<string, Report>; docFiles: Map<string, string> } | null = null;

function load() {
	const d = path.join(DOCS_DIR, 'weekly');
	const names = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => FILE.test(f)).sort().reverse() : [];
	const key = names.map((n) => `${n}:${fs.statSync(path.join(d, n)).mtimeMs}`).join('|');
	if (cache && cache.key === key) return cache;
	const reports = new Map<string, Report>();
	names.forEach((name, i) => {
		const date = FILE.exec(name)![1];
		const where = `weekly/${name}`;
		const [y, body] = splitFrontMatter(fs.readFileSync(path.join(d, name), 'utf-8').replace(/\r\n/g, '\n'));
		let meta: Record<string, any> = {};
		try {
			meta = (y && (parseYaml(y) as any)) || {};
		} catch {
			/* reported by the page renderer */
		}
		for (const k of ['date', 'from', 'meeting', 'commit']) if (meta[k] !== undefined && meta[k] !== null) meta[k] = str(meta[k]);
		for (const k of ['date', 'from', 'status', 'by']) if (!meta[k]) warn('weekly', where, `front matter '${k}' is missing`);
		if (meta.date && meta.date !== date) warn('weekly', where, `date ${meta.date} does not match the file name`);
		if (meta.status && !(meta.status in STATUS)) warn('weekly', where, `status '${meta.status}' is not one of ${Object.keys(STATUS).join(', ')}`);
		if (meta.status === 'published' && !meta.commit) warn('weekly', where, "published without 'commit' (the snapshot it reports on)");
		const prev = i + 1 < names.length ? names[i + 1].slice(0, -3) : null;
		if (prev && meta.from && meta.from !== prev) warn('weekly', where, `from ${meta.from} is not the previous report's date ${prev}`);
		const t = /^#\s+(\d{4}-\d{2}-\d{2})\s+주간 보고\s*$/m.exec(body);
		if (!t) warn('weekly', where, `first heading must be '# ${date} 주간 보고'`);
		else if (t[1] !== date) warn('weekly', where, `title date ${t[1]} does not match the file name`);
		if (!/^##\s+.*업무별 진행/m.test(body)) warn('weekly', where, "no '## 3. 업무별 진행' section");
		reports.set(date, { date, file: where, meta, prev, next: i > 0 ? names[i - 1].slice(0, -3) : null, work: workItems(body, where) });
	});
	const docFiles = new Map<string, string>();
	for (const [kind, sub] of Object.entries(DOCS)) {
		const p = path.join(DOCS_DIR, sub);
		for (const f of fs.existsSync(p) ? fs.readdirSync(p) : []) {
			const m = NUMFILE.exec(f);
			if (m) docFiles.set(`${kind}-${m[1]}`, `${sub}/${f}`);
		}
	}
	cache = { key, reports, docFiles };
	return cache;
}

const badge = (s?: string) => {
	const [label, cls] = STATUS[s ?? ''] ?? [s ?? '?', 'planned'];
	return `<span class="exp-status exp-status--${cls}">${esc(label)}</span>`;
};
const period = (r: Report) => `${r.meta.from ?? '?'} ~ ${r.meta.date ?? '?'}`;

export function weeklyMarkers(cfg: KitConfig, page: { rel: string }): Record<string, MarkerHandler> {
	if (!enabled(cfg, 'weekly')) return {};
	const { reports, docFiles } = load();
	const base = path.posix.dirname(page.rel);
	const rel = (to: string) => path.posix.relative(base, to) || path.posix.basename(to);
	return {
		'weekly-index': () => {
			if (!reports.size) return '_아직 작성된 주간 보고가 없습니다._';
			const rows = ['| 보고 | 기간 | 상태 | 다룬 업무 |', '| --- | --- | --- | --- |'];
			for (const r of reports.values()) {
				const work = r.work.map((w) => `[${esc(w.name)}](${rel(r.file)}#${w.anchor})`).join(', ');
				rows.push(`| [${r.date}](${rel(r.file)}) | <span class="kit-nowrap">${period(r)}</span> | ${badge(r.meta.status)} | ${work} |`);
			}
			return rows.join('\n');
		},
		'weekly-threads': () => {
			const order: string[] = [];
			const by = new Map<string, [Report, Work][]>();
			for (const r of reports.values())
				for (const w of r.work) {
					if (!by.has(w.name)) {
						order.push(w.name);
						by.set(w.name, []);
					}
					by.get(w.name)!.push([r, w]);
				}
			if (!order.length) return '_아직 작성된 주간 보고가 없습니다._';
			const out = ['업무: ' + order.map((n) => `[${esc(n)}](#${slug(n)})`).join(' · '), ''];
			for (const name of order) {
				out.push(`## ${name}`, '');
				for (const [r, w] of by.get(name)!) {
					out.push(`**[${r.date}](${rel(r.file)}#${w.anchor})** (${period(r)})`, '');
					for (const k of ['한 일', '결과', '막힌 것']) if (w.b[k]) out.push(`- **${k}**: ${w.b[k]}`);
					out.push('');
				}
			}
			return linkRefs(out.join('\n'), cfg, docFiles, base);
		},
	};
}

/** `#12` → issue, `!27` → merge request, `VR-0004` etc. → the document; code, headings and links stay as they are. */
function linkRefs(md: string, cfg: KitConfig, docFiles: Map<string, string>, base: string): string {
	const issues = cfg.site.issues_url ? (cfg.site.issues_url.endsWith('/') ? cfg.site.issues_url : cfg.site.issues_url + '/') : '';
	const mrs = issues ? issues.replace('/issues/', '/merge_requests/') : '';
	const keep = /(```[\s\S]*?```|`[^`\n]*`|!?\[[^\]]*\]\([^)]*\)|<[^>\n]+>|^[ \t]*#+[ \t][^\n]*$)/gm;
	const ref = /(?<![\w&#/![])(?:#(\d{1,5})|!(\d{1,5})|\b(VR|ADR|EXP|P)-(\d{4}))(?![\w-])/g;
	return md
		.split(keep)
		.map((part, i) => {
			if (i % 2 === 1 || part === undefined) return part ?? '';
			return part.replace(ref, (all, iss, mr, kind, num) => {
				if (iss && issues) return `[#${iss}](${issues}${iss})`;
				if (mr && mrs) return `[!${mr}](${mrs}${mr})`;
				if (kind) {
					const f = docFiles.get(`${kind}-${num}`);
					if (f) return `[${kind}-${num}](${path.posix.relative(base, f)})`;
				}
				return all;
			});
		})
		.join('');
}

/** Report pages: links for numbers and the card under the title. Returns the changed source or null. */
export function weeklyPage(cfg: KitConfig, page: { rel: string }, md: string): string | null {
	if (!enabled(cfg, 'weekly')) return null;
	const m = /^weekly\/(\d{4}-\d{2}-\d{2})\.md$/.exec(page.rel);
	if (!m) return null;
	const { reports, docFiles } = load();
	const r = reports.get(m[1]);
	if (!r) return null;
	const by = Array.isArray(r.meta.by) ? r.meta.by.join(', ') : str(r.meta.by);
	const rows: [string, string][] = [
		['기간', period(r)],
		['상태', badge(r.meta.status)],
		['작성', esc(by)],
	];
	if (r.meta.meeting) rows.push(['회의', esc(r.meta.meeting)]);
	if (r.meta.commit) rows.push(['기준 커밋', `<code>${esc(r.meta.commit)}</code>`]);
	const nav: string[] = [];
	if (r.prev) nav.push(`<a href="${r.prev}.html">← ${r.prev}</a>`);
	if (r.next) nav.push(`<a href="${r.next}.html">${r.next} →</a>`);
	nav.push('<a href="threads.html">업무별 흐름</a>');
	rows.push(['다른 보고', nav.join(' · ')]);
	const card = `<dl class="kit-card exp-meta">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
	const linked = linkRefs(md, cfg, docFiles, 'weekly');
	return linked.replace(/^(#\s.+)$/m, (h) => `${h}\n\n${card}\n`);
}
