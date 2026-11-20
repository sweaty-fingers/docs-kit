// Document map (문서 지도, prd.md FR-GRAPH, port of hooks/graph.py): every page a node; edges are body links (in
// the finished HTML, so auto-linked § references count), front-matter relations (VR adr, ADR related / supersedes, EXP
// adr, publication based_on, VR guide) and suggested similar documents (0.55 TF-IDF text + 0.30 shared targets + 0.15
// shared C4 elements, best 3 per document above a floor, with the reasons). Topics come from front matter `topics`,
// docs/graph/topics.yml, the roadmap's item refs, then a guess from neighbours; topics that link a lot sit side by
// side. The viewer (assets/graph/viewer/) reads graph/viewer/data.js; `<!-- graph-map -->` embeds it on a page.
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DOCS_DIR } from '../config/paths.ts';
import { enabled, type KitConfig } from '../config/load.ts';
import { splitFrontMatter, type MarkerHandler } from '../markdown/pre.ts';
import { warn } from './warnings.ts';
import type { Site } from './site.ts';

const KINDS: [string, string][] = [
	['arch', '아키텍처'], ['adr', '결정 (ADR)'], ['vr', '검증 기록'], ['exp', '실험'], ['pub', '발행물·보고'],
	['guide', '가이드·참고'], ['bg', '배경·용어'], ['list', '목록·안내'],
];
const SKIP = /(^|\/)template\.md$|^roadmap\/items\/|^graph\//;
const TOP_SIM = 3, SIM_FLOOR = 0.12;

interface P {
	title: string;
	kind: string;
	meta: Record<string, any>;
	links: Set<string>;
	text: string;
	url: string;
}

function kindOf(rel: string, kit: boolean): string {
	const name = path.posix.basename(rel);
	if (kit || ['README.md', 'index.md', 'log.md', 'guide.md', 'c4.md'].includes(name) || rel === 'history.md') return 'list';
	const top = rel.split('/')[0];
	return ({ arc42: 'arch', adr: 'adr', records: 'vr', experiments: 'exp', publications: 'pub', weekly: 'pub', guides: 'guide', reference: 'guide', shared: 'guide', models: 'guide', background: 'bg', glossary: 'bg' } as Record<string, string>)[top] ?? 'list';
}

function short(rel: string): string {
	const m = /^(adr|records|experiments|publications)\/(\d{4})-/.exec(rel);
	if (m) return ({ adr: 'ADR', records: 'VR', experiments: 'EXP', publications: 'P' } as Record<string, string>)[m[1]] + '-' + m[2];
	for (const [re, f] of [[/^arc42\/a(\d\d)_/, (x: string) => `A${Number(x)}`], [/^guides\/g(\d+)_/, (x: string) => `G${Number(x)}`], [/^reference\/r(\d+)_/, (x: string) => `R${Number(x)}`], [/^background\/(\d\d)_/, (x: string) => `배경 ${x}`]] as [RegExp, (x: string) => string][]) {
		const k = re.exec(rel);
		if (k) return f(k[1]);
	}
	return '';
}

// ---------------------------------------------------------------- collecting
function collect(site: Site): Map<string, P> {
	const byUrl = new Map(site.pages.map((p) => [p.url, p.rel]));
	const off = (p: (typeof site.pages)[number]) => p.origin === 'kit' && !!p.feature && !enabled(site.cfg, p.feature.id);
	const hidden = new Set(site.pages.filter(off).map((p) => p.rel));
	const out = new Map<string, P>();
	for (const p of site.pages) {
		if (SKIP.test(p.rel) || p.template || p.generated || hidden.has(p.rel)) continue;
		const here = path.posix.dirname(p.url);
		const links = new Set<string>();
		for (const m of p.html.matchAll(/href="([^"]+)"/g)) {
			let href = m[1].replace(/&amp;/g, '&').split('#')[0].split('?')[0];
			if (!href || /^(https?:|mailto:|\/|data:)/.test(href)) continue;
			try {
				href = decodeURI(href);
			} catch {
				/* keep as is */
			}
			const t = byUrl.get(path.posix.normalize(path.posix.join(here, href)));
			if (t && t !== p.rel && !SKIP.test(t) && !hidden.has(t)) links.add(t);
		}
		let src = p.text ?? '';
		if (!src && p.abs) src = splitFrontMatter(fs.readFileSync(p.abs, 'utf-8').replace(/\r\n/g, '\n'))[1];
		let text = src.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ');
		text = text.replace(/\]\([^)]*\)|<[^>]+>|https?:\/\/\S+/g, ' ');
		out.set(p.rel, { title: p.title || p.rel, kind: kindOf(p.rel, p.origin === 'kit'), meta: p.front || {}, links, text, url: p.url });
	}
	return out;
}

