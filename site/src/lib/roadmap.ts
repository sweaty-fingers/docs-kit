// Roadmap (prd.md FR-RM, port of hooks/roadmap.py): docs/roadmap/roadmap.yml → a transit map of done and planned
// work (columns: weeks with done items, then 지금 / 다음 / 그다음 / 나중; rows: tracks), one generated page per item
// (roadmap/items/<id>.md, out of the menu), the viewer's data (roadmap/viewer/data.js), and the markers
// roadmap-map / roadmap-units / roadmap-table. Checks: unknown track / unit / after, non-adjacent tracks, cycles,
// done without date, unknown status, duplicate ids, refs that are no document.
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ASSETS_DIR, DOCS_DIR } from '../config/paths.ts';
import { enabled, loadConfig, type KitConfig } from '../config/load.ts';
import { escapeHtml as esc, type MarkerHandler } from '../markdown/pre.ts';
import { warn } from './warnings.ts';

const DATA = 'roadmap/roadmap.yml';
export const STATUS: Record<string, string> = { done: '완료', doing: '진행 중', next: '다음', later: '그다음', future: '나중', dropped: '취소' };
const HORIZON: [string, string][] = [['doing', '지금'], ['next', '다음'], ['later', '그다음'], ['future', '나중']];
const NODE_W = 140, NODE_H = 46, GUT = 40, GAP = 22, LABEL_W = 108, HEAD_H = 42;
const SUB_W = NODE_W + GUT, LANE_PAD = GAP;
const REF_KINDS: [string, string][] = [
	['adr', '결정 (ADR)'], ['vr', '검증 기록 (VR)'], ['exp', '실험'], ['guide', '실행 가이드·참고'], ['arch', '아키텍처·배경'],
	['pub', '문서함'], ['issue', '이슈·MR'], ['doc', '다른 문서'], ['web', '외부 링크'], ['text', '그 밖의 참조'],
];
const PATH_KIND: [string, string][] = [
	['adr/', 'adr'], ['records/', 'vr'], ['experiments/', 'exp'], ['guides/', 'guide'], ['reference/', 'guide'],
	['arc42/', 'arch'], ['background/', 'arch'], ['glossary/', 'arch'], ['publications/', 'pub'],
];

