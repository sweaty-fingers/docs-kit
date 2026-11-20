// Record tabs (prd.md M4): ADR + C4, verification records (VR), experiments (EXP), arc42 sections, publications (P).
// Port of hooks/adr.py, records.py, experiments.py, arc42.py, publications.py: front matter checks (WARNING lines),
// index / log tables (markers), the card under each record's title, links between them (VR / EXP rows on ADR
// cards, VR in the C4 data), and the data of the C4 viewer (adr/viewer/data.json).
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DOCS_DIR } from '../config/paths.ts';
import { enabled, type KitConfig } from '../config/load.ts';
import { escapeHtml as esc, splitFrontMatter, type MarkerHandler } from '../markdown/pre.ts';
import { relUrl } from './links.ts';
import { warn } from './warnings.ts';

// ---------------------------------------------------------------- vocabularies (same as the MkDocs hooks)
export const ADR_STATUS: Record<string, string> = { proposed: '제안', accepted: '승인', rejected: '기각', deprecated: '폐기', superseded: '대체됨' };
const VR_RESULT: Record<string, string> = { pass: '통과', partial: '부분 통과', fail: '실패' };
const EXP_STATUS: Record<string, string> = { planned: '계획', running: '진행 중', done: '끝남', stopped: '중단' };
const ARC_STATUS: Record<string, string> = { empty: '비어 있음', partial: '일부', stable: '안정', 'n/a': '해당 없음' };
const PUB_KIND: Record<string, string> = { overview: '개요', report: '보고서', release: '릴리스 노트', note: '해설', slides: '발표' };
const PUB_STATUS: Record<string, string> = { draft: '작성 중', published: '발행', archived: '보관' };
const C4_KINDS: Record<string, string> = { person: '사람', system: '시스템', container: '컨테이너', component: '컴포넌트' };
const REL_KINDS = ['flow', 'alt', 'call'];
export const ARC_SECTIONS: Record<number, string> = {
	1: '목표와 요구사항', 2: '제약', 3: '컨텍스트와 범위', 4: '해결 전략', 5: '빌딩 블록', 6: '런타임', 7: '배포', 8: '횡단 개념',
	9: '결정', 10: '품질 요구사항', 11: '리스크와 기술 부채', 12: '용어집',
};
const ARC_HOLDS: Record<number, string> = {
	1: '과제 목표, 주요 요구사항, 이해관계자, 품질 목표 3~5개 (연구: 연구 질문·가설, 단계)',
	2: '바꿀 수 없는 기술·조직 조건: 주어진 하드웨어, 플랫폼, 일정, 다른 팀 의존',
	3: '시스템 경계, 외부 사용자·시스템, 외부 인터페이스 (무엇을, 어떤 규격으로)',
	4: '근본 선택의 요약: 구조 원칙, 핵심 기술, 품질 목표를 이루는 방법',
	5: '구성 요소(컨테이너·모듈)와 책임, 저장소 구조',
	6: '중요한 시나리오 2~5개의 실행 흐름',
	7: '실행 환경, 무엇이 어디서 도는가, 배포 경로',
	8: '여러 블록에 걸친 규칙: 데이터, 인터페이스 계약, 안전, 버전 고정·재현',
	9: 'ADR 목록과 읽는 순서',
	10: '품질 시나리오와 수용 기준 (연구: 평가 프로토콜)',
	11: '리스크·기술 부채 목록, 열린 질문',
	12: '모든 용어의 한 줄 뜻과 설명 위치',
};
const NNNN = /^(\d{4})-[a-z0-9-]+\.md$/;
const ARC_FILE = /^a(\d{2})_[a-z0-9_]+\.md$/;

interface Rec {
	num: string; // "0004" (arc42: "3")
	file: string; // adr/0004-x.md
	title: string;
	meta: Record<string, any>;
	body: string;
}
interface C4El {
	id: string;
	name: string;
	kind?: string;
	parent?: string | null;
	technology?: string;
	description?: string;
	external?: boolean;
	_ext?: boolean;
}
interface C4 {
	el: Map<string, C4El>;
	rel: { from: string; to: string; label: string; tech?: string; kind: string }[];
	views: Map<string, any>;
}
export interface Records {
	adrs: Map<string, Rec>;
	vrs: Map<string, Rec & { supersededBy: string[] }>;
	exps: Map<string, Rec>;
	secs: Map<number, Rec>;
	pubs: Map<string, Rec>;
	c4: C4;
	targets: Map<string, string>; // "A3" / "ADR-0004" / "VR-0002" / "EXP-0001" / "MC-0001" / "G2" / "R1" -> docs path
	on: Record<string, boolean>;
	areas: Record<string, string>;
	issuesUrl: string;
}

const list = (v: any): any[] => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]);
const num4 = (v: any) => {
	const s = String(v).toUpperCase().replace(/^(ADR|VR|EXP|P|MC)-/, '');
	return /^\d+$/.test(s) ? s.padStart(4, '0') : s;
};
const str = (v: any) => (v === undefined || v === null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const urlOfRel = (rel: string) => rel.replace(/(^|\/)(README|index)\.md$/i, '$1index.html').replace(/\.md$/, '.html');

function files(sub: string, re: RegExp): string[] {
	const d = path.join(DOCS_DIR, sub);
	return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => re.test(f)).sort() : [];
}