// ---------------------------------------------------------------- relations
function index(srcs: string[]): Map<string, string> {
	const idx = new Map<string, string>();
	const pats: [RegExp, string][] = [[/^adr\/(\d{4})-/, 'ADR'], [/^records\/(\d{4})-/, 'VR'], [/^experiments\/(\d{4})-/, 'EXP'], [/^guides\/g(\d+)_/, 'G'], [/^arc42\/a(\d\d)_/, 'A'], [/^reference\/r(\d+)_/, 'R'], [/^background\/(\d\d)_/, 'BG'], [/^publications\/(\d{4})-/, 'P']];
	for (const s of srcs)
		for (const [re, k] of pats) {
			const m = re.exec(s);
			if (m) idx.set(`${k}:${Number(m[1])}`, s);
		}
	return idx;
}
function nums(v: any): number[] {
	if (v === undefined || v === null) return [];
	return (Array.isArray(v) ? v : [v]).map((x) => /(\d+)/.exec(String(x))).filter(Boolean).map((m) => Number(m![1]));
}
function relations(src: string, p: P, idx: Map<string, string>): [string, string, string][] {
	const meta = p.meta, out: [string, string, string][] = [];
	const add = (key: string, ns: number[], a: string, b: string) => {
		for (const n of ns) {
			const t = idx.get(`${key}:${n}`);
			if (t && t !== src) out.push([t, a, b]);
		}
	};
	if (p.kind === 'vr') {
		add('ADR', nums(meta.adr), '검증한 결정', '검증 기록');
		add('VR', nums(meta.supersedes), '대체한 기록', '대체됨');
		for (const m of String(meta.guide ?? '').matchAll(/\bG(\d+)/g)) add('G', [Number(m[1])], '실행 가이드', '이 가이드로 한 검증');
	} else if (p.kind === 'adr') {
		add('ADR', nums(meta.related), '관련 결정', '관련 결정');
		add('ADR', nums(meta.supersedes), '대체한 결정', '대체됨');
	} else if (p.kind === 'exp') add('ADR', nums(meta.adr), '실험의 결정', '관련 실험');
	if (src.startsWith('publications/')) for (const m of String(meta.based_on ?? '').matchAll(/\bA(\d+)/g)) add('A', [Number(m[1])], '근거 섹션', '이 섹션에 근거한 발행물');
	return out;
}