type Col = string; // "w:2026-01-05" (week of done items) or "h:doing" (horizon)
interface Item {
	id: string;
	title: string;
	tracks: string[];
	unit?: string;
	status: string;
	date: Date | null;
	after: string[];
	refs: any[];
	summary: string;
	children: string[];
	column: Col;
	merge: boolean;
	_c?: number;
	_s?: number;
}
export interface Roadmap {
	title: string;
	tracks: { id: string; name: string; color?: string }[];
	units: Map<string, { id: string; name: string; summary?: string }>;
	items: Item[];
	byid: Map<string, Item>;
	issues: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
function parseDate(v: any): Date | null | 'bad' {
	if (v === undefined || v === null || v === '') return null;
	if (v instanceof Date) return v;
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
	if (!m) return 'bad';
	const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
	return isNaN(d.getTime()) ? 'bad' : d;
}
function week(d: Date): Date {
	const w = (d.getUTCDay() + 6) % 7; // Monday = 0
	return new Date(d.getTime() - w * 86400000);
}
function column(it: { status: string; date: Date | null }): Col {
	if ((it.status === 'done' || it.status === 'dropped') && it.date) return `w:${isoDay(week(it.date))}`;
	if (it.status === 'done' || it.status === 'dropped') return 'h:doing';
	return `h:${it.status}`;
}
function columns(items: Item[]): [Col, string][] {
	const weeks = [...new Set(items.filter((i) => i.column.startsWith('w:')).map((i) => i.column.slice(2)))].sort();
	const used = new Set(items.filter((i) => i.column.startsWith('h:')).map((i) => i.column.slice(2)));
	const cols: [Col, string][] = weeks.map((w) => [`w:${w}`, `${Number(w.slice(5, 7))}/${w.slice(8, 10)} 주`]);
	for (const [h, name] of HORIZON) if (used.has(h) || h === 'doing') cols.push([`h:${h}`, name]);
	return cols;
}

let cache: { key: string; rm: Roadmap | null } | null = null;

export function loadRoadmap(cfg: KitConfig): Roadmap | null {
	if (!enabled(cfg, 'roadmap')) return null;
	const p = path.join(DOCS_DIR, DATA);
	if (!fs.existsSync(p)) return null;
	const key = `${fs.statSync(p).mtimeMs}|${cfg.site.issues_url ?? ''}`;
	if (cache && cache.key === key) return cache.rm;
	let d: any = {};
	try {
		d = parseYaml(fs.readFileSync(p, 'utf-8')) || {};
	} catch (e: any) {
		warn('roadmap', DATA, `not valid YAML: ${String(e.message).split('\n')[0]}`);
	}
	const tracks = (d.tracks || []).map((t: any) => ({ ...t, id: String(t.id), name: String(t.name ?? t.id) }));
	const order = new Map<string, number>(tracks.map((t: any, i: number) => [t.id, i]));
	const units = new Map<string, any>((d.units || []).map((u: any) => [String(u.id), { ...u, id: String(u.id), name: String(u.name ?? u.id) }]));
	const items: Item[] = [];
	const seen = new Set<string>();
	for (const it of d.items || []) {
		const iid = String(it.id ?? '');
		if (!iid || seen.has(iid)) {
			warn('roadmap', null, `item id '${iid}' missing or duplicated`);
			continue;
		}
		seen.add(iid);
		const tr: string[] = typeof it.track === 'string' ? [it.track] : [...(it.track || [])].map(String);
		const bad = tr.filter((t) => !order.has(t));
		if (!tr.length || bad.length) {
			warn('roadmap', null, `item ${iid}: unknown track ${JSON.stringify(bad.length ? bad : tr)}`);
			continue;
		}
		const idx = tr.map((t) => order.get(t)!).sort((a, b) => a - b);
		if (idx.some((v, k) => v !== idx[0] + k)) warn('roadmap', null, `item ${iid}: tracks ${JSON.stringify(tr)} are not next to each other (order in tracks:)`);
		let st = String(it.status ?? 'next');
		if (!(st in STATUS)) {
			warn('roadmap', null, `item ${iid}: status '${st}' (one of ${Object.keys(STATUS).join(', ')})`);
			st = 'next';
		}
		let date = parseDate(it.date);
		if (date === 'bad') {
			warn('roadmap', null, `item ${iid}: date '${it.date}' is not YYYY-MM-DD`);
			date = null;
		}
		if ((st === 'done' || st === 'dropped') && !date) warn('roadmap', null, `item ${iid}: status ${st} needs a date`);
		if (it.unit && !units.has(String(it.unit))) warn('roadmap', null, `item ${iid}: unknown unit '${it.unit}'`);
		items.push({
			id: iid, title: String(it.title ?? iid), tracks: idx.map((i) => tracks[i].id), unit: it.unit ? String(it.unit) : undefined,
			status: st, date, after: (it.after || []).map(String), refs: [...(it.refs || [])], summary: String(it.summary ?? '').trim(),
			children: [], column: 'h:next', merge: false,
		});
	}
	const byid = new Map(items.map((i) => [i.id, i]));
	for (const it of items) {
		for (const a of it.after) if (!byid.has(a)) warn('roadmap', null, `item ${it.id}: after '${a}' is not an item`);
		it.after = it.after.filter((a) => byid.has(a));
	}
	const state = new Map<string, number>();
	const visit = (i: string, trail: string[]) => {
		if (state.get(i) === 1) {
			warn('roadmap', null, `cycle ${[...trail, i].join(' -> ')}`);
			return;
		}
		if (state.get(i) === 2) return;
		state.set(i, 1);
		for (const a of byid.get(i)!.after) visit(a, [...trail, i]);
		state.set(i, 2);
	};
	for (const i of byid.keys()) visit(i, []);
	for (const it of items) for (const a of it.after) byid.get(a)!.children.push(it.id);
	for (const it of items) {
		it.column = column(it);
		const feeding = new Set([...it.after.flatMap((a) => byid.get(a)!.tracks), ...it.tracks]);
		it.merge = it.tracks.length > 1 || (it.after.length >= 2 && feeding.size > 1);
	}
	const issues = cfg.site.issues_url ? (cfg.site.issues_url.endsWith('/') ? cfg.site.issues_url : cfg.site.issues_url + '/') : '';
	const rm: Roadmap = { title: String(d.title ?? '로드맵'), tracks, units, items, byid, issues };
	cache = { key, rm };
	return rm;
}

// ---------------------------------------------------------------- references
function indexDocs(): Map<string, string> {
	const docs = new Map<string, string>();
	const scan = (sub: string, re: RegExp, key: (m: RegExpExecArray) => string) => {
		const d = path.join(DOCS_DIR, sub);
		for (const f of fs.existsSync(d) ? fs.readdirSync(d).sort() : []) {
			const m = re.exec(f);
			if (m) docs.set(key(m), `${sub}/${f}`);
		}
	};
	for (const [kind, sub] of [['VR', 'records'], ['ADR', 'adr'], ['EXP', 'experiments'], ['P', 'publications']])
		scan(sub, /^(\d{4})-[a-z0-9-]+\.md$/, (m) => `${kind}:${m[1]}`);
	scan('guides', /^g(\d+)_.+\.md$/, (m) => `G:${Number(m[1])}`);
	scan('reference', /^r(\d+)_.+\.md$/, (m) => `R:${Number(m[1])}`);
	scan('arc42', /^a(\d\d)_.+\.md$/, (m) => `A:${Number(m[1])}`);
	scan('background', /^(\d\d)_.+\.md$/, (m) => `BG:${Number(m[1])}`);
	return docs;
}

function titleOf(base: string, rel: string): string {
	try {
		for (const line of fs.readFileSync(path.join(base, rel.split('#')[0]), 'utf-8').split('\n')) if (line.startsWith('# ')) return line.slice(2).trim();
	} catch {
		/* no such file */
	}
	return rel;
}

/** A ref → [label, target]: target is a docs-relative .md path, an http URL, or null (plain text). */
function resolve(ref: any, rm: Roadmap, docs: Map<string, string>): [string, string | null] {
	const r = String(ref).trim();
	if (/^#\d+$/.test(r)) return [`이슈 ${r}`, rm.issues ? rm.issues + r.slice(1) : null];
	if (/^!\d+$/.test(r)) return [`MR ${r}`, rm.issues ? rm.issues.replace('/issues/', '/merge_requests/') + r.slice(1) : null];
	if (/^https?:\/\//.test(r)) return [r, r];
	let m = /^(ADR|VR|EXP|P)-(\d{4})$/.exec(r);
	if (m) {
		const p = docs.get(`${m[1]}:${m[2]}`);
		return p ? [titleOf(DOCS_DIR, p), p] : [r, null];
	}
	m = /^(G|R|A)\s?(\d+)(?:\s*(§[\d.]+))?$/.exec(r);
	if (m) {
		const p = docs.get(`${m[1]}:${Number(m[2])}`);
		return p ? [titleOf(DOCS_DIR, p) + (m[3] ? ` ${m[3]}` : ''), p] : [r, null];
	}
	m = /^(?:배경|bg)\s?(\d+)$/.exec(r);
	if (m) {
		const p = docs.get(`BG:${Number(m[1])}`);
		return p ? [`배경 ${titleOf(DOCS_DIR, p)}`, p] : [r, null];
	}
	if (r.includes('.md')) {
		const p = r.startsWith('docs/') ? r.slice(5) : r;
		for (const base of [DOCS_DIR, ASSETS_DIR]) if (fs.existsSync(path.join(base, p.split('#')[0]))) return [titleOf(base, p), p];
		return [r, null];
	}
	return [r, null];
}

function refKind(ref: any, target: string | null): string {
	const r = String(ref).trim();
	if (target === null) return 'text';
	if (/^[#!]\d+$/.test(r)) return 'issue';
	if (target.startsWith('http')) return 'web';
	for (const [pre, kind] of PATH_KIND) if (target.startsWith(pre)) return kind;
	return 'doc';
}

/** A docs .md path (with #anchor) → the built page relative to `here` (a folder). */
function href(target: string, here: string): string {
	if (target.startsWith('http')) return target;
	const [p, anchor] = target.split('#');
	const dir = path.posix.dirname(p);
	const name = path.posix.basename(p);
	const page = path.posix.join(dir, /^(README|index)\.md$/.test(name) ? 'index.html' : name.replace(/\.md$/, '.html'));
	return path.posix.relative(here, page) + (anchor ? `#${anchor}` : '');
}

// ---------------------------------------------------------------- the map (inline SVG)
function wrap(text: string, widthPx = NODE_W - 14, maxLines = 2): string[] {
	const lines: string[] = [];
	let cur = '';
	let w = 0;
	for (const ch of text) {
		const cw = ch.codePointAt(0)! > 0x2e80 ? 12 : 7;
		if (w + cw > widthPx && cur) {
			lines.push(cur);
			cur = '';
			w = 0;
			if (lines.length === maxLines) break;
		}
		cur += ch;
		w += cw;
	}
	if (lines.length < maxLines && cur) lines.push(cur);
	if (lines.length === maxLines && lines.join('') !== text) lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + '…';
	return lines;
}

function layout(rm: Roadmap) {
	const { tracks, items, byid } = rm;
	const cols = columns(items);
	const cidx = new Map(cols.map(([c], i) => [c, i]));
	const tix = new Map(tracks.map((t, i) => [t.id, i]));
	for (const it of items) it._c = cidx.get(it.column)!;
	const depth = new Map<string, number>();
	const sub = (it: Item): number => {
		if (!depth.has(it.id)) {
			depth.set(it.id, 0);
			const same = it.after.map((a) => byid.get(a)!).filter((a) => a._c === it._c);
			depth.set(it.id, Math.max(0, ...same.map((a) => sub(a) + 1)));
		}
		return depth.get(it.id)!;
	};
	const nsub = cols.map(() => 1);
	for (const it of items) {
		it._s = sub(it);
		nsub[it._c!] = Math.max(nsub[it._c!], it._s + 1);
	}
	const used = new Map<string, Set<number>>(); // "track|col|sub" -> rows taken
	const row = new Map<string, number>();
	const want = (it: Item): number | null => {
		for (const a of it.after) if (row.has(a) && byid.get(a)!.tracks.some((t) => it.tracks.includes(t))) return row.get(a)!;
		return null;
	};
	const pending = [...items].sort((a, b) =>
		a._c! - b._c! || a._s! - b._s! || tix.get(a.tracks[0])! - tix.get(b.tracks[0])! ||
		(a.date ? isoDay(a.date) : '').localeCompare(b.date ? isoDay(b.date) : '') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
	for (const it of pending) {
		const w = want(it);
		const keys = it.tracks.map((t) => `${t}|${it._c}|${it._s}`);
		const free = (r: number) => keys.every((k) => !used.get(k)?.has(r));
		let r: number | null = null;
		if (w !== null && free(w)) r = w;
		else {
			let dd = 0;
			const base = w ?? 0;
			while (r === null) {
				for (const cand of [base - dd, base + dd])
					if (cand >= 0 && free(cand)) {
						r = cand;
						break;
					}
				dd++;
			}
		}
		row.set(it.id, r);
		for (const k of keys) {
			if (!used.has(k)) used.set(k, new Set());
			used.get(k)!.add(r);
		}
	}
	const laneN = tracks.map((t) => {
		const rows = [...used.entries()].filter(([k]) => k.split('|')[0] === t.id).flatMap(([, rs]) => [...rs]);
		return rows.length ? Math.max(...rows) + 1 : 1;
	});
	const laneH = laneN.map((n) => n * (NODE_H + GAP) - GAP + 2 * LANE_PAD);
	const laneY = [HEAD_H];
	for (const h of laneH.slice(0, -1)) laneY.push(laneY[laneY.length - 1] + h);
	const colX = [LABEL_W];
	for (const n of nsub.slice(0, -1)) colX.push(colX[colX.length - 1] + n * SUB_W);
	const W = colX[colX.length - 1] + nsub[nsub.length - 1] * SUB_W + 8;
	const H = laneY[laneY.length - 1] + laneH[laneH.length - 1] + 4;
	const pos = new Map<string, { x: number; y0: number; y1: number; mids: number[] }>();
	for (const it of items) {
		const x = colX[it._c!] + it._s! * SUB_W + GUT / 2;
		const rows = it.tracks.map((t) => laneY[tix.get(t)!] + LANE_PAD + row.get(it.id)! * (NODE_H + GAP));
		pos.set(it.id, { x, y0: rows[0], y1: rows[rows.length - 1] + NODE_H, mids: rows.map((r) => r + NODE_H / 2) });
	}
	const channels: number[] = [];
	tracks.forEach((_, i) => {
		for (let k = 0; k <= laneN[i]; k++) channels.push(laneY[i] + LANE_PAD + k * (NODE_H + GAP) - GAP / 2);
	});
	channels.sort((a, b) => a - b);
	return { cols, nsub, colX, laneY, laneH, W, H, pos, tix, channels };
}

function route(lay: ReturnType<typeof layout>, a: string, b: string, lanesUsed: Map<string, number>): [number, number][] {
	const pa = lay.pos.get(a)!, pb = lay.pos.get(b)!;
	const sx = pa.x + NODE_W, tx = pb.x;
	const avgB = pb.mids.reduce((s, m) => s + m, 0) / pb.mids.length;
	const sy = pa.mids.reduce((best, m) => (Math.abs(m - avgB) < Math.abs(best - avgB) ? m : best), pa.mids[0]);
	const ty = pb.mids.reduce((best, m) => (Math.abs(m - sy) < Math.abs(best - sy) ? m : best), pb.mids[0]);
	const boxes = [...lay.pos.values()];
	const clearH = (y: number, x0: number, x1: number) => {
		const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
		return !boxes.some((q) => q.x < hi - 1 && q.x + NODE_W > lo + 1 && q.y0 - 2 < y && y < q.y1 + 2);
	};
	const lane = (key: string, base: number, step: number, n = 5) => {
		const k = lanesUsed.get(key) ?? 0;
		lanesUsed.set(key, k + 1);
		return base + ((k % n) - Math.floor(n / 2)) * step;
	};
	if (Math.abs(sy - ty) < 1 && clearH(sy, sx, tx)) return [[sx, sy], [tx, ty]];
	const xa = lane(`g${Math.round(sx)}`, sx + GUT / 2, 4);
	const xb = lane(`g${Math.round(tx)}`, tx - GUT / 2, 4);
	if (tx > sx && clearH(sy, sx, xb)) return [[sx, sy], [xb, sy], [xb, ty], [tx, ty]];
	if (tx > sx && clearH(ty, xa, tx)) return [[sx, sy], [xa, sy], [xa, ty], [tx, ty]];
	let best: [number, number] | null = null;
	for (const c of lay.channels)
		if (clearH(c, xa, xb)) {
			const cost = Math.abs(c - ty) + Math.abs(c - sy);
			if (!best || cost < best[0]) best = [cost, c];
		}
	let yc = best ? best[1] : Math.min(sy, ty) - NODE_H;
	yc = lane(`c${Math.round(yc)}`, yc, 3, 3);
	return [[sx, sy], [xa, sy], [xa, yc], [xb, yc], [xb, ty], [tx, ty]];
}

function pathD(pts: [number, number][], r = 8): string {
	const f = (n: number) => n.toFixed(1);
	const out = [`M${f(pts[0][0])},${f(pts[0][1])}`];
	for (let i = 1; i < pts.length - 1; i++) {
		const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
		const d0 = Math.abs(x1 - x0) + Math.abs(y1 - y0), d1 = Math.abs(x2 - x1) + Math.abs(y2 - y1);
		const k = Math.min(r, d0 / 2, d1 / 2);
		const sg = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
		const ax = x1 - k * sg(x1 - x0), ay = y1 - k * sg(y1 - y0);
		const bx = x1 + k * sg(x2 - x1), by = y1 + k * sg(y2 - y1);
		out.push(`L${f(ax)},${f(ay)} Q${f(x1)},${f(y1)} ${f(bx)},${f(by)}`);
	}
	out.push(`L${f(pts[pts.length - 1][0])},${f(pts[pts.length - 1][1])}`);
	return out.join(' ');
}

function svg(rm: Roadmap, prefix = '../items/'): [string, number, number] {
	const { tracks, items } = rm;
	const lay = layout(rm);
	const { cols, W, H, laneY, laneH, pos } = lay;
	const color = new Map(tracks.map((t) => [t.id, t.color ?? '#888']));
	const out = [`<svg class="rm-svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(rm.title)}">`];
	const firstH = cols.findIndex(([c]) => c.startsWith('h:'));
	tracks.forEach((_, i) => out.push(`<rect class="rm-lane rm-lane-${i % 2}" x="0" y="${laneY[i]}" width="${W}" height="${laneH[i]}"/>`));
	cols.forEach(([c], i) => {
		const x = lay.colX[i], w = lay.nsub[i] * SUB_W;
		const cls = c === 'h:doing' ? 'rm-col-now' : c.startsWith('h:') ? 'rm-col-plan' : 'rm-col';
		out.push(`<rect class="${cls}" x="${x}" y="0" width="${w}" height="${H}"/>`);
	});
	tracks.forEach((_, i) => out.push(`<line class="rm-lane-sep" x1="0" y1="${laneY[i]}" x2="${W}" y2="${laneY[i]}"/>`));
	out.push(`<line class="rm-lane-sep" x1="0" y1="${H - 4}" x2="${W}" y2="${H - 4}"/>`);
	if (firstH >= 0) out.push(`<line class="rm-today" x1="${lay.colX[firstH]}" y1="6" x2="${lay.colX[firstH]}" y2="${H}"/>`);
	const lanesUsed = new Map<string, number>();
	const edges: [boolean, string, string, string][] = [];
	for (const it of items)
		for (const a of it.after) {
			const src = rm.byid.get(a)!;
			edges.push([src.tracks.some((t) => it.tracks.includes(t)), a, it.id, color.get(src.tracks[0])!]);
		}
	edges.sort((x, y) => Number(x[0]) - Number(y[0]));
	for (const [same, a, b, c] of edges)
		out.push(`<path class="rm-edge ${same ? 'rm-edge-line' : 'rm-edge-cross'}" data-from="${esc(a)}" data-to="${esc(b)}" d="${pathD(route(lay, a, b, lanesUsed))}" stroke="${esc(c)}"/>`);
	for (const it of items) {
		const p = pos.get(it.id)!;
		const x = p.x, y0 = p.y0, h = p.y1 - p.y0;
		const c = color.get(it.tracks[0])!;
		const lines = wrap(it.title, NODE_W - 14, h < 2 * NODE_H ? 2 : 4);
		const cls = `rm-node rm-${it.status}` + (it.merge ? ' rm-merge' : '');
		const tip = `${it.title} — ${STATUS[it.status]}` + (it.date ? `, ${isoDay(it.date)}` : '');
		out.push(`<a href="${prefix}${esc(it.id)}.html" class="rm-link"><g class="${cls}" data-id="${esc(it.id)}" data-up="${esc(it.after.join(' '))}" data-down="${esc(it.children.join(' '))}" style="--c:${esc(c)}"><title>${esc(tip)}</title>`);
		if (it.tracks.length > 1) {
			const grad = `g-${it.id}`;
			const stops = it.tracks.map((t, k) => `<stop offset="${(k / Math.max(1, it.tracks.length - 1)).toFixed(2)}" stop-color="${esc(color.get(t)!)}"/>`).join('');
			out.push(`<defs><linearGradient id="${esc(grad)}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>`);
			out.push(`<rect class="rm-box rm-box-span" x="${x}" y="${y0}" width="${NODE_W}" height="${h}" rx="9" style="stroke:url(#${esc(grad)})"/>`);
		} else out.push(`<rect class="rm-box" x="${x}" y="${y0}" width="${NODE_W}" height="${h}" rx="9"/>`);
		const ty = y0 + h / 2 - (lines.length - 1) * 7.5 + 4;
		lines.forEach((line, k) => out.push(`<text class="rm-text" x="${x + NODE_W / 2}" y="${(ty + k * 15).toFixed(1)}" text-anchor="middle">${esc(line)}</text>`));
		if (it.merge) out.push(`<circle class="rm-ring" cx="${x + NODE_W}" cy="${y0}" r="6"/>`);
		if (it.status === 'done') out.push(`<text class="rm-check" x="${x + 8}" y="${y0 + 14}">✓</text>`);
		out.push('</g></a>');
	}
	out.push(`<g class="rm-heads"><rect class="rm-sticky-bg" x="0" y="0" width="${W}" height="${HEAD_H}"/>`);
	cols.forEach(([, name], i) => {
		const x = lay.colX[i], w = lay.nsub[i] * SUB_W;
		out.push(`<line class="rm-lane-sep" x1="${x}" y1="0" x2="${x}" y2="${HEAD_H}"/><text class="rm-col-label" x="${x + w / 2}" y="26" text-anchor="middle">${esc(name)}</text>`);
	});
	out.push(`<line class="rm-lane-sep" x1="0" y1="${HEAD_H}" x2="${W}" y2="${HEAD_H}"/>`, '</g><g class="rm-labels">');
	tracks.forEach((t, i) => {
		out.push(`<rect class="rm-sticky-bg" x="0" y="${laneY[i]}" width="${LABEL_W - 10}" height="${laneH[i]}"/><rect x="0" y="${laneY[i]}" width="5" height="${laneH[i]}" fill="${esc(color.get(t.id)!)}"/>`);
		wrap(t.name, LABEL_W - 26, 3).forEach((line, k) => out.push(`<text class="rm-lane-label" x="14" y="${laneY[i] + 22 + k * 16}">${esc(line)}</text>`));
	});
	tracks.forEach((_, i) => out.push(`<line class="rm-lane-sep" x1="0" y1="${laneY[i]}" x2="${LABEL_W - 10}" y2="${laneY[i]}"/>`));
	out.push(`<line class="rm-lane-sep" x1="${LABEL_W - 10}" y1="0" x2="${LABEL_W - 10}" y2="${H}"/><rect class="rm-sticky-bg" x="0" y="0" width="${LABEL_W - 10}" height="${HEAD_H}"/></g>`, '</svg>');
	return [out.join(''), W, H];
}

// ---------------------------------------------------------------- pages and data
const st = (it: Item) => `<span class="rm-st rm-st-${it.status}">${STATUS[it.status]}</span>`;
function when(it: Item): string {
	if ((it.status === 'done' || it.status === 'dropped') && it.date) return isoDay(it.date);
	return Object.fromEntries(HORIZON)[it.status] ?? STATUS[it.status];
}
const trackNames = (rm: Roadmap, it: Item) => it.tracks.map((t) => rm.tracks.find((x) => x.id === t)!.name).join(' + ');
function ordered(rm: Roadmap, ids: string[]): Item[] {
	const cols = new Map(columns(rm.items).map(([c], i) => [c, i]));
	return ids
		.map((i) => rm.byid.get(i)!)
		.sort((a, b) => cols.get(a.column)! - cols.get(b.column)! || (a.date ? isoDay(a.date) : '').localeCompare(b.date ? isoDay(b.date) : '') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function itemMd(rm: Roadmap, it: Item, docs: Map<string, string>): string {
	const up = '../../';
	const u = it.unit ? rm.units.get(it.unit) : undefined;
	const lines = [
		`# ${it.title}`, '', '<div class="rm-card" markdown>', '', '| 상태 | 언제 | 트랙 | 업무 |', '| --- | --- | --- | --- |',
		`| ${st(it)} | ${when(it)} | ${trackNames(rm, it)} | ${u ? u.name : '—'} |`, '', '</div>', '',
	];
	if (it.summary) lines.push(it.summary, '');
	lines.push('## 흐름', '');
	if (it.after.length) lines.push('- **앞**: ' + it.after.map((a) => `[${rm.byid.get(a)!.title}](${a}.md) ${st(rm.byid.get(a)!)}`).join(', '));
	if (it.children.length) lines.push('- **뒤**: ' + it.children.map((c) => `[${rm.byid.get(c)!.title}](${c}.md) ${st(rm.byid.get(c)!)}`).join(', '));
	if (!it.after.length && !it.children.length) lines.push('- 이어지는 항목 없음');
	lines.push('', `[로드맵에서 보기](${up}roadmap/README.md)`, '');
	if (it.refs.length) {
		lines.push('## 관련 문서', '');
		const groups = new Map<string, string[]>();
		const add = (k: string, v: string) => groups.set(k, [...(groups.get(k) ?? []), v]);
		for (const r of it.refs) {
			const [label, target] = resolve(r, rm, docs);
			if (target === null) {
				if (/^((ADR|VR|EXP|P)-\d{4}|[GRA]\s?\d+.*|(?:배경|bg)\s?\d+|.*\.md.*)$/.test(String(r))) warn('roadmap', null, `item ${it.id}: ref '${r}' is no document`);
				add('text', String(r));
			} else if (target.startsWith('http')) add(refKind(r, target), `[${label}](${target})`);
			else add(refKind(r, target), `[${label}](${up}${target})`);
		}
		for (const [kind, name] of REF_KINDS) if (groups.get(kind)?.length) lines.push(`- **${name}**: ` + groups.get(kind)!.join(', '));
		lines.push('');
	}
	if (u) {
		lines.push(`## 같은 업무: ${u.name}`, '');
		if (u.summary) lines.push(u.summary, '');
		const sib = rm.items.filter((i) => i.unit === it.unit).map((i) => i.id);
		lines.push(ordered(rm, sib).map((s) => (s.id === it.id ? `**${s.title}**` : `[${s.title}](${s.id}.md)`) + ` ${st(s)}`).join(' → '), '');
	}
	return lines.join('\n');
}

/** roadmap/items/<id>.md for every item (pages a tab module generates, out of the menu). */
export function generatedPages(cfg: KitConfig): Map<string, string> {
	const out = new Map<string, string>();
	const rm = loadRoadmap(cfg);
	if (!rm) return out;
	const docs = indexDocs();
	for (const it of rm.items) out.set(`roadmap/items/${it.id}.md`, itemMd(rm, it, docs));
	return out;
}

export function roadmapData(cfg: KitConfig = loadConfig()): string {
	const rm = loadRoadmap(cfg);
	if (!rm) return 'window.ROADMAP = null;\n';
	const docs = indexDocs();
	const [svgText, w, h] = svg(rm);
	const tracks = new Map(rm.tracks.map((t) => [t.id, t.name]));
	const items: Record<string, any> = {};
	for (const it of ordered(rm, rm.items.map((i) => i.id))) {
		const refs = it.refs.map((r) => {
			const [label, target] = resolve(r, rm, docs);
			return { kind: refKind(r, target), ref: String(r), label, href: target ? href(target, 'roadmap/viewer') : null };
		});
		const u = it.unit ? rm.units.get(it.unit) : undefined;
		items[it.id] = {
			title: it.title, status: it.status, statusLabel: STATUS[it.status], when: when(it), tracks: it.tracks.map((t) => tracks.get(t)),
			unit: it.unit ?? '', unitName: u ? u.name : '', summary: it.summary, after: it.after, children: it.children, refs, page: `../items/${it.id}.html`,
		};
	}
	const data = {
		title: rm.title, svg: svgText, width: w, height: h, items,
		units: [...rm.units.values()].map((u) => ({ id: u.id, name: u.name, summary: u.summary ?? '' })), refKinds: REF_KINDS, status: STATUS,
	};
	return 'window.ROADMAP = ' + JSON.stringify(data) + ';\n';
}

export function roadmapMarkers(cfg: KitConfig, page: { url: string }): Record<string, MarkerHandler> {
	const rm = loadRoadmap(cfg);
	if (!rm) return {};
	const rel = (p: string) => path.posix.relative(path.posix.dirname(page.url), p);
	return {
		'roadmap-map': () => {
			const viewer = rel('roadmap/viewer/index.html');
			const [, , h] = svg(rm);
			const height = Math.round(Math.min(Math.max(h + 70, 420), 1500));
			return (
				`<div class="rm-inline"><div class="rm-inline__bar"><span>${esc(rm.title)} · 역을 누르면 옆에 상세와 관련 문서</span><a href="${viewer}" target="_blank">전체 화면</a></div>` +
				`<iframe class="rm-embed" style="height:${height}px" src="${viewer}?embed=1" title="${esc(rm.title)}" loading="lazy"></iframe></div>`
			);
		},
		'roadmap-units': () => {
			const out: string[] = [];
			const groups = new Map<string, string[]>();
			for (const it of rm.items) groups.set(it.unit ?? '', [...(groups.get(it.unit ?? '') ?? []), it.id]);
			for (const uid of [...rm.units.keys(), ...(groups.get('') ? [''] : [])]) {
				if (!groups.get(uid)?.length) continue;
				const u = rm.units.get(uid) ?? { name: '기타', summary: '' };
				out.push(`### ${u.name}\n`);
				if (u.summary) out.push(`${u.summary}\n`);
				out.push(ordered(rm, groups.get(uid)!).map((it) => `[${esc(it.title)}](${rel('roadmap/items/' + it.id + '.md')}) ${st(it)}`).join(' → ') + '\n');
			}
			return out.join('\n');
		},
		'roadmap-table': () => {
			const rows = ['| 상태 | 언제 | 트랙 | 항목 | 업무 |', '| --- | --- | --- | --- | --- |'];
			for (const it of ordered(rm, rm.items.map((i) => i.id)))
				rows.push(`| ${st(it)} | <span class="kit-nowrap">${when(it)}</span> | ${trackNames(rm, it)} | [${it.title}](${rel('roadmap/items/' + it.id + '.md')}) | ${(it.unit && rm.units.get(it.unit)?.name) || ''} |`);
			return rows.join('\n');
		},
	};
}