function read(rel: string): { meta: Record<string, any>; body: string } {
	const text = fs.readFileSync(path.join(DOCS_DIR, rel), 'utf-8').replace(/\r\n/g, '\n');
	const [y, body] = splitFrontMatter(text);
	let meta: Record<string, any> = {};
	if (y !== null) {
		try {
			meta = (parseYaml(y) as any) || {};
		} catch {
			/* reported by the page renderer */
		}
	}
	return { meta, body };
}

/** Records of a tab: number from the file name, title from the "# <prefix>-NNNN." heading, checks. */
function loadNumbered(tab: string, dir: string, prefix: string, required: string[], check: (r: Rec, where: string) => void): Map<string, Rec> {
	const out = new Map<string, Rec>();
	const titleRe = new RegExp(`^#\\s+${prefix}-(\\d{4})\\.\\s*(.+)$`, 'm');
	for (const name of files(dir, NNNN)) {
		const rel = `${dir}/${name}`;
		const { meta, body } = read(rel);
		const num = NNNN.exec(name)![1];
		const m = titleRe.exec(body);
		if (!m) warn(tab, rel, `first heading must be '# ${prefix}-${num}. <제목>'`);
		else if (m[1] !== num) warn(tab, rel, `title number ${prefix}-${m[1]} does not match file name`);
		if (out.has(num)) warn(tab, rel, `number ${num} already used by ${out.get(num)!.file}`);
		for (const k of required) if (meta[k] === undefined || meta[k] === null || meta[k] === '') warn(tab, rel, `front matter '${k}' is missing`);
		const r: Rec = { num, file: rel, title: m ? m[2].trim() : name, meta, body };
		check(r, rel);
		out.set(num, r);
	}
	return out;
}

function loadC4(tab: string): C4 {
	const file = 'adr/c4-model.yml';
	const c4: C4 = { el: new Map(), rel: [], views: new Map() };
	const p = path.join(DOCS_DIR, file);
	if (!fs.existsSync(p)) return c4;
	let data: any = {};
	try {
		data = parseYaml(fs.readFileSync(p, 'utf-8')) || {};
	} catch (e: any) {
		warn(tab, file, `not valid YAML: ${String(e.message).split('\n')[0]}`);
		return c4;
	}
	for (const e of data.elements || []) {
		if (c4.el.has(e.id)) warn(tab, file, `element id '${e.id}' is duplicated`);
		if (!(e.kind in C4_KINDS)) warn(tab, file, `element '${e.id}' kind '${e.kind}' is not one of ${Object.keys(C4_KINDS).join(', ')}`);
		c4.el.set(e.id, { ...e, name: str(e.name) });
	}
	for (const e of c4.el.values())
		if (e.parent && !c4.el.has(e.parent)) {
			warn(tab, file, `element '${e.id}' has unknown parent '${e.parent}'`);
			e.parent = null;
		}
	for (const e of c4.el.values()) {
		let x: C4El | undefined = e;
		while (x && !x.external) x = x.parent ? c4.el.get(x.parent) : undefined;
		e._ext = !!x;
	}
	for (const r of data.relations || []) {
		const bad = ['from', 'to'].filter((k) => !c4.el.has(r[k]));
		if (bad.length) {
			warn(tab, file, `relation ${r.from} -> ${r.to} has unknown ${bad.join('/')}`);
			continue;
		}
		let kind = r.kind ?? 'flow';
		if (!REL_KINDS.includes(kind)) {
			warn(tab, file, `relation ${r.from} -> ${r.to} kind '${kind}' is not one of ${REL_KINDS.join(', ')}`);
			kind = 'flow';
		}
		c4.rel.push({ from: r.from, to: r.to, label: str(r.label), tech: r.tech ? str(r.tech) : undefined, kind });
	}
	for (const v of data.views || []) {
		if (v.scope && !c4.el.has(v.scope)) {
			warn(tab, file, `view '${v.id}' has unknown scope '${v.scope}'`);
			continue;
		}
		c4.views.set(v.id, v);
	}
	return c4;
}

function scanTargets(): Map<string, string> {
	const t = new Map<string, string>();
	const add = (sub: string, re: RegExp, key: (m: RegExpExecArray) => string) => {
		for (const f of files(sub, /\.md$/)) {
			const m = re.exec(f);
			if (m) t.set(key(m), `${sub}/${f}`);
		}
	};
	add('arc42', /^a(\d{2})_.*\.md$/, (m) => `A${Number(m[1])}`);
	add('adr', /^(\d{4})-.*\.md$/, (m) => `ADR-${m[1]}`);
	add('records', /^(\d{4})-.*\.md$/, (m) => `VR-${m[1]}`);
	add('experiments', /^(\d{4})-.*\.md$/, (m) => `EXP-${m[1]}`);
	add('models', /^(\d{4})-.*\.md$/, (m) => `MC-${m[1]}`);
	add('guides', /^g(\d+)_.*\.md$/, (m) => `G${Number(m[1])}`);
	add('reference', /^r(\d+)_.*\.md$/, (m) => `R${Number(m[1])}`);
	add('publications', /^(\d{4})-.*\.md$/, (m) => `P-${m[1]}`);
	return t;
}