// ---------------------------------------------------------------- similarity
const byLen = (s: string) => s.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
const JOSA = byLen('에서는 으로는 에게서 이라는 라는 까지 부터 에서 으로 에게 처럼 보다 이나 이고 이며 하고 과 와 은 는 이 가 을 를 의 에 로 도 만');
const ENDS = byLen('했습니다 합니다 입니다 습니다 됩니다 했다 한다 된다 되는 되고 하는 하면 해서 하지 하여 해야 하게 적인 적으로 할 한 된');
const STOP = new Set(
	'것 수 등 및 또는 그 이 저 때 위 더 각 모든 같은 다른 경우 위해 대한 통해 따라 지금 아직 먼저 있음 없음 있습니다 없습니다 그리고 하지만 그래서 여기 거기 이번 다시 가장 바로 the and for with from this that are was not you can use'.split(' '),
);
const SUFFIXES = [...ENDS, ...JOSA];
function tokens(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/[가-힣]+|[A-Za-z][A-Za-z0-9_\-]{2,}/g)) {
		let w = m[0];
		if (w[0] >= '가') {
			for (let i = 0; i < 2; i++)
				for (const e of SUFFIXES)
					if (w.endsWith(e) && w.length - e.length >= 2) {
						w = w.slice(0, -e.length);
						break;
					}
			if (w.length < 2) continue;
		} else w = w.toLowerCase();
		if (!STOP.has(w)) out.push(w);
	}
	return out;
}
type Vec = Map<string, number>;
function tfidf(docs: Map<string, string[]>): Map<string, Vec> {
	const n = docs.size;
	const df = new Map<string, number>();
	for (const d of docs.values()) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
	const vecs = new Map<string, Vec>();
	for (const [k, toks] of docs) {
		const tf = new Map<string, number>();
		for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
		const v: Vec = new Map();
		for (const [t, c] of tf) {
			const d = df.get(t)!;
			if (d >= 2 && d <= 0.4 * n) v.set(t, (1 + Math.log(c)) * Math.log(n / d));
		}
		const norm = Math.sqrt([...v.values()].reduce((a, x) => a + x * x, 0)) || 1;
		for (const [t, x] of v) v.set(t, x / norm);
		vecs.set(k, v);
	}
	return vecs;
}
function cos(a: Vec, b: Vec): number {
	if (a.size > b.size) [a, b] = [b, a];
	let s = 0;
	for (const [t, x] of a) s += x * (b.get(t) ?? 0);
	return s;
}
function weightedSets(sets: Map<string, Set<string>>): Map<string, Vec> {
	const n = sets.size || 1;
	const df = new Map<string, number>();
	for (const s of sets.values()) for (const x of s) df.set(x, (df.get(x) ?? 0) + 1);
	const out = new Map<string, Vec>();
	for (const [k, s] of sets) {
		const v: Vec = new Map([...s].map((x) => [x, Math.log(1 + n / df.get(x)!)]));
		const norm = Math.sqrt([...v.values()].reduce((a, w) => a + w * w, 0)) || 1;
		for (const [x, w] of v) v.set(x, w / norm);
		out.set(k, v);
	}
	return out;
}