/** "A1" / "ADR-4" / "VR-0002" / "G2" -> canonical key. */
export function normRef(ref: any): string {
	const m = /^(A|ADR-|VR-|EXP-|MC-|P-|G|R)(\d+)$/.exec(String(ref).trim());
	if (!m) return String(ref);
	return m[1].endsWith('-') ? `${m[1]}${m[2].padStart(4, '0')}` : `${m[1]}${Number(m[2])}`;
}

let cache: { key: string; rec: Records } | null = null;

function dirKey(): string {
	const parts: string[] = [];
	for (const d of ['adr', 'records', 'experiments', 'arc42', 'publications', 'models', 'guides', 'reference']) {
		const p = path.join(DOCS_DIR, d);
		if (!fs.existsSync(p)) continue;
		for (const f of fs.readdirSync(p)) {
			try {
				const s = fs.statSync(path.join(p, f));
				parts.push(`${d}/${f}:${s.mtimeMs}`);
			} catch {
				/* gone */
			}
		}
	}
	return parts.join('|');
}

export function loadRecords(cfg: KitConfig): Records {
	const on = {
		adr: enabled(cfg, 'adr'),
		records: enabled(cfg, 'records'),
		experiments: enabled(cfg, 'experiments'),
		arc42: enabled(cfg, 'arc42'),
		publications: enabled(cfg, 'publications'),
	};
	const key = dirKey() + JSON.stringify([on, cfg.areas, cfg.site.issues_url]);
	if (cache && cache.key === key) return cache.rec;
	const areas = cfg.areas;
	const areaCheck = (tab: string) => (r: Rec, where: string) => {
		if (r.meta.area && !(r.meta.area in areas)) warn(tab, where, `area '${r.meta.area}' is not one of ${Object.keys(areas).join(', ')}`);
	};
	const adrFiles = new Map(files('adr', NNNN).map((f) => [NNNN.exec(f)![1], `adr/${f}`]));
	const adrCheck = (tab: string) => (r: Rec, where: string) => {
		for (const a of list(r.meta.adr)) if (!adrFiles.has(num4(a))) warn(tab, where, `adr '${a}' has no docs/adr/${num4(a)}-*.md`);
	};

	const adrs = on.adr
		? loadNumbered('adr', 'adr', 'ADR', ['status', 'date', 'deciders', 'area', 'summary'], (r, w) => {
				if (r.meta.status && !(r.meta.status in ADR_STATUS)) warn('adr', w, `status '${r.meta.status}' is not one of ${Object.keys(ADR_STATUS).join(', ')}`);
				areaCheck('adr')(r, w);
				if (r.meta.status === 'superseded' && !r.meta.superseded_by) warn('adr', w, "status superseded needs 'superseded_by'");
			})
		: new Map();
	const c4 = on.adr ? loadC4('adr') : { el: new Map(), rel: [], views: new Map() };
	if (on.adr)
		for (const r of adrs.values())
			for (const e of list(r.meta.c4)) if (!c4.el.has(e)) warn('adr', r.file, `c4 element '${e}' is not in adr/c4-model.yml`);

	const vrs = new Map<string, Rec & { supersededBy: string[] }>();
	if (on.records) {
		const loaded = loadNumbered('records', 'records', 'VR', ['result', 'date', 'by', 'area', 'subject'], (r, w) => {
			if (r.meta.result && !(r.meta.result in VR_RESULT)) warn('records', w, `result '${r.meta.result}' is not one of ${Object.keys(VR_RESULT).join(', ')}`);
			areaCheck('records')(r, w);
			adrCheck('records')(r, w);
			for (const f of ['repro.sh', 'expected.txt'])
				if (!fs.existsSync(path.join(DOCS_DIR, 'records', 'assets', `VR-${r.num}`, f)))
					warn('records', w, `reproduction file records/assets/VR-${r.num}/${f} is missing`);
		});
		for (const [n, r] of loaded) vrs.set(n, { ...r, supersededBy: [] });
		for (const v of vrs.values())
			for (const s of list(v.meta.supersedes)) {
				const k = num4(s);
				if (vrs.has(k)) vrs.get(k)!.supersededBy.push(v.num);
				else warn('records', v.file, `supersedes VR-${k}, which does not exist`);
			}
	}
	const exps = on.experiments
		? loadNumbered('experiments', 'experiments', 'EXP', ['status', 'started', 'by', 'area', 'question'], (r, w) => {
				if (r.meta.status && !(r.meta.status in EXP_STATUS)) warn('experiments', w, `status '${r.meta.status}' is not one of ${Object.keys(EXP_STATUS).join(', ')}`);
				areaCheck('experiments')(r, w);
				adrCheck('experiments')(r, w);
			})
		: new Map();

	const secs = new Map<number, Rec>();
	if (on.arc42) {
		const views = loadC4('arc42').views; // view ids for c4_views (warnings of the model itself come from the ADR tab)
		for (const name of files('arc42', ARC_FILE)) {
			const rel = `arc42/${name}`;
			const { meta, body } = read(rel);
			const n = Number(ARC_FILE.exec(name)![1]);
			const m = /^#\s+A(\d{1,2})\.\s*(.+)$/m.exec(body);
			if (!m) warn('arc42', rel, `first heading must be '# A${n}. <제목>'`);
			else if (Number(m[1]) !== n) warn('arc42', rel, `title number A${m[1]} does not match file name`);
			if (!(n in ARC_SECTIONS)) warn('arc42', rel, 'arc42 has sections 1..12 only');
			if (meta.arc42 !== undefined && meta.arc42 !== null && Number(meta.arc42) !== n) warn('arc42', rel, `front matter arc42: ${meta.arc42} does not match file name`);
			if (!(meta.status in ARC_STATUS)) warn('arc42', rel, `status '${meta.status}' is not one of ${Object.keys(ARC_STATUS).join(', ')}`);
			for (const k of ['owner', 'reviewed']) if (!meta[k]) warn('arc42', rel, `front matter '${k}' is missing`);
			for (const v of list(meta.c4_views)) if (!views.has(v)) warn('arc42', rel, `c4 view '${v}' is not in docs/adr/c4-model.yml`);
			if (secs.has(n)) warn('arc42', rel, `section A${n} already in ${secs.get(n)!.file}`);
			secs.set(n, { num: String(n), file: rel, title: m ? m[2].trim() : ARC_SECTIONS[n] ?? name, meta, body });
		}
		if (secs.size)
			for (const n of Object.keys(ARC_SECTIONS).map(Number))
				if (!secs.has(n)) warn('arc42', 'arc42/', `section A${n} (${ARC_SECTIONS[n]}) has no page; add one with status empty or n/a`);
	}
	const targets = scanTargets();
	const pubs = on.publications
		? loadNumbered('publications', 'publications', 'P', ['kind', 'audience', 'date', 'status', 'based_on'], (r, w) => {
				const m = r.meta;
				if (m.kind && !(m.kind in PUB_KIND)) warn('publications', w, `kind '${m.kind}' is not one of ${Object.keys(PUB_KIND).join(', ')}`);
				if (m.status && !(m.status in PUB_STATUS)) warn('publications', w, `status '${m.status}' is not one of ${Object.keys(PUB_STATUS).join(', ')}`);
				if (m.kind && m.kind !== 'overview' && m.status === 'published' && !m.commit) warn('publications', w, `a published ${m.kind} is a snapshot and needs 'commit'`);
				for (const ref of list(m.based_on)) if (!targets.has(normRef(ref))) warn('publications', w, `based_on '${ref}' does not match any document`);
			})
		: new Map();
	const issuesUrl = cfg.site.issues_url ? (cfg.site.issues_url.endsWith('/') ? cfg.site.issues_url : cfg.site.issues_url + '/') : '';
	const rec: Records = { adrs, vrs, exps, secs, pubs, c4, targets, on, areas, issuesUrl };
	cache = { key, rec };
	return rec;
}

// ---------------------------------------------------------------- rendering helpers
const pill = (cls: string, mod: string, label: string) => `<span class="${cls} ${cls}--${esc(mod.replace('/', ''))}">${esc(label)}</span>`;
const adrBadge = (s?: string) => pill('adr-status', s || 'x', ADR_STATUS[s ?? ''] ?? s ?? '?');
const vrBadge = (s?: string) => pill('vr-result', s || 'x', VR_RESULT[s ?? ''] ?? s ?? '?');
const expBadge = (s?: string) => pill('exp-status', s || 'x', EXP_STATUS[s ?? ''] ?? s ?? '?');
const arcBadge = (s?: string) => pill('arc-status', s || 'x', ARC_STATUS[s ?? ''] ?? s ?? '?');
const kindBadge = (s?: string) => pill('pub-kind', s || 'x', PUB_KIND[s ?? ''] ?? s ?? '?');
const card = (cls: string, rows: [string, string][]) =>
	`<dl class="kit-card ${cls}">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
const area = (R: Records, a: any) => esc(R.areas[a] ?? str(a));
const people = (v: any) => esc(Array.isArray(v) ? v.join(', ') : str(v));

/** ids and dates in tables stay on one line */
const nw = (html: string) => `<span class="kit-nowrap">${html}</span>`;
const day = (v: any) => nw(str(v));

function link(from: string, toRel: string, text: string): string {
	return `<a href="${relUrl(from, urlOfRel(toRel)) || '#'}">${esc(text)}</a>`;
}
function adrRef(R: Records, from: string, v: any): string {
	const n = num4(v);
	const r = R.adrs.get(n);
	return nw(r ? link(from, r.file, `ADR-${n}`) : `ADR-${n}`);
}
function vrRef(R: Records, from: string, n: string): string {
	const r = R.vrs.get(n);
	return nw(r ? link(from, r.file, `VR-${n}`) : `VR-${n}`);
}
function viewer(from: string): string {
	return relUrl(from, 'adr/viewer/index.html');
}
function elLink(R: Records, from: string, id: string): string {
	const e = R.c4.el.get(id);
	return `<a href="${viewer(from)}#el=${encodeURIComponent(id)}" target="_blank">${esc(e ? e.name : id)}</a>`;
}
function issues(R: Records, v: any): string {
	return list(v)
		.map((i) => (R.issuesUrl ? `<a href="${esc(R.issuesUrl)}${esc(str(i))}" target="_blank" rel="noopener">#${esc(str(i))}</a>` : `#${esc(str(i))}`))
		.join(', ');
}
function counts(items: Iterable<Rec>, key: string, labels: Record<string, string>): string {
	const c = new Map<string, number>();
	for (const r of items) c.set(str(r.meta[key]), (c.get(str(r.meta[key])) ?? 0) + 1);
	return [...c].map(([k, n]) => `${labels[k] ?? k} ${n}`).join(' · ');
}
const md = (s: any) => str(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

// ---------------------------------------------------------------- markers
export function recordMarkers(cfg: KitConfig, page: { url: string }): Record<string, MarkerHandler> {
	const R = loadRecords(cfg);
	const from = page.url;
	const h: Record<string, MarkerHandler> = {};
	if (R.on.adr) {
		h['adr-index'] = () => {
			if (!R.adrs.size) return '_아직 작성된 ADR이 없습니다._';
			const rows = ['| 번호 | 제목 | 상태 | 분야 | 날짜 |', '| --- | --- | --- | --- | --- |'];
			for (const r of [...R.adrs.values()].sort((a, b) => a.num.localeCompare(b.num))) {
				let st = adrBadge(r.meta.status);
				if (r.meta.superseded_by) st += ` → ${adrRef(R, from, r.meta.superseded_by)}`;
				rows.push(`| ${nw(link(from, r.file, `ADR-${r.num}`))} | ${md(r.title)} | ${st} | ${area(R, r.meta.area)} | ${day(r.meta.date)} |`);
			}
			return rows.join('\n') + `\n\n총 ${R.adrs.size}건: ${counts(R.adrs.values(), 'status', ADR_STATUS)}`;
		};
		h['adr-log'] = () => {
			if (!R.adrs.size) return '_아직 작성된 ADR이 없습니다._';
			const rows = ['| # | 날짜 | 결정 | 상태 | 아키텍처 요소 |', '| --- | --- | --- | --- | --- |'];
			const sorted = [...R.adrs.values()].sort((a, b) => (str(a.meta.date) + a.num).localeCompare(str(b.meta.date) + b.num));
			for (const r of sorted) {
				let st = adrBadge(r.meta.status);
				if (r.meta.superseded_by) st += ` → ${adrRef(R, from, r.meta.superseded_by)}`;
				const els = list(r.meta.c4).map((e) => elLink(R, from, e)).join(', ');
				rows.push(`| ${link(from, r.file, r.num)} | ${day(r.meta.date)} | ${md(r.meta.summary || r.title)} | ${st} | ${els} |`);
			}
			return rows.join('\n');
		};
		h['c4-app'] = () => {
			const v = viewer(from);
			return (
				`<div class="c4-launch"><a class="kit-button" href="${v}" target="_blank">아키텍처 뷰어 열기 (전체 화면)</a> ` +
				`<span>새 창에서 넓게 봅니다. 아래는 같은 뷰어의 미리보기입니다.</span></div>\n\n` +
				`<iframe class="c4-embed" src="${v}?embed=1" title="C4 아키텍처 뷰어" loading="lazy"></iframe>`
			);
		};
		h['c4-elements'] = () => {
			const byEl = adrsByElement(R);
			const rows: string[] = [];
			const add = (id: string, depth: number) => {
				const e = R.c4.el.get(id)!;
				const kind = (e._ext ? '외부 ' : '') + (C4_KINDS[e.kind ?? ''] ?? '');
				rows.push(
					`<tr id="c4-${esc(id)}"><td>${'　'.repeat(depth)}${esc(e.name)}</td><td>${kind}</td><td>${esc(str(e.technology))}</td>` +
						`<td>${esc(str(e.description))}</td><td>${(byEl.get(id) ?? []).map((n) => adrRef(R, from, n)).join(', ')}</td></tr>`,
				);
				for (const c of R.c4.el.values()) if (c.parent === id) add(c.id, depth + 1);
			};
			for (const e of R.c4.el.values()) if (!e.parent) add(e.id, 0);
			return `<table>\n<thead><tr><th>요소</th><th>종류</th><th>기술</th><th>설명</th><th>관련 ADR</th></tr></thead>\n<tbody>\n${rows.join('\n')}\n</tbody>\n</table>`;
		};
		h['c4-view'] = (args, opts) => {
			const vid = args.split(/\s+/)[0];
			const view = R.c4.views.get(vid);
			if (!view) {
				warn('adr', null, `c4-view '${vid}' is not a view in adr/c4-model.yml (page ${page.url})`);
				return null;
			}
			const title = esc(str(view.title || vid));
			const height = Number(opts.height || 520);
			const v = viewer(from);
			return (
				`<div class="c4-inline"><div class="c4-inline__bar"><span>C4 · ${title}</span><a href="${v}#view=${encodeURIComponent(vid)}" target="_blank">전체 화면</a></div>` +
				`<iframe class="c4-embed" style="height:${height}px" src="${v}?embed=1#view=${encodeURIComponent(vid)}" title="C4: ${title}" loading="lazy"></iframe></div>`
			);
		};
	}
	if (R.on.records)
		h['vr-index'] = () => {
			if (!R.vrs.size) return '_아직 작성된 검증 기록이 없습니다._';
			const rows = ['| VR | 결과 | 날짜 | 분야 | 확인한 것 | 근거가 되는 ADR | 절차 |', '| --- | --- | --- | --- | --- | --- | --- |'];
			for (const r of [...R.vrs.values()].sort((a, b) => a.num.localeCompare(b.num))) {
				let res = vrBadge(r.meta.result);
				if (r.supersededBy.length) res += ' → ' + r.supersededBy.map((n) => vrRef(R, from, n)).join(', ');
				rows.push(
					`| ${nw(link(from, r.file, `VR-${r.num}`))} | ${res} | ${day(r.meta.date)} | ${area(R, r.meta.area)} | ${md(r.meta.subject || r.title)} ` +
						`| ${list(r.meta.adr).map((a) => adrRef(R, from, a)).join(', ')} | ${md(r.meta.guide)} |`,
				);
			}
			return rows.join('\n') + `\n\n총 ${R.vrs.size}건: ${counts(R.vrs.values(), 'result', VR_RESULT)}`;
		};
	if (R.on.experiments)
		h['exp-index'] = () => {
			if (!R.exps.size) return '_아직 작성된 실험 기록이 없습니다._';
			const rows = ['| EXP | 상태 | 시작 | 분야 | 질문 | 실험 기록 제목 | 관련 ADR | 이슈 |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
			for (const r of [...R.exps.values()].sort((a, b) => a.num.localeCompare(b.num)))
				rows.push(
					`| ${nw(link(from, r.file, `EXP-${r.num}`))} | ${expBadge(r.meta.status)} | ${day(r.meta.started)} | ${area(R, r.meta.area)} | ${md(r.meta.question)} ` +
						`| ${md(r.title)} | ${list(r.meta.adr).map((a) => adrRef(R, from, a)).join(', ')} | ${issues(R, r.meta.issues)} |`,
				);
			return rows.join('\n') + `\n\n총 ${R.exps.size}건: ${counts(R.exps.values(), 'status', EXP_STATUS)}`;
		};
	if (R.on.arc42)
		h['arc42-index'] = () => {
			if (!R.secs.size) return '_아직 섹션 페이지가 없습니다._';
			const rows = ['| 섹션 | 제목 | 담는 것 | 지금 들어 있는 것 | 상태 | 담당 | 검토일 | C4 뷰 |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
			for (const n of Object.keys(ARC_SECTIONS).map(Number)) {
				const s = R.secs.get(n);
				if (!s) {
					rows.push(`| A${n} | ${ARC_SECTIONS[n]} | ${ARC_HOLDS[n]} | (페이지 없음) | | | | |`);
					continue;
				}
				const m = s.meta;
				rows.push(
					`| ${link(from, s.file, `A${n}`)} | ${md(s.title)} | ${ARC_HOLDS[n]} | ${md(m.summary)} | ${arcBadge(m.status)} | ${md(m.owner)} | ${str(m.reviewed)} ` +
						`| ${list(m.c4_views).map((v) => `\`${v}\``).join(', ')} |`,
				);
			}
			return rows.join('\n') + '\n\n' + counts(R.secs.values(), 'status', ARC_STATUS);
		};
	if (R.on.publications)
		h['pub-index'] = () => {
			if (!R.pubs.size) return '_아직 발행물이 없습니다._';
			const rows = ['| 번호 | 제목 | 종류 | 독자 | 날짜 | 상태 |', '| --- | --- | --- | --- | --- | --- |'];
			for (const r of [...R.pubs.values()].sort((a, b) => a.num.localeCompare(b.num)))
				rows.push(
					`| ${nw(link(from, r.file, `P-${r.num}`))} | ${md(r.title)} | ${kindBadge(r.meta.kind)} | ${md(r.meta.audience)} | ${day(r.meta.date)} | ${PUB_STATUS[r.meta.status] ?? str(r.meta.status)} |`,
				);
			return rows.join('\n');
		};
	return h;
}

// ---------------------------------------------------------------- the card under a record's title
export function recordCard(cfg: KitConfig, page: { rel: string; url: string }): string | null {
	const R = loadRecords(cfg);
	const from = page.url;
	const name = path.posix.basename(page.rel);
	const dir = page.rel.split('/')[0];
	const n4 = NNNN.exec(name)?.[1];
	if (dir === 'adr' && R.on.adr && n4 && R.adrs.has(n4)) {
		const m = R.adrs.get(n4)!.meta;
		const rows: [string, string][] = [
			['상태', adrBadge(m.status)],
			['날짜', str(m.date)],
			['결정자', people(m.deciders)],
			['분야', area(R, m.area)],
		];
		if (m.c4) rows.push(['아키텍처 요소', list(m.c4).map((e) => elLink(R, from, e)).join(', ')]);
		if (m.supersedes) rows.push(['대체한 결정', list(m.supersedes).map((v) => adrRef(R, from, v)).join(', ')]);
		if (m.superseded_by) rows.push(['대체한 새 결정', adrRef(R, from, m.superseded_by)]);
		if (m.related) rows.push(['관련 ADR', list(m.related).map((v) => adrRef(R, from, v)).join(', ')]);
		const vr = [...R.vrs.values()].filter((v) => list(v.meta.adr).map(num4).includes(n4));
		if (vr.length) rows.push(['검증 기록', vr.map((v) => `${vrRef(R, from, v.num)} ${vrBadge(v.meta.result)}`).join(', ')]);
		const ex = [...R.exps.values()].filter((e) => list(e.meta.adr).map(num4).includes(n4));
		if (ex.length) rows.push(['실험', ex.map((e) => `${link(from, e.file, `EXP-${e.num}`)} ${expBadge(e.meta.status)}`).join(', ')]);
		return card('adr-meta', rows);
	}
	if (dir === 'records' && R.on.records && n4 && R.vrs.has(n4)) {
		const v = R.vrs.get(n4)!;
		const m = v.meta;
		const rows: [string, string][] = [
			['결과', vrBadge(m.result)],
			['날짜', str(m.date)],
			['실행', people(m.by)],
			['분야', area(R, m.area)],
		];
		for (const [k, label] of [['host', '장비'], ['commit', '저장소'], ['guide', '절차']] as const) if (m[k]) rows.push([label, esc(str(m[k]))]);
		if (m.adr) rows.push(['근거가 되는 ADR', list(m.adr).map((a) => adrRef(R, from, a)).join(', ')]);
		if (m.c4) rows.push(['아키텍처 요소', list(m.c4).map((e) => `<a href="${viewer(from)}#el=${encodeURIComponent(e)}" target="_blank">${esc(str(e))}</a>`).join(', ')]);
		rows.push(['재현', `<a href="assets/VR-${n4}/repro.sh">repro.sh</a>, <a href="assets/VR-${n4}/expected.txt">expected.txt</a>`]);
		if (m.supersedes) rows.push(['대신하는 기록', list(m.supersedes).map((s) => vrRef(R, from, num4(s))).join(', ')]);
		if (v.supersededBy.length) rows.push(['이 기록을 대신하는 새 기록', v.supersededBy.map((x) => vrRef(R, from, x)).join(', ')]);
		return card(`vr-meta${v.supersededBy.length ? ' vr-meta--superseded' : ''}`, rows);
	}
	if (dir === 'experiments' && R.on.experiments && n4 && R.exps.has(n4)) {
		const m = R.exps.get(n4)!.meta;
		const rows: [string, string][] = [
			['상태', expBadge(m.status)],
			['시작', str(m.started)],
			['실행', people(m.by)],
			['분야', area(R, m.area)],
			['질문', esc(str(m.question))],
		];
		if (m.adr) rows.push(['관련 ADR', list(m.adr).map((a) => adrRef(R, from, a)).join(', ')]);
		if (m.issues) rows.push(['이슈', issues(R, m.issues)]);
		return card('exp-meta', rows);
	}
	const an = ARC_FILE.exec(name);
	if (dir === 'arc42' && R.on.arc42 && an && R.secs.has(Number(an[1]))) {
		const n = Number(an[1]);
		const m = R.secs.get(n)!.meta;
		const rows: [string, string][] = [
			['arc42', `A${n} · ${ARC_SECTIONS[n] ?? ''}`],
			['담는 것', esc(ARC_HOLDS[n] ?? '')],
			['상태', arcBadge(m.status)],
			['담당', esc(str(m.owner))],
			['검토일', str(m.reviewed)],
		];
		if (m.c4_views) rows.push(['C4 뷰', list(m.c4_views).map((v) => `<code>${esc(str(v))}</code>`).join(', ')]);
		return card('arc-meta', rows);
	}
	if (dir === 'publications' && R.on.publications && n4 && R.pubs.has(n4)) {
		const m = R.pubs.get(n4)!.meta;
		const rows: [string, string][] = [
			['종류', kindBadge(m.kind)],
			['독자', esc(str(m.audience))],
			['날짜', str(m.date)],
			['상태', PUB_STATUS[m.status] ?? esc(str(m.status))],
		];
		if (m.commit) rows.push(['기준 커밋', `<code>${esc(str(m.commit))}</code>`]);
		if (m.based_on)
			rows.push([
				'엮은 정본',
				list(m.based_on)
					.map((ref) => {
						const t = R.targets.get(normRef(ref));
						return t ? link(from, t, normRef(ref)) : esc(str(ref));
					})
					.join(', '),
			]);
		let out = card('pub-meta', rows);
		if (m.kind && m.kind !== 'overview')
			out +=
				`\n\n<div class="admonition note"><p class="admonition-title">스냅숏</p><p>이 문서는 ${esc(str(m.date))} 기준으로 고정된 글입니다. ` +
				'현재 상태는 위 "엮은 정본"의 문서를 봅니다.</p></div>';
		return out;
	}
	return null;
}

/** Pages whose rendering depends on other record files (cards, indexes): rendered on every build. */
export function isRecordPage(rel: string): boolean {
	return /^(adr|records|experiments|arc42|publications|weekly)\//.test(rel);
}

// ---------------------------------------------------------------- C4 viewer data (adr/viewer/data.json)
function adrsByElement(R: Records): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const r of [...R.adrs.values()].sort((a, b) => a.num.localeCompare(b.num)))
		for (const e of list(r.meta.c4)) if (R.c4.el.has(e)) out.set(e, [...(out.get(e) ?? []), r.num]);
	return out;
}

function viewGraph(R: Records, v: any) {
	const el = R.c4.el;
	const scope: string | null = v.scope ?? null;
	const children = new Set([...el.values()].filter((e) => (e.parent || null) === scope).map((e) => e.id));
	const inside = v.include ? new Set([...children].filter((c) => list(v.include).includes(c))) : new Set(children);
	const siblings = new Set([...children].filter((c) => !inside.has(c)));
	const show = (i0: string): string | null => {
		let x: string | null | undefined = i0;
		while (x != null && !children.has(x)) x = el.get(x)?.parent ?? null;
		if (x != null) return x;
		if (scope === null || i0 === scope) return null;
		if (v.outside === 'elements') return i0;
		let i = i0;
		while (el.get(i)?.parent) i = el.get(i)!.parent!;
		return i === scope ? null : i;
	};
	const edges = new Map<string, { a: string; b: string; labels: string[]; kinds: Set<string> }>();
	for (const r of R.c4.rel) {
		const a = show(r.from);
		const b = show(r.to);
		if (!a || !b || a === b) continue;
		if (scope && !inside.has(a) && !inside.has(b)) continue;
		const label = r.label + (r.tech ? ` [${r.tech}]` : '');
		const k = `${a}\u0000${b}`;
		const e = edges.get(k) ?? { a, b, labels: [], kinds: new Set<string>() };
		if (!e.labels.includes(label)) e.labels.push(label);
		e.kinds.add(r.kind);
		edges.set(k, e);
	}
	const shown = new Set([...inside, ...[...edges.values()].flatMap((e) => [e.a, e.b])]);
	const order = [...el.keys()];
	const nodes = [...shown]
		.sort((x, y) => order.indexOf(x) - order.indexOf(y))
		.map((i) => {
			const role = inside.has(i) ? 'inside' : siblings.has(i) ? 'placeholder' : 'outside';
			return { id: i, role, box: role !== 'outside' && scope ? scope : null };
		});
	return {
		id: v.id,
		title: str(v.title || v.id),
		description: str(v.description),
		scope,
		direction: v.direction || 'RIGHT',
		nodes,
		edges: [...edges.values()].map((e) => ({ from: e.a, to: e.b, labels: e.labels, kind: e.kinds.size === 1 ? [...e.kinds][0] : 'flow' })),
	};
}

function plain(s: string): string {
	return s
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/`|\*\*/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** First paragraph or first two bullets of an ADR section (optionally after a bold sub-heading), plain text. */
function excerpt(body: string, heading: string, after?: string, limit = 240): string {
	const m = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm').exec(body);
	if (!m) return '';
	let text = m[1].trim();
	if (after) {
		const i = text.indexOf(`**${after}**`);
		text = i >= 0 ? text.slice(i + after.length + 4).trim() : '';
	}
	let out: string;
	if (/^(?:[-*]|\d+\.)\s/.test(text)) {
		const bullets = [...text.matchAll(/^\s*(?:[-*]|\d+\.)\s+(?:\[[ x]\]\s+)?(.+)$/gm)].map((b) => b[1]);
		out = bullets.slice(0, 2).map(plain).join(' ');
	} else out = plain(text.split('\n\n')[0]);
	return out.length <= limit ? out : out.slice(0, limit - 1).trimEnd() + '…';
}

export function c4Data(cfg: KitConfig): Record<string, any> {
	const R = loadRecords(cfg);
	const byEl = adrsByElement(R);
	const views = [...R.c4.views.values()].map((v) => viewGraph(R, v));
	const drill = new Map<string, string[]>();
	for (const v of views) if (v.scope) drill.set(v.scope, [...(drill.get(v.scope) ?? []), v.id]);
	const elements: Record<string, any> = {};
	for (const [i, e] of R.c4.el)
		elements[i] = {
			name: e.name, kind: e.kind, kindLabel: C4_KINDS[e.kind ?? ''] ?? '', external: !!e._ext, parent: e.parent ?? null,
			technology: str(e.technology), description: str(e.description), adrs: byEl.get(i) ?? [], views: drill.get(i) ?? [],
		};
	const adrs: Record<string, any> = {};
	for (const r of [...R.adrs.values()].sort((a, b) => a.num.localeCompare(b.num))) {
		const m = r.meta;
		adrs[r.num] = {
			title: plain(r.title), summary: m.summary ? str(m.summary) : plain(r.title), status: m.status, statusLabel: ADR_STATUS[m.status] ?? m.status,
			area: R.areas[m.area] ?? str(m.area), url: '../' + path.posix.basename(r.file).replace(/\.md$/, '.html'), date: str(m.date),
			context: excerpt(r.body, '배경'), decision: excerpt(r.body, '결정'), tradeoff: excerpt(r.body, '결과', '감수할 점'),
		};
	}
	const data: Record<string, any> = {
		views,
		elements,
		adrs,
		relations: R.c4.rel.map((r) => ({ from: r.from, to: r.to, label: r.label, tech: r.tech ?? '', kind: r.kind })),
		site: cfg.site.name,
	};
	if (R.on.records && R.vrs.size) {
		data.records = {};
		for (const v of [...R.vrs.values()].sort((a, b) => a.num.localeCompare(b.num))) {
			data.records[v.num] = {
				title: v.title, subject: v.meta.subject ? str(v.meta.subject) : v.title, result: v.meta.result, resultLabel: VR_RESULT[v.meta.result] ?? '',
				date: str(v.meta.date), url: `../../records/${path.posix.basename(v.file).replace(/\.md$/, '.html')}`, supersededBy: v.supersededBy,
			};
			for (const e of list(v.meta.c4)) if (elements[e]) (elements[e].records ||= []).push(v.num);
			for (const a of list(v.meta.adr)) if (adrs[num4(a)]) (adrs[num4(a)].records ||= []).push(v.num);
		}
	}
	return data;
}