// ---------------------------------------------------------------- topics
function refSrc(ref: any, idx: Map<string, string>, srcs: Set<string>): string | null {
	const r = String(ref).trim();
	const m = /^(ADR|VR|EXP|P)-(\d{4})$/.exec(r) || /^([GAR])\s?(\d+)/.exec(r) || /^(배경|bg)\s?(\d+)/.exec(r);
	if (m) return idx.get(`${m[1] === '배경' || m[1] === 'bg' ? 'BG' : m[1]}:${Number(m[2])}`) ?? null;
	let p = r.split('#')[0];
	if (p.startsWith('docs/')) p = p.slice(5);
	return srcs.has(p) ? p : null;
}
function* permutations<T>(a: T[]): Generator<T[]> {
	if (a.length <= 1) {
		yield a;
		return;
	}
	for (let i = 0; i < a.length; i++) for (const rest of permutations([...a.slice(0, i), ...a.slice(i + 1)])) yield [a[i], ...rest];
}
type Sims = Map<string, [number, string, string[]][]>;
function topics(pages: Map<string, P>, srcs: string[], rels: Map<string, [string, string][]>, sims: Sims): [Map<string, [string[], string]> | null, [string, string][]] {
	const rp = path.join(DOCS_DIR, 'roadmap', 'roadmap.yml');
	if (!fs.existsSync(rp)) return [null, []];
	let rm: any = {};
	try {
		rm = parseYaml(fs.readFileSync(rp, 'utf-8')) || {};
	} catch {
		return [null, []];
	}
	const vocab: [string, string][] = (rm.tracks || []).map((t: any) => [String(t.id), String(t.name ?? t.id)]);
	const valid = new Set([...vocab.map(([t]) => t), 'common']);
	const order = new Map(vocab.map(([t], i) => [t, i]));
	const idx = index(srcs);
	const srcset = new Set(srcs);
	const out = new Map<string, [string[], string]>();
	const clean = (v: any, where: string): string[] => {
		const arr: string[] = typeof v === 'string' ? [v] : [...(v || [])].map(String);
		const bad = arr.filter((t) => !valid.has(t));
		if (bad.length) warn('graph', null, `${where}: unknown topic ${JSON.stringify(bad)} (topics are the roadmap's track ids, or common)`);
		return arr.filter((t) => valid.has(t)).slice(0, 2);
	};
	for (const s of srcs) {
		const t = clean(pages.get(s)!.meta.topics, s);
		if (t.length) out.set(s, [t, '머리말']);
	}
	const op = path.join(DOCS_DIR, 'graph', 'topics.yml');
	if (fs.existsSync(op)) {
		let tl: any = {};
		try {
			tl = parseYaml(fs.readFileSync(op, 'utf-8')) || {};
		} catch (e: any) {
			warn('graph', 'graph/topics.yml', `not valid YAML: ${String(e.message).split('\n')[0]}`);
		}
		for (const [key, v] of Object.entries(tl)) {
			const s = refSrc(key, idx, srcset);
			if (!s) {
				warn('graph', 'graph/topics.yml', `'${key}' is no document`);
				continue;
			}
			const t = clean(v, `graph/topics.yml ${key}`);
			if (t.length && !out.has(s)) out.set(s, [t, '확인']);
		}
	}
	const counts = new Map<string, Map<string, number>>();
	for (const it of rm.items || []) {
		const tracks: string[] = typeof it.track === 'string' ? [it.track] : [...(it.track || [])].map(String);
		for (const r of it.refs || []) {
			const s = refSrc(r, idx, srcset);
			if (!s) continue;
			const c = counts.get(s) ?? new Map<string, number>();
			for (const t of tracks) if (order.has(t)) c.set(t, (c.get(t) ?? 0) + 1);
			counts.set(s, c);
		}
	}
	for (const [s, c] of counts)
		if (!out.has(s) && c.size) {
			const top = [...c.keys()].sort((a, b) => c.get(b)! - c.get(a)! || order.get(a)! - order.get(b)!);
			out.set(s, [[top[0], ...top.slice(1, 2).filter((t) => c.get(t)! * 2 >= c.get(top[0])!)], '로드맵']);
		}
	for (const s of srcs) if (!out.has(s) && pages.get(s)!.kind === 'list') out.set(s, [['common'], '목록']);
	const nbr = new Map<string, Map<string, number>>(srcs.map((s) => [s, new Map()]));
	const bump = (a: string, b: string, w: number) => nbr.get(a)!.set(b, (nbr.get(a)!.get(b) ?? 0) + w);
	for (const a of srcs) {
		for (const b of pages.get(a)!.links) {
			bump(a, b, 1);
			bump(b, a, 1);
		}
		for (const [b] of rels.get(a) ?? []) bump(a, b, 1.5);
		for (const [score, b] of sims.get(a) ?? []) bump(a, b, 3 * score);
	}
	let guess = new Map<string, string[]>();
	for (let round = 0; round < 3; round++) {
		const next = new Map<string, string[]>();
		for (const a of srcs) {
			if (out.has(a)) continue;
			const votes = new Map<string, number>();
			for (const [b, w] of nbr.get(a)!) {
				const tb = out.get(b)?.[0] ?? guess.get(b);
				if (!tb || (tb.length === 1 && tb[0] === 'common')) continue;
				const k = out.has(b) ? 1 : 0.5;
				votes.set(tb[0], (votes.get(tb[0]) ?? 0) + w * k);
				if (tb.length > 1) votes.set(tb[1], (votes.get(tb[1]) ?? 0) + 0.5 * w * k);
			}
			const total = [...votes.values()].reduce((x, y) => x + y, 0);
			if (!total) {
				next.set(a, ['common']);
				continue;
			}
			const top = [...votes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2);
			if (top[0][1] / total < 0.45) next.set(a, ['common']);
			else next.set(a, [top[0][0], ...top.slice(1).filter(([, v]) => v >= 0.6 * top[0][1]).map(([t]) => t)]);
		}
		guess = next;
	}
	for (const [a, t] of guess) out.set(a, [t, '추정']);
	const ids = vocab.map(([t]) => t);
	const w = new Map<string, number>();
	const pair = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
	for (const a of srcs)
		for (const b of new Set([...pages.get(a)!.links, ...(rels.get(a) ?? []).map(([x]) => x)])) {
			const ta = out.get(a)![0][0], tb = out.get(b)?.[0][0];
			if (tb && ta !== tb && ta !== 'common' && tb !== 'common') w.set(pair(ta, tb), (w.get(pair(ta, tb)) ?? 0) + 1);
		}
	let best = -1, ring = ids;
	if (ids.length > 2 && ids.length <= 8)
		for (const perm of permutations(ids.slice(1))) {
			const cyc = [ids[0], ...perm];
			let v = 0;
			for (let i = 0; i < cyc.length; i++) v += w.get(pair(cyc[i], cyc[(i + 1) % cyc.length])) ?? 0;
			if (v > best) {
				best = v;
				ring = cyc;
			}
		}
	const names = new Map(vocab);
	return [out, ring.map((t) => [t, names.get(t)!])];
}

function mismatch(pages: Map<string, P>, srcs: string[], rels: Map<string, [string, string][]>, tp: Map<string, [string[], string]>): Map<string, string> {
	const out = new Map<string, string>();
	for (const a of srcs) {
		const [t, src] = tp.get(a) ?? [[], ''];
		if (!['머리말', '확인', '로드맵'].includes(src) || (t.length === 1 && t[0] === 'common')) continue;
		const votes = new Map<string, number>();
		for (const b of new Set([...pages.get(a)!.links, ...(rels.get(a) ?? []).map(([x]) => x)])) {
			const tb = tp.get(b)?.[0];
			if (tb?.length && tb[0] !== 'common') votes.set(tb[0], (votes.get(tb[0]) ?? 0) + 1);
		}
		const total = [...votes.values()].reduce((x, y) => x + y, 0);
		if (total >= 3) {
			const others = [...votes.entries()].filter(([k]) => !t.includes(k)).sort((x, y) => y[1] - x[1]);
			const own = t.reduce((s, k) => s + (votes.get(k) ?? 0), 0);
			if (others.length && others[0][1] / total >= 0.5 && own / total <= 0.2) out.set(a, others[0][0]);
		}
	}
	return out;
}

// ---------------------------------------------------------------- output
export function graphData(site: Site): string {
	if (!enabled(site.cfg, 'graph')) return 'window.DOCGRAPH = null;\n';
	const pages = collect(site);
	const srcs = [...pages.keys()].sort();
	const idx = index(srcs);
	const pid = new Map(srcs.map((s, i) => [s, i]));
	const rels = new Map<string, [string, string][]>(srcs.map((s) => [s, []]));
	for (const s of srcs)
		for (const [t, a, b] of relations(s, pages.get(s)!, idx)) {
			rels.get(s)!.push([t, a]);
			rels.get(t)!.push([s, b]);
		}
	const pair = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
	const linked = new Set<string>();
	for (const s of srcs) {
		for (const t of pages.get(s)!.links) linked.add(pair(s, t));
		for (const [t] of rels.get(s)!) linked.add(pair(s, t));
	}
	const content = srcs.filter((s) => pages.get(s)!.kind !== 'list');
	const text = tfidf(new Map(content.map((s) => [s, tokens(pages.get(s)!.text)])));
	const targets = weightedSets(new Map(content.map((s) => [s, new Set([...pages.get(s)!.links, ...rels.get(s)!.map(([t]) => t)])])));
	const c4 = weightedSets(new Map(content.map((s) => [s, new Set<string>((Array.isArray(pages.get(s)!.meta.c4) ? pages.get(s)!.meta.c4 : []).map(String))])));
	const sims: Sims = new Map();
	const label = (t: string) => short(t) || pages.get(t)!.title;
	for (let i = 0; i < content.length; i++)
		for (const b of content.slice(i + 1)) {
			const a = content[i];
			if (linked.has(pair(a, b))) continue;
			const st = cos(text.get(a)!, text.get(b)!), sc = cos(targets.get(a)!, targets.get(b)!), s4 = cos(c4.get(a)!, c4.get(b)!);
			const score = 0.55 * st + 0.3 * sc + 0.15 * s4;
			if (score < SIM_FLOOR) continue;
			const why: string[] = [];
			const ta = text.get(a)!, tb = text.get(b)!;
			const words = [...ta.keys()].filter((t) => tb.has(t)).sort((x, y) => ta.get(y)! * tb.get(y)! - ta.get(x)! * tb.get(x)!).slice(0, 5);
			if (words.length) why.push('같은 낱말: ' + words.join(', '));
			const ga = targets.get(a)!, gb = targets.get(b)!;
			const common = [...ga.keys()].filter((t) => gb.has(t)).sort((x, y) => ga.get(y)! * gb.get(y)! - ga.get(x)! * gb.get(x)!).slice(0, 3);
			if (common.length) why.push('같은 문서를 가리킴: ' + common.map(label).join(', '));
			const elems = [...c4.get(a)!.keys()].filter((t) => c4.get(b)!.has(t)).sort();
			if (elems.length) why.push('같은 구성요소(C4): ' + elems.join(', '));
			(sims.get(a) ?? sims.set(a, []).get(a)!).push([score, b, why]);
			(sims.get(b) ?? sims.set(b, []).get(b)!).push([score, a, why]);
		}
	const desc = (x: [number, string, string[]], y: [number, string, string[]]) => y[0] - x[0] || (y[1] < x[1] ? -1 : y[1] > x[1] ? 1 : 0);
	const keep = new Set<string>();
	for (const [a, lst] of sims) for (const [, b] of [...lst].sort(desc).slice(0, TOP_SIM)) keep.add(pair(a, b));
	const kept: Sims = new Map([...sims].map(([a, lst]) => [a, lst.filter(([, b]) => keep.has(pair(a, b)))]));
	const [tp0, ring] = topics(pages, srcs, rels, kept);
	const tp = tp0 ?? new Map<string, [string[], string]>();
	const off = mismatch(pages, srcs, rels, tp);
	const here = 'graph/viewer';
	const nodes = srcs.map((s) => {
		const p = pages.get(s)!, m = p.meta;
		const summary = m.summary || m.subject || m.question || '';
		const state = m.result || m.status || '';
		const sh = short(s);
		const title = sh ? p.title.replace(/^((ADR|VR|EXP|P)-\d{4}|[AGR]\d+|\d+)\.?\s+/, '') : p.title;
		return {
			id: s, t: title, short: sh, k: p.kind, area: String(m.area ?? ''), sum: String(summary).slice(0, 400), state: String(state),
			url: path.posix.relative(here, p.url),
			out: [...p.links].filter((t) => pid.has(t)).map((t) => pid.get(t)!).sort((a, b) => a - b),
			rel: rels.get(s)!.filter(([t]) => pid.has(t)).map(([t, lab]) => ({ j: pid.get(t)!, label: lab })),
			sim: [...(sims.get(s) ?? [])].sort(desc).filter(([, b]) => keep.has(pair(s, b))).map(([sc, b, why]) => ({ j: pid.get(b)!, score: Math.round(sc * 1000) / 1000, why })),
			topics: tp.get(s)?.[0] ?? [], tsrc: tp.get(s)?.[1] ?? '', off: off.get(s) ?? '',
		};
	});
	let ask: any = { port: 8003, from_ports: [8001], start: 'python3 .docs-kit/bin/docs_ask.py --serve' };
	const qc = path.join(DOCS_DIR, 'quality', 'config.json');
	if (fs.existsSync(qc))
		try {
			ask = { ...ask, ...(JSON.parse(fs.readFileSync(qc, 'utf-8')).ask || {}) };
		} catch {
			/* reported by the quality page */
		}
	const data = {
		title: site.cfg.site.name || '문서 지도', kinds: KINDS, nodes, ask,
		topics: [...ring.map(([a, b]) => [a, b]), ...(ring.length ? [['common', '공통']] : [])],
		areas: [...new Set(nodes.map((n) => n.area).filter(Boolean))].sort(),
	};
	return 'window.DOCGRAPH = ' + JSON.stringify(data) + ';\n';
}

export function graphMarkers(cfg: KitConfig, page: { url: string }): Record<string, MarkerHandler> {
	if (!enabled(cfg, 'graph')) return {};
	const viewer = path.posix.relative(path.posix.dirname(page.url), 'graph/viewer/index.html');
	return {
		'graph-map': () =>
			`<div class="rm-inline"><div class="rm-inline__bar"><span>문서 지도 · 문서를 누르면 옆에 연결과 이유</span><a href="${viewer}" target="_blank">전체 화면</a></div>` +
			`<iframe class="rm-embed" style="height:780px" src="${viewer}?embed=1" title="문서 지도" loading="lazy"></iframe></div>`,
	};
}

