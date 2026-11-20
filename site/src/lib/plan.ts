// Project dashboard (현황판, prd.md FR-PLAN, port of hooks/plan.py): docs/plan/scope.yml (stages > features > stories
// > backlog > WBS, sizes as points or [low, high], DoD, research questions), risks.yml, sprints.json, issues.json and
// the roadmap's statuses → summary cards, burn-up with forecast, stages tree, questions, change log, risk summary /
// PI matrix / top / trend / register, the current sprint and sprint history, and the board's data (plan/board/data.js).
// The page interaction is the kit's plan.js; styles plan.css (both from the MkDocs edition, unchanged).
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DOCS_DIR } from '../config/paths.ts';
import { enabled, loadConfig, type KitConfig } from '../config/load.ts';
import { escapeHtml as h, type MarkerHandler } from '../markdown/pre.ts';
import { warn } from './warnings.ts';

const LEVELS = ['epic', 'feature', 'story', 'backlog', 'wbs'];
const LEVEL_KO: Record<string, string> = { epic: 'Epic', feature: 'Feature', story: 'Story', backlog: 'Backlog', wbs: 'WBS' };
const KIND_KO: Record<string, string> = { deliver: '만들기', learn: '배우기', decide: '결정', enabler: '기반' };
const STATUS_KO: Record<string, string> = { done: '완료', doing: '진행 중', todo: '할 일', dropped: '뺌' };
const WAVE_KO: Record<string, string> = { now: '지금', next: '다음', later: '나중' };
const MET: Record<string, [string, string]> = { yes: ['✓', '충족'], partial: ['△', '일부'], no: ['○', '미충족'] };
const Q_KO: Record<string, string> = { open: '열림', investigating: '조사 중', answered: '답함', dropped: '접음' };
const CONF_KO: Record<string, string> = { low: '낮음', medium: '중간', high: '높음' };
const R_STATUS: Record<string, string> = { open: '관리 중', watch: '지켜봄', occurred: '일어남', closed: '닫힘' };
const R_RESP: Record<string, string> = { avoid: '피함', mitigate: '줄임', transfer: '넘김', accept: '받아들임' };
const ITEM_KEYS = new Set(['id', 'level', 'parent', 'title', 'short', 'size', 'roadmap', 'issue', 'status', 'date', 'dod', 'added', 'removed', 'reason', 'kind', 'wave', 'track']);
const Q_KEYS = new Set(['id', 'title', 'status', 'confidence', 'evidence', 'note', 'items']);
const RISK_KEYS = new Set(['id', 'title', 'category', 'cause', 'effect', 'response', 'actions', 'owner', 'status', 'links', 'history']);
const SPRINT_KEYS = new Set(['id', 'start', 'end', 'state', 'goal', 'items', 'blocked', 'carried', 'retro', 'note', 'closed_at']);
const BANDS: [string, string][] = [['critical', '매우 높음'], ['high', '높음'], ['medium', '중간'], ['low', '낮음']];
const SPRINT_COLS = ['todo', 'doing', 'review', 'done'];
const COL_KO: Record<string, string> = { todo: '할 일', doing: '진행 중', review: '검토', done: '완료' };
const SPRINT_STATE_KO: Record<string, string> = { planned: '계획', active: '진행 중', closed: '마감' };

// ---------------------------------------------------------------- dates (UTC days) and numbers
type D = Date;
const DAY = 86400000;
function date(v: any): D | null {
	if (v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
	if (typeof v === 'string' && v) {
		const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
		if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
	}
	return null;
}
const iso = (d: D | null) => (d ? d.toISOString().slice(0, 10) : '-');
const addDays = (d: D, n: number) => new Date(d.getTime() + n * DAY);
const days = (a: D, b: D) => Math.round((a.getTime() - b.getTime()) / DAY); // a - b
const monday = (d: D) => addDays(d, -((d.getUTCDay() + 6) % 7));
function todayUtc(): D {
	const t = new Date();
	return new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()));
}
/** Python's format(x, 'g') for the values used here (points, sizes). */
function g(x: number): string {
	if (Number.isInteger(x)) return String(x);
	return String(Number(x.toPrecision(6)));
}
const f1 = (x: number) => x.toFixed(1);
const f0 = (x: number) => x.toFixed(0);
const attr = (s: any) => h(String(s));
const str = (v: any) => (v === undefined || v === null ? '' : v instanceof Date ? iso(date(v)) : String(v));

// ---------------------------------------------------------------- state
interface Node {
	id: string;
	level: string;
	parent: string | null;
	title: any;
	short?: any;
	size: [number, number] | null;
	roadmap?: any;
	issue?: any;
	status?: string;
	date?: any;
	dod?: any[];
	added: D;
	removed: D | null;
	reason?: any;
	kind?: string;
	wave?: string;
	track?: any;
	children: string[];
	own: [string | null, D | null];
	state: [string, D | null];
}
interface Risk {
	[k: string]: any;
	id: string;
	title: string;
	history: { date: D; p: number; i: number; note?: string }[];
	p: number;
	i: number;
}
interface State {
	sc: any;
	start: D;
	today: D;
	nodes: Map<string, Node>;
	order: string[];
	units: string[];
	taken: string | null;
	risks: Risk[];
	rk: any;
	docs: Map<string, string>;
	issuesUrl: string;
	sprintCfg: any;
	sprints: any[];
}

function keys(where: string, d: any, known: Set<string>) {
	const extra = Object.keys(d || {}).filter((k) => !known.has(k)).sort();
	if (extra.length) warn('plan', null, `${where}: unknown key(s) ${extra.join(', ')} (quote values that contain ', ' or ' #')`);
}
function size(v: any): [number, number] | null {
	if (v === undefined || v === null) return null;
	if (typeof v === 'number') return [v, v];
	if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number')) return [v[0], v[1]];
	return null;
}
const mid = (s: [number, number]) => (s[0] + s[1]) / 2;
function readYaml(rel: string): any {
	const p = path.join(DOCS_DIR, rel);
	if (!fs.existsSync(p)) return null;
	try {
		return parseYaml(fs.readFileSync(p, 'utf-8')) ?? {};
	} catch (e: any) {
		warn('plan', rel, `not valid YAML: ${String(e.message).split('\n')[0]}`);
		return {};
	}
}

let cache: { key: string; s: State | null } | null = null;

function fileKey(): string {
	return ['plan/scope.yml', 'plan/risks.yml', 'plan/issues.json', 'plan/sprints.json', 'roadmap/roadmap.yml']
		.map((r) => {
			try {
				return `${r}:${fs.statSync(path.join(DOCS_DIR, r)).mtimeMs}`;
			} catch {
				return `${r}:-`;
			}
		})
		.join('|') + `|${iso(todayUtc())}`;
}

export function loadPlan(cfg: KitConfig): State | null {
	if (!enabled(cfg, 'plan') || !fs.existsSync(path.join(DOCS_DIR, 'plan', 'scope.yml'))) return null;
	const key = fileKey() + `|${cfg.site.issues_url ?? ''}`;
	if (cache && cache.key === key) return cache.s;
	const sc = readYaml('plan/scope.yml') || {};
	const start = date(sc.start) ?? todayUtc();
	const rm = new Map<string, any>();
	for (const it of (readYaml('roadmap/roadmap.yml') || {}).items || []) rm.set(String(it.id), it);
	let iss = new Map<number, any>();
	let taken: string | null = null;
	const ip = path.join(DOCS_DIR, 'plan', 'issues.json');
	if (fs.existsSync(ip)) {
		try {
			const j = JSON.parse(fs.readFileSync(ip, 'utf-8'));
			taken = j.taken ?? null;
			iss = new Map((j.issues || []).map((i: any) => [Number(i.iid), i]));
		} catch (e: any) {
			warn('plan', 'plan/issues.json', String(e.message));
		}
	}
	const nodes = new Map<string, Node>();
	const order: string[] = [];
	for (const it of sc.items || []) {
		const nid = String(it.id ?? '');
		if (!nid || nodes.has(nid)) {
			warn('plan', null, `item id '${nid}' missing or duplicated`);
			continue;
		}
		keys(`item ${nid}`, it, ITEM_KEYS);
		if (!LEVELS.includes(it.level)) {
			warn('plan', null, `${nid}: level '${it.level}' (one of ${LEVELS.join(', ')})`);
			continue;
		}
		const n: Node = { ...it, id: nid, parent: it.parent === undefined || it.parent === null ? null : String(it.parent), size: size(it.size), added: date(it.added) ?? start, removed: date(it.removed), children: [], own: [null, null], state: ['todo', null] };
		if (it.size !== undefined && it.size !== null && !n.size) warn('plan', null, `${nid}: size ${JSON.stringify(it.size)} (a number or [low, high])`);
		nodes.set(nid, n);
		order.push(nid);
	}
	for (const nid of order) {
		const n = nodes.get(nid)!;
		if (n.parent !== null) {
			if (!nodes.has(n.parent)) {
				warn('plan', null, `${nid}: parent '${n.parent}' is not an item`);
				n.parent = null;
			} else nodes.get(n.parent)!.children.push(nid);
		} else if (n.level !== 'epic') warn('plan', null, `${nid}: a ${n.level} needs a parent`);
	}
	for (const nid of order) {
		const seen = new Set<string>();
		let p = nodes.get(nid)!.parent;
		while (p) {
			if (seen.has(p) || p === nid) {
				warn('plan', null, `cycle through ${nid}`);
				nodes.get(nid)!.parent = null;
				break;
			}
			seen.add(p);
			p = nodes.get(p)!.parent;
		}
	}
	for (const nid of order) {
		const n = nodes.get(nid)!;
		let st: string | null = null;
		let d: D | null = null;
		if (n.roadmap) {
			const r = rm.get(String(n.roadmap));
			if (!r) warn('plan', null, `${nid}: roadmap item '${n.roadmap}' not in roadmap.yml`);
			else {
				st = ({ done: 'done', doing: 'doing', dropped: 'dropped' } as any)[r.status] ?? 'todo';
				d = date(r.date);
				if (n.title === undefined) n.title = r.title;
			}
		}
		if (n.issue !== undefined && n.issue !== null) {
			const i = iss.get(Number(n.issue));
			if (!i) {
				if (iss.size) warn('plan', null, `${nid}: issue #${n.issue} not in issues.json (refresh the issue snapshot)`);
			} else {
				if (n.title === undefined) n.title = i.title;
				if (st === null) {
					st = i.state === 'closed' ? 'done' : 'todo';
					d = date(i.closed);
				}
			}
		}
		if (n.status) {
			st = n.status in STATUS_KO ? n.status : st;
			d = date(n.date) ?? d;
		}
		n.own = [st, d];
		if (n.title === undefined) n.title = nid;
	}
	const sizedAnc = (nid: string): string | null => {
		let p = nodes.get(nid)!.parent;
		while (p) {
			if (nodes.get(p)!.size) return p;
			p = nodes.get(p)!.parent;
		}
		return null;
	};
	const units: string[] = [];
	for (const nid of order) {
		const n = nodes.get(nid)!;
		if (n.size) {
			const a = sizedAnc(nid);
			if (a) {
				warn('plan', null, `${nid}: sized under sized ${a} (counted once, at ${a})`);
				continue;
			}
			units.push(nid);
		} else if (!n.children.length && !sizedAnc(nid) && n.level !== 'epic') warn('plan', null, `${nid}: no size (a number, or [low, high] for far work)`);
	}
	const leaves = (nid: string): [string | null, D | null][] => {
		const out: [string | null, D | null][] = [];
		for (const c of nodes.get(nid)!.children) {
			if (nodes.get(c)!.own[0] !== null) out.push(nodes.get(c)!.own);
			out.push(...leaves(c));
		}
		return out;
	};
	const rollup = (sts: [string | null, D | null][], own: [string | null, D | null]): [string, D | null] => {
		const s = sts.filter((x) => x[0] !== null && x[0] !== 'dropped');
		if (!s.length) return own[0] !== null ? (own as [string, D | null]) : ['todo', null];
		if (s.every((x) => x[0] === 'done')) {
			const ds = s.map((x) => x[1]).filter((x): x is D => !!x);
			return ['done', ds.length ? new Date(Math.max(...ds.map((x) => x.getTime()))) : null];
		}
		if (s.some((x) => x[0] === 'done' || x[0] === 'doing')) return ['doing', null];
		return ['todo', null];
	};
	for (const nid of order) {
		const n = nodes.get(nid)!;
		if (n.own[0] === 'dropped') n.state = n.own as [string, D | null];
		else if (n.children.length)
			n.state = rollup([...leaves(nid), ...(n.level !== 'epic' && (n.issue === undefined || n.issue === null) && n.own[0] ? [n.own] : [])], n.own);
		else n.state = n.own[0] ? (n.own as [string, D | null]) : ['todo', null];
		if (n.state[0] === 'done' && !n.state[1]) {
			n.state = ['done', n.added];
			warn('plan', null, `${nid}: done without a date (roadmap date / issue closed / date:)`);
		}
	}
	for (const nid of order) {
		const n = nodes.get(nid)!;
		if ((n.level === 'backlog' || n.level === 'wbs') && !(n.dod && n.dod.length) && n.own[0] !== 'dropped') {
			let p = n.parent;
			let ok = false;
			while (p && !ok) {
				const pn = nodes.get(p)!;
				ok = !!(pn.dod && pn.dod.length) && ['backlog', 'wbs', 'story'].includes(pn.level);
				p = pn.parent;
			}
			if (!ok) warn('plan', null, `${nid}: ${n.level} without a DoD (own, or its backlog item's)`);
		}
	}
	const rk = readYaml('plan/risks.yml') || {};
	for (const q of sc.questions || []) keys(`question ${q.id}`, q, Q_KEYS);
	const risks: Risk[] = [];
	for (const r of rk.risks || []) {
		keys(`risk ${r.id}`, r, RISK_KEYS);
		const hist = (r.history || []).map((x: any) => ({ ...x, date: date(x.date), p: Number(x.p ?? 0), i: Number(x.i ?? 0) })).sort((a: any, b: any) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
		if (!hist.length) {
			warn('plan', null, `risk ${r.id}: no history (date, p, i)`);
			continue;
		}
		for (const x of hist) if (!(x.p >= 1 && x.p <= 5 && x.i >= 1 && x.i <= 5)) warn('plan', null, `risk ${r.id}: p / i out of 1..5 on ${iso(x.date)}`);
		if (!(r.status in R_STATUS)) warn('plan', null, `risk ${r.id}: status '${r.status}' (one of ${Object.keys(R_STATUS).join(', ')})`);
		risks.push({ ...r, id: String(r.id), title: String(r.title ?? ''), history: hist, p: hist[hist.length - 1].p, i: hist[hist.length - 1].i });
	}
	const issuesUrl = cfg.site.issues_url ? (cfg.site.issues_url.endsWith('/') ? cfg.site.issues_url : cfg.site.issues_url + '/') : '';
	const s: State = { sc, start, today: todayUtc(), nodes, order, units, taken, risks, rk, docs: indexDocs(), issuesUrl, sprintCfg: null, sprints: [] };
	loadSprints(s);
	cache = { key, s };
	return s;
}

function indexDocs(): Map<string, string> {
	const out = new Map<string, string>();
	for (const [kind, sub, re] of [
		['ADR', 'adr', /^(\d{4})-.+\.md$/], ['VR', 'records', /^(\d{4})-.+\.md$/], ['EXP', 'experiments', /^(\d{4})-.+\.md$/],
		['P', 'publications', /^(\d{4})-.+\.md$/], ['G', 'guides', /^g(\d+)_.+\.md$/], ['R', 'reference', /^r(\d+)_.+\.md$/],
		['A', 'arc42', /^a(\d\d)_.+\.md$/], ['BG', 'background', /^(\d\d)_.+\.md$/],
	] as [string, string, RegExp][]) {
		const d = path.join(DOCS_DIR, sub);
		for (const f of fs.existsSync(d) ? fs.readdirSync(d).sort() : []) {
			const m = re.exec(f);
			if (m) out.set(`${kind}:${Number(m[1])}`, `${sub}/${f}`);
		}
	}
	return out;
}

// ---------------------------------------------------------------- numbers
function met(c: any): string {
	if (!c || typeof c !== 'object') return 'no';
	const v = c.met ?? 'no';
	return v === true ? 'yes' : v === false ? 'no' : String(v);
}
function wave(s: State, nid: string): string {
	let n: Node | undefined = s.nodes.get(nid);
	while (n) {
		if (n.wave) return n.wave;
		n = n.parent ? s.nodes.get(n.parent) : undefined;
	}
	return 'now';
}
function scopeAt(s: State, d: D, w?: string): [number, number] {
	let lo = 0, hi = 0;
	for (const u of s.units) {
		const n = s.nodes.get(u)!;
		if (n.added > d || (n.removed && n.removed <= d)) continue;
		if (w && wave(s, u) !== w) continue;
		lo += n.size![0];
		hi += n.size![1];
	}
	return [lo, hi];
}
function doneAt(s: State, d: D, w?: string): number {
	let tot = 0;
	for (const u of s.units) {
		const n = s.nodes.get(u)!;
		const [st, dd] = n.state;
		if (st === 'done' && dd && dd <= d && (!w || wave(s, u) === w)) tot += mid(n.size!);
	}
	return tot;
}
function epicOf(s: State, nid: string): string {
	let n = s.nodes.get(nid)!;
	while (n.parent) n = s.nodes.get(n.parent)!;
	return n.id;
}
function weeks(s: State): [D, number][] {
	const out: [D, number][] = [];
	let m = monday(s.start);
	while (m <= s.today) {
		out.push([m, doneAt(s, addDays(m, 6)) - doneAt(s, addDays(m, -1))]);
		m = addDays(m, 7);
	}
	return out;
}
function forecast(s: State, w?: string) {
	const [lo, hi] = scopeAt(s, s.today, w);
	const done = doneAt(s, s.today, w);
	const rem: [number, number] = [Math.max(0, lo - done), Math.max(0, hi - done)];
	const wk = weeks(s);
	let full = wk.filter(([m]) => addDays(m, 6) < s.today).map(([, v]) => v);
	if (!full.length) full = wk.map(([, v]) => v);
	const elapsed = Math.max(1, days(s.today, s.start) / 7);
	const totalDone = doneAt(s, s.today);
	let mean = totalDone / elapsed;
	let rateLo = Math.max(full.length ? Math.min(...full) : mean, mean * 0.25, 0.1);
	let rateHi = Math.max(full.length ? Math.max(...full) : mean, mean);
	if (w) {
		const share = totalDone ? done / totalDone : 1;
		mean = mean * share || 0.1;
		rateLo = rateLo * share || 0.1;
		rateHi = rateHi * share || 0.1;
	}
	const at = (pts: number, rate: number) => (rate > 0 ? addDays(s.today, Math.round((7 * pts) / rate)) : null);
	return { scope: [lo, hi] as [number, number], done, remaining: rem, rate: [rateLo, mean, rateHi], weeksOfData: full.length, opt: at(rem[0], rateHi), base: at((rem[0] + rem[1]) / 2, mean), pess: at(rem[1] * 1.5, rateLo) };
}

// ---------------------------------------------------------------- links
function refHtml(s: State, ref: any, here: string): string {
	const r = String(ref).trim();
	const rel = (p: string) => path.posix.relative(path.posix.dirname(here), p.endsWith('.md') ? p.slice(0, -3) + '.html' : p);
	let m = /^#(\d+)$/.exec(r);
	if (m) return s.issuesUrl ? `<a href="${s.issuesUrl}${m[1]}" target="_blank">${r}</a>` : h(r);
	m = /^(ADR|VR|EXP|P)-(\d{4})$/.exec(r) || /^([GRA])\s?(\d+)$/.exec(r);
	if (m) {
		const p = s.docs.get(`${m[1]}:${Number(m[2])}`);
		if (p) return `<a href="${rel(p)}">${h(r)}</a>`;
	}
	m = /^(?:배경|bg)\s?(\d+)$/.exec(r);
	if (m && s.docs.get(`BG:${Number(m[1])}`)) return `<a href="${rel(s.docs.get(`BG:${Number(m[1])}`)!)}">${h(r)}</a>`;
	return h(r);
}
function itemLink(s: State, n: Node, here: string): string {
	let t = h(String(n.title));
	if (n.roadmap) t = `<a href="${path.posix.relative(path.posix.dirname(here), `roadmap/items/${n.roadmap}.html`)}">${t}</a>`;
	if (n.issue !== undefined && n.issue !== null) t += ' ' + refHtml(s, `#${n.issue}`, here);
	return t;
}
const chip = (st: string) => `<span class="pl-st pl-st-${st}">${STATUS_KO[st] ?? st}</span>`;
const sizeTxt = (sz: [number, number] | null) => (!sz ? '' : sz[0] === sz[1] ? g(sz[0]) : `${g(sz[0])}~${g(sz[1])}`);
function nodeSize(s: State, nid: string): [number, number] | null {
	const n = s.nodes.get(nid)!;
	if (n.size) return n.size;
	let lo = 0, hi = 0;
	for (const c of n.children) {
		const z = nodeSize(s, c);
		if (z && s.nodes.get(c)!.state[0] !== 'dropped') {
			lo += z[0];
			hi += z[1];
		}
	}
	return hi ? [lo, hi] : null;
}
function nodeDone(s: State, nid: string): number {
	const n = s.nodes.get(nid)!;
	if (n.size) return n.state[0] === 'done' ? mid(n.size) : 0;
	return n.children.reduce((t, c) => t + nodeDone(s, c), 0);
}

// ---------------------------------------------------------------- sections
function summary(s: State): string {
	const f = forecast(s), fn = forecast(s, 'now');
	const risks = s.risks.filter((r) => r.status !== 'closed');
	const hiN = risks.filter((r) => r.p * r.i >= 10).length;
	const occ = risks.filter((r) => r.status === 'occurred').length;
	const qs = s.sc.questions || [];
	const qc: Record<string, number> = {};
	for (const q of qs) qc[q.status ?? 'open'] = (qc[q.status ?? 'open'] ?? 0) + 1;
	const [lo, hi] = f.scope;
	const pct = (d: number, t: number) => (t ? `${f0((100 * d) / t)}%` : '-');
	const conf = f.weeksOfData < 6 ? '낮음' : '보통';
	const cards: [string, string, string, string][] = [
		['전체 작업량', `${g(lo)}~${g(hi)}`, `포인트 (먼 단계는 폭으로), 끝낸 일 ${g(f.done)} (${pct(f.done, (lo + hi) / 2)})`, '#작업량과-진척'],
		['지금 하는 일', `${g(fn.done)} / ${g(fn.scope[0])}~${g(fn.scope[1])}`, `끝냄 ${pct(fn.done, mid(fn.scope))}, 끝날 예측 ${iso(fn.opt)} ~ ${iso(fn.pess)}`, '#작업량과-진척'],
		['처리량', f1(f.rate[1]), `포인트/주 (폭 ${f1(f.rate[0])}~${f1(f.rate[2])}), 데이터 ${f.weeksOfData}주, 신뢰 ${conf}`, '#작업량과-진척'],
		['과제 끝 예측', iso(f.base), `낙관 ${iso(f.opt)} · 비관(작업량 +50%) ${iso(f.pess)}`, '#작업량과-진척'],
		['리스크', String(risks.length), `높음 이상 ${hiN}, 일어남 ${occ}`, '#리스크'],
		['연구 질문', `${qc.answered ?? 0}/${qs.length}`, `답함, 조사 중 ${qc.investigating ?? 0}, 열림 ${qc.open ?? 0}`, '#연구-질문'],
	];
	const out = ['<div class="pl-cards">'];
	for (const [t, v, sub, href] of cards)
		out.push(`<a class="pl-card pl-card-link" href="${href}"><div class="pl-card-t">${t}</div><div class="pl-card-v">${h(v)}</div><div class="pl-card-s">${h(sub)}</div></a>`);
	out.push('</div>');
	const src = `기준일 ${iso(s.today)}. 상태: 로드맵, 이슈 스냅숏 ${(s.taken || '없음').slice(0, 16).replace('T', ' ')}`;
	out.push(`<p class="pl-note">${h(src)}. 포인트 = ${h(str(s.sc.unit_note))}</p>`);
	return out.join('\n');
}

function burnup(s: State, w?: string): string {
	const start = s.start, today = s.today;
	const f = forecast(s, w);
	let end = [addDays(today, 28), ...[f.opt, f.base, f.pess].filter((x): x is D => !!x)].reduce((a, b) => (b > a ? b : a));
	if (end > addDays(start, 7 * 60)) end = addDays(start, 7 * 60);
	const W = 760, H = 306, L = 52, R = 16, T = 24, B = 34;
	const nd = Math.max(1, days(end, start));
	const smax = Math.max(scopeAt(s, today, w)[1] * 1.6, 1);
	const x = (d: D) => L + ((W - L - R) * days(d, start)) / nd;
	const y = (v: number) => T + (H - T - B) * (1 - v / smax);
	const pLo: [number, number][] = [], pHi: [number, number][] = [], pDone: [number, number][] = [];
	const dLo: number[] = [], dHi: number[] = [], dDone: number[] = [];
	for (let d = start; d <= today; d = addDays(d, 1)) {
		const [lo, hi] = scopeAt(s, d, w);
		const dn = doneAt(s, d, w);
		pLo.push([x(d), y(lo)]);
		pHi.push([x(d), y(hi)]);
		pDone.push([x(d), y(dn)]);
		dLo.push(lo);
		dHi.push(hi);
		dDone.push(dn);
	}
	const [lo, hi] = f.scope;
	pLo.push([x(end), y(lo)]);
	pHi.push([x(end), y(hi)]);
	const pts = (a: [number, number][]) => a.map(([p, q]) => `${f1(p)},${f1(q)}`);
	const band = 'M' + pts(pHi).join(' L') + ' L' + pts([...pLo].reverse()).join(' L') + ' Z';
	const o = [`<svg class="pl-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="계획 작업량과 끝낸 일">`];
	for (let k = 0; k < 5; k++) {
		const v = (smax * k) / 4;
		o.push(`<line class="pl-grid" x1="${L}" x2="${W - R}" y1="${f1(y(v))}" y2="${f1(y(v))}"/><text class="pl-ax" x="${L - 6}" y="${f1(y(v) + 4)}" text-anchor="end">${f0(v)}</text>`);
	}
	let m = monday(start);
	let k = 0;
	while (m <= end) {
		if (m >= start && k % Math.max(1, Math.round(nd / 7 / 10)) === 0)
			o.push(`<text class="pl-ax" x="${f1(x(m))}" y="${H - 12}" text-anchor="middle">${m.getUTCMonth() + 1}/${m.getUTCDate()}</text>`);
		m = addDays(m, 7);
		k++;
	}
	o.push(`<text class="pl-ax pl-ax-t" x="${L - 6}" y="${T - 6}" text-anchor="end">포인트</text><text class="pl-ax pl-ax-t" x="${W - R}" y="${H - 2}" text-anchor="end">날짜 (주 시작일)</text>`);
	o.push(`<path class="pl-scope" d="${band}"/>`, `<polyline class="pl-scope-lo" points="${pts(pLo).join(' ')}"/>`, `<polyline class="pl-scope-hi" points="${pts(pHi).join(' ')}"/>`);
	const bls: any[] = [];
	for (const b of s.sc.baselines || []) {
		const bd = date(b.date);
		if (bd && bd >= start && bd <= end) {
			bls.push([days(bd, start), str(b.id), str(b.note)]);
			o.push(`<line class="pl-base" x1="${f1(x(bd))}" x2="${f1(x(bd))}" y1="${T}" y2="${H - B}"/><text class="pl-base-t" x="${f1(x(bd) + 3)}" y="${T + 10}">${h(str(b.id))}</text>`);
		}
	}
	o.push(`<polyline class="pl-done" points="${pts(pDone).join(' ')}"/>`);
	const dn = f.done;
	const [remLo, remHi] = f.remaining;
	const fcs: any[] = [];
	for (const [kk, cls, lab, tgt0] of [['opt', 'pl-fc-opt', '낙관', dn + remLo], ['base', 'pl-fc-base', '기준', dn + (remLo + remHi) / 2], ['pess', 'pl-fc-pess', '비관', dn + remHi * 1.5]] as [string, string, string, number][]) {
		let fd = (f as any)[kk] as D | null;
		if (!fd) continue;
		let tgt = tgt0;
		fcs.push([lab, days(fd, start), Math.round(tgt * 10) / 10]);
		if (fd > end) {
			const frac = days(end, today) / Math.max(1, days(fd, today));
			fd = end;
			tgt = dn + (tgt - dn) * frac;
		}
		const fx = x(fd), fy = y(Math.min(tgt, smax));
		o.push(`<line class="pl-fc ${cls}" x1="${f1(x(today))}" y1="${f1(y(dn))}" x2="${f1(fx)}" y2="${f1(fy)}"/><circle class="pl-fc-dot" cx="${f1(fx)}" cy="${f1(fy)}" r="2.5"/><text class="pl-fc-t" x="${f1(fx - 4)}" y="${f1(fy - 5)}" text-anchor="end">${lab} ${iso((f as any)[kk]).slice(5)}</text>`);
	}
	o.push(`<line class="pl-today" x1="${f1(x(today))}" x2="${f1(x(today))}" y1="${T}" y2="${H - B}"/><text class="pl-today-t" x="${f1(x(today) + 3)}" y="${H - B - 4}">오늘</text>`);
	o.push(`<g class="pl-hover" style="display:none"><line class="pl-hover-x" x1="0" x2="0" y1="${T}" y2="${H - B}"/><circle class="pl-hover-done" r="4"/></g>`, '</svg>');
	const data = { start: iso(start), days: nd, L, R, W, T, B, H, smax, lo: dLo, hi: dHi, done: dDone, end: [lo, hi], fc: fcs, base: bls };
	const legend =
		'<div class="pl-legend"><span class="pl-lg pl-lg-scope">계획 작업량 (최소~최대 폭)</span><span class="pl-lg pl-lg-done">끝낸 일</span>' +
		'<span class="pl-lg pl-lg-fc">예측: 낙관 · 기준 · 비관(작업량 +50%)</span><span class="pl-lg pl-lg-base">기준선: 계획을 다시 정한 날</span></div>';
	const tab =
		`<p class="pl-note">계획 작업량 ${g(lo)}~${g(hi)} 포인트, 끝냄 ${g(dn)}, 남음 ${g(remLo)}~${g(remHi)}. ` +
		`처리량 ${f1(f.rate[0])} / ${f1(f.rate[1])} / ${f1(f.rate[2])} 포인트/주(낮음/평균/높음, 다 지난 주 ${f.weeksOfData}개). ` +
		`끝나는 날: 낙관 ${iso(f.opt)}, 기준 ${iso(f.base)}, 비관 ${iso(f.pess)}. ` +
		'세로축은 진척률이 아니라 일의 크기(포인트)이고, 진척은 끝낸 일 선과 계획 작업량 띠 사이의 간격입니다. ' +
		'띠가 올라가면 계획이 늘어난 것, 선이 평평하면 일이 끝나지 않은 것입니다. 마우스를 올리면 그날 숫자가 나옵니다.</p>';
	return `<div class="pl-chart" data-burnup="${attr(JSON.stringify(data))}">${o.join('')}</div>${legend}${tab}`;
}

function burnups(s: State): string {
	return (
		'<div class="pl-tabs" data-tabs><div class="pl-tabbar" role="tablist"><button type="button" data-tab="0" class="on">지금 하는 일 (시기: 지금)</button>' +
		'<button type="button" data-tab="1">과제 전체 (먼 단계는 폭으로)</button></div>' +
		`<div class="pl-tab" data-pane="0"><h3 class="pl-tab-h">지금 하는 일 (시기: 지금)</h3>${burnup(s, 'now')}</div>` +
		`<div class="pl-tab" data-pane="1"><h3 class="pl-tab-h">과제 전체 (먼 단계는 폭으로)</h3>${burnup(s)}</div></div>`
	);
}

function critHtml(s: State, n: Node, here: string): string {
	const lis = (n.dod || []).map((c0: any) => {
		const mt = met(c0);
		const c = c0 && typeof c0 === 'object' ? c0 : { text: c0 };
		const [sym, lab] = MET[mt] ?? MET.no;
		const ev = (c.evidence || []).map((e: any) => refHtml(s, e, here)).join(' ');
		return `<li class="pl-met-${mt}"><span class="pl-sym" title="${lab}">${sym}</span> ${h(str(c.text))} <span class="pl-ev">${ev}</span></li>`;
	});
	return lis.length ? `<ul class="pl-crit">${lis.join('')}</ul>` : '';
}
function searchText(s: State, nid: string): string {
	const n = s.nodes.get(nid)!;
	const parts = [nid, str(n.title)];
	if (n.issue !== undefined && n.issue !== null) parts.push(`#${n.issue}`);
	if (n.roadmap) parts.push(str(n.roadmap));
	for (const c of n.dod || []) {
		parts.push(str(c && typeof c === 'object' ? c.text : c));
		if (c && typeof c === 'object') parts.push(...(c.evidence || []).map(String));
	}
	return parts.join(' ').toLowerCase();
}
function counts(s: State, nid: string): string {
	const c: Record<string, number> = {};
	const walk = (x: string) => {
		for (const k of s.nodes.get(x)!.children) {
			if (s.nodes.get(k)!.state[0] !== 'dropped') c[s.nodes.get(k)!.level] = (c[s.nodes.get(k)!.level] ?? 0) + 1;
			walk(k);
		}
	};
	walk(nid);
	const parts = LEVELS.slice(1).filter((lv) => c[lv]).map((lv) => `${LEVEL_KO[lv]} ${c[lv]}`);
	return parts.length ? `<span class="pl-cnt" title="아래에 있는 항목 수 (펼치면 보임)">${parts.join(' · ')}</span>` : '';
}
function dodHtml(s: State, n: Node, here: string): string {
	const items = n.dod || [];
	if (!items.length) return '';
	const lis = items.map((c: any) => {
		if (c && typeof c === 'object') {
			const ev = (c.evidence || []).map((e: any) => refHtml(s, e, here)).join(' ');
			return `<li>${(MET[met(c)] ?? MET.no)[0]} ${h(str(c.text))} ${ev}</li>`;
		}
		return `<li>${h(str(c))}</li>`;
	});
	return `<ul class="pl-dod"><span class="pl-dod-t">완료 정의</span>${lis.join('')}</ul>`;
}
function nodeHtml(s: State, nid: string, depth: number, here: string): string {
	const n = s.nodes.get(nid)!;
	const [st, d] = n.state;
	const sz = nodeSize(s, nid);
	const meta = [`<span class="pl-lv pl-lv-${n.level}">${LEVEL_KO[n.level]}</span>`];
	if (n.kind) meta.push(`<span class="pl-kind">${KIND_KO[n.kind] ?? h(n.kind)}</span>`);
	meta.push(chip(st));
	if (d && st === 'done') meta.push(`<span class="pl-date">${iso(d)}</span>`);
	if (sz) meta.push(`<span class="pl-size" title="크기 (포인트)">${sizeTxt(sz)}</span>`);
	if (n.removed) meta.push(`<span class="pl-rm">뺌 ${iso(n.removed)}: ${h(str(n.reason))}</span>`);
	else if (n.added > s.start) meta.push(`<span class="pl-add">추가 ${iso(n.added)}</span>`);
	if (n.children.length) meta.push(counts(s, nid));
	const head = `<span class="pl-id">${h(nid)}</span> ${itemLink(s, n, here)} ${meta.join(' ')}`;
	const body = dodHtml(s, n, here);
	const kids = n.children.map((c) => nodeHtml(s, c, depth + 1, here)).join('');
	const attrs = `data-st="${st}" data-wave="${wave(s, nid)}" data-q="${attr(searchText(s, nid))}"`;
	if (!body && !kids) return `<div class="pl-leaf pl-dep-${depth}" ${attrs}>${head}</div>`;
	return `<details class="pl-node pl-dep-${depth}" ${attrs}><summary>${head}</summary><div class="pl-body">${body}${kids}</div></details>`;
}

function stages(s: State, here: string): string {
	const epics = s.order.filter((nid) => s.nodes.get(nid)!.level === 'epic');
	const legend = s.sc.legend || [];
	const out: string[] = [];
	if (legend.length) out.push('<div class="pl-key"><b>ID 읽는 법</b> ' + legend.map((e: any) => `<span><code>${h(str(e.key))}</code> ${h(str(e.text))}</span>`).join(' ') + '</div>');
	const ov = ['<div class="pl-overview">'];
	const stat = (nid: string) => {
		const n = s.nodes.get(nid)!;
		const sz = nodeSize(s, nid), done = nodeDone(s, nid);
		const pct = sz && mid(sz) ? (100 * done) / mid(sz) : 0;
		const crit = n.dod || [];
		return { n, sz, done, pct, crit, metN: crit.filter((c: any) => met(c) === 'yes').length, part: crit.filter((c: any) => met(c) === 'partial').length };
	};
	for (const nid of epics) {
		const { n, pct, crit, metN, part } = stat(nid);
		const short = str(n.short ?? n.title).split(' - ')[0];
		ov.push(
			`<a class="pl-ov pl-wave-${n.wave ?? 'now'} pl-st-b-${n.state[0]}" href="#ep-${nid.toLowerCase()}" data-tip="${attr(n.title)}"><span class="pl-ov-id">${h(nid)}</span>` +
				`<span class="pl-ov-t">${h(short)}</span><span class="pl-bar"><span style="width:${f0(Math.min(100, pct))}%"></span></span>` +
				`<span class="pl-ov-m">${f0(pct)}% · 기준 ${metN}${part ? '+' + part : ''}/${crit.length}</span></a>`,
		);
	}
	ov.push('</div>');
	out.push(ov.join(''));
	const dod = (s.sc.team_dod || []).map((t: any) => `<li>${h(str(t))}</li>`).join('');
	if (dod) out.push(`<details class="pl-teamdod"><summary>팀 공통 완료 정의 (모든 Backlog·WBS에 적용)</summary><ul>${dod}</ul></details>`);
	out.push('<div class="pl-toolbar" data-tree-tools></div>', '<div class="pl-tree">');
	for (const nid of epics) {
		const { n, sz, done, pct, crit, metN, part } = stat(nid);
		const w = n.wave ?? 'now';
		const meta = `${KIND_KO[n.kind ?? ''] ?? ''} · 시기 ${WAVE_KO[w] ?? ''}${n.track ? ' · 트랙 ' + h(str(n.track)) : ''} · 크기 ${sizeTxt(sz)} 포인트`;
		const kids = n.children.map((c) => nodeHtml(s, c, 1, here)).join('');
		out.push(
			`<details class="pl-stage pl-wave-${w}" id="ep-${nid.toLowerCase()}" data-st="${n.state[0]}" data-wave="${w}" data-q="${attr(searchText(s, nid))}"${w === 'now' ? ' open' : ''}>` +
				`<summary><div class="pl-stage-h"><span class="pl-stage-id">${h(nid)}</span><span class="pl-stage-t">${h(str(n.title))}</span>${chip(n.state[0])}</div>` +
				`<div class="pl-stage-m">${meta}</div><div class="pl-stage-p"><span class="pl-bar"><span style="width:${f0(Math.min(100, pct))}%"></span></span>` +
				`<span>끝낸 일 ${g(done)} 포인트 (${f0(pct)}%) · 통과 기준 ${metN}/${crit.length} 충족${part ? `, ${part} 일부` : ''}</span>${counts(s, nid)}</div></summary>` +
				`<div class="pl-stage-b"><div class="pl-stage-sec">통과 기준 (이 단계를 마쳤다고 말할 조건)</div>${critHtml(s, n, here)}` +
				`<div class="pl-stage-sec">작업 분해 (Feature > Story > Backlog > WBS, ▸를 누르면 아래 단계가 펼쳐짐)</div><div class="pl-body">${kids}</div></div></details>`,
		);
	}
	out.push('</div>');
	return out.join('\n');
}

function questions(s: State, here: string): string {
	const rows = ["<table class='pl-table'><thead><tr><th>질문</th><th>상태</th><th>확신</th><th>근거</th><th>관련 단계·항목</th></tr></thead><tbody>"];
	for (const q of s.sc.questions || []) {
		const ev = (q.evidence || []).map((e: any) => refHtml(s, e, here)).join(' ');
		const note = q.note ? `<div class="pl-sub">${h(str(q.note))}</div>` : '';
		const items = (q.items || []).map((i: any) => {
			const ep = s.nodes.has(String(i)) ? epicOf(s, String(i)) : null;
			return ep ? `<a href="#ep-${ep.toLowerCase()}" data-open="${attr(i)}">${h(str(i))}</a>` : h(str(i));
		});
		const st = q.status ?? 'open';
		rows.push(
			`<tr><td><b>${h(str(q.id))}</b> ${h(str(q.title))}${note}</td><td><span class="pl-q pl-q-${st}">${Q_KO[st] ?? st}</span></td>` +
				`<td>${CONF_KO[q.confidence ?? 'low'] ?? ''}</td><td>${ev}</td><td>${items.join(', ')}</td></tr>`,
		);
	}
	rows.push('</tbody></table>');
	return rows.join('');
}

function changes(s: State, here: string): string {
	const rows = ["<table class='pl-table'><thead><tr><th>날짜</th><th>기준선</th><th>변경</th><th>항목</th><th>크기</th><th>이유</th></tr></thead><tbody>"];
	const bl = (s.sc.baselines || []).map((b: any) => [date(b.date), b] as [D | null, any]).sort((a: any, b: any) => (a[0] ?? s.start).getTime() - (b[0] ?? s.start).getTime());
	const ev: [D, string, Node][] = [];
	for (const u of s.units) {
		const n = s.nodes.get(u)!;
		if (n.added > s.start) ev.push([n.added, '추가', n]);
		if (n.removed) ev.push([n.removed, '뺌', n]);
	}
	ev.sort((a, b) => a[0].getTime() - b[0].getTime() || a[1].localeCompare(b[1]));
	for (const [d, what, n] of ev) {
		const b = [...bl].reverse().find(([bd]) => bd && bd <= d)?.[1]?.id ?? '';
		rows.push(`<tr><td>${iso(d)}</td><td>${h(str(b))}</td><td>${what}</td><td>${itemLink(s, n, here)}</td><td>${what === '추가' ? '+' : '−'}${sizeTxt(n.size)}</td><td>${h(str(n.reason))}</td></tr>`);
	}
	rows.push('</tbody></table>');
	const bls = bl
		.map(([bd, b]) => {
			const [lo, hi] = bd ? scopeAt(s, bd) : [0, 0];
			return `<li><b>${h(str(b.id))}</b> ${iso(bd)}: ${h(str(b.note))} (그날 계획 작업량 ${g(lo)}~${g(hi)})</li>`;
		})
		.join('');
	return `<ul class="pl-bl">${bls}</ul>` + rows.join('');
}

// ---------------------------------------------------------------- risks
function band(s: State, score: number): string {
	const bands = s.rk.bands || { low: [1, 4], medium: [5, 9], high: [10, 14], critical: [15, 25] };
	for (const [name, [a, b]] of Object.entries(bands) as [string, [number, number]][]) if (a <= score && score <= b) return name;
	return 'low';
}
const riskTip = (r: Risk) =>
	`${r.id} ${r.title}\n${str(r.cause)} → ${str(r.effect)}\n대응(${R_RESP[r.response] ?? ''}): ${str(r.actions)}\n가능성 ${r.p} × 영향 ${r.i} = ${r.p * r.i}, ${R_STATUS[r.status] ?? ''}`;

function riskSummary(s: State): string {
	const rs = s.risks.filter((r) => r.status !== 'closed');
	const by: Record<string, number> = {}, st: Record<string, number> = {}, cat: Record<string, number> = {};
	for (const r of rs) by[band(s, r.p * r.i)] = (by[band(s, r.p * r.i)] ?? 0) + 1;
	for (const r of s.risks) st[r.status] = (st[r.status] ?? 0) + 1;
	for (const r of rs) cat[r.category ?? '-'] = (cat[r.category ?? '-'] ?? 0) + 1;
	const cards = BANDS.map(([k, lab]) => `<button type="button" class="pl-card pl-band-${k}" data-rfilter="band" data-rval="${k}" title="대장에서 ${lab}만 보기"><div class="pl-card-t">${lab}</div><div class="pl-card-v">${by[k] ?? 0}</div></button>`).join('');
	const s2 = Object.keys(R_STATUS).filter((k) => st[k]).map((k) => `${R_STATUS[k]} ${st[k]}`).join(' · ');
	const s3 = Object.entries(cat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${h(k)} ${v}`).join(' · ');
	return `<div class="pl-cards pl-cards-risk">${cards}</div><p class="pl-note">상태: ${s2}. 분류: ${s3}. 카드나 매트릭스 칸을 누르면 아래 대장이 그 리스크만 보입니다.</p>`;
}
function riskMatrix(s: State): string {
	const cells = new Map<string, Risk[]>();
	for (const r of s.risks) if (r.status !== 'closed') cells.set(`${r.p},${r.i}`, [...(cells.get(`${r.p},${r.i}`) ?? []), r]);
	const plab: string[] = s.rk.scales?.p ?? ['1', '2', '3', '4', '5'];
	const ilab: string[] = s.rk.scales?.i ?? ['1', '2', '3', '4', '5'];
	const o = ['<div class="pl-pi-wrap"><table class="pl-pi"><tbody>'];
	for (let i = 5; i >= 1; i--) {
		o.push(`<tr><th class="pl-pi-y" data-tip="${attr(ilab[i - 1])}">영향 ${i}</th>`);
		for (let p = 1; p <= 5; p++) {
			const b = band(s, p * i);
			const ids = (cells.get(`${p},${i}`) ?? []).sort((a, c) => a.id.localeCompare(c.id)).map((r) => `<a href="#${r.id.toLowerCase()}" data-tip="${attr(riskTip(r))}">${h(r.id)}</a>`).join(' ');
			o.push(`<td class="pl-band-${b}${ids ? ' pl-pi-has' : ''}" data-rfilter="pi" data-rval="${p},${i}"><span class="pl-pi-s">${p * i}</span>${ids}</td>`);
		}
		o.push('</tr>');
	}
	o.push('<tr><th></th>' + [1, 2, 3, 4, 5].map((p) => `<th class="pl-pi-x" data-tip="${attr(plab[p - 1])}">가능성 ${p}</th>`).join('') + '</tr></tbody></table></div>');
	const key = '<div class="pl-legend">' + BANDS.map(([k, lab]) => `<span class="pl-lg pl-lgb-${k}">${lab}</span>`).join('') + '<span>점수 = 가능성 × 영향. 축 이름과 ID에 마우스를 올리면 설명이 나옵니다</span></div>';
	const scales = "<details class='pl-scales'><summary>척도</summary><table class='pl-table'><tr><th>점</th><th>가능성</th><th>영향</th></tr>" + [0, 1, 2, 3, 4].map((k) => `<tr><td>${k + 1}</td><td>${h(str(plab[k]))}</td><td>${h(str(ilab[k]))}</td></tr>`).join('') + '</table></details>';
	return o.join('') + key + scales;
}
function trendTxt(r: Risk): string {
	const hs = r.history;
	if (hs.length < 2) return '';
	const a = hs[hs.length - 2].p * hs[hs.length - 2].i, b = hs[hs.length - 1].p * hs[hs.length - 1].i;
	const tip = hs.map((x) => `${iso(x.date)} ${x.p * x.i}` + (x.note ? ` (${x.note})` : '')).join(' → ');
	return `<span class="pl-trend" data-tip="${attr(tip)}">${b < a ? '▼' : b > a ? '▲' : '='}</span>`;
}
function riskRow(s: State, r: Risk, here: string, full = true): string {
	const sc = r.p * r.i;
	const links = (r.links || []).map((x: any) => refHtml(s, x, here)).join(' ');
	const q = ['id', 'title', 'cause', 'effect', 'actions', 'owner'].map((k) => str(r[k])).join(' ').toLowerCase();
	return (
		`<tr id="${r.id.toLowerCase()}" data-band="${band(s, sc)}" data-pi="${r.p},${r.i}" data-cat="${attr(str(r.category))}" data-status="${attr(str(r.status))}" data-q="${attr(q)}"><td><b>${h(r.id)}</b></td><td>${h(r.title)}` +
		(full ? `<div class="pl-sub">${h(str(r.cause))} → ${h(str(r.effect))}</div>` : '') +
		`</td><td>${h(str(r.category))}</td><td data-v="${r.p}">${r.p}</td><td data-v="${r.i}">${r.i}</td>` +
		`<td data-v="${sc}"><span class="pl-score pl-band-${band(s, sc)}">${sc}</span> ${trendTxt(r)}</td>` +
		`<td>${R_RESP[r.response] ?? h(str(r.response))}: ${h(str(r.actions))}</td><td>${h(str(r.owner))}</td><td>${R_STATUS[r.status] ?? h(str(r.status))}</td><td>${links}</td></tr>`
	);
}
const RHEAD =
	"<table class='pl-table pl-risks' data-register><thead><tr><th data-sort>ID</th><th>리스크 (원인 → 영향)</th><th data-sort>분류</th>" +
	'<th data-sort>가능성</th><th data-sort>영향</th><th data-sort>점수</th><th>대응</th><th data-sort>담당</th><th data-sort>상태</th><th>관련</th></tr></thead><tbody>';
function riskTop(s: State, here: string): string {
	const rs = s.risks.filter((r) => r.status !== 'closed' && r.p * r.i >= 10).sort((a, b) => b.p * b.i - a.p * a.i || a.id.localeCompare(b.id));
	return RHEAD.replace(' data-register', '') + rs.map((r) => riskRow(s, r, here, false)).join('') + '</tbody></table>';
}
function riskRegister(s: State, here: string): string {
	const rs = [...s.risks].sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.p * b.i - a.p * a.i || a.id.localeCompare(b.id));
	const src = path.posix.relative(path.posix.dirname(here), 'plan/index.html');
	const note =
		`<p class="pl-note">원천: <code>docs/plan/risks.yml</code>. PI 매트릭스와 추이는 <a href="${src}#리스크">현황판</a>. ` +
		'점수 = 가능성 × 영향 (1~25), ▼▲ = 지난 평가 대비(마우스를 올리면 이력). 열 이름을 누르면 정렬합니다.</p>';
	const cats = [...new Set(s.risks.map((r) => str(r.category)))].sort();
	return note + `<div class="pl-toolbar" data-risk-tools data-cats="${attr(JSON.stringify(cats))}"></div>` + RHEAD + rs.map((r) => riskRow(s, r, here)).join('') + '</tbody></table>';
}
function riskTrend(s: State): string {
	const all = s.risks.flatMap((r) => r.history.map((x) => x.date)).filter((x): x is D => !!x);
	const dates = [...new Set(all.map((d) => d.getTime()))].sort((a, b) => a - b).map((t) => new Date(t));
	if (!dates.length) return '';
	const full = new Date(Math.max(...s.risks.filter((r) => r.history.length).map((r) => r.history[0].date.getTime())));
	const pts: [D, number][] = [];
	for (const d of dates.filter((x) => x >= full)) {
		let tot = 0;
		for (const r of s.risks) {
			const hs = r.history.filter((x) => x.date <= d);
			if (hs.length && r.status !== 'closed') tot += hs[hs.length - 1].p * hs[hs.length - 1].i;
		}
		pts.push([d, tot]);
	}
	const events = s.risks.flatMap((r) => r.history.filter((x) => x.date < full).map((x) => [x.date, r.id, x.note ?? ''] as [D, string, string])).sort((a, b) => a[0].getTime() - b[0].getTime());
	const ev = events.map(([d, i, n]) => `<li>${iso(d)} ${h(i)}: ${h(str(n))}</li>`).join('');
	const txt = pts.map(([d, v]) => `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${v}`).join(' → ');
	const msg = `<p class="pl-note">노출 합계(열린 리스크의 가능성 × 영향 합): ${txt}. 평가가 쌓이면 추세가 보입니다 (점수를 바꿀 때 history에 한 줄 더함).</p>`;
	return msg + (ev ? `<p class="pl-note">전체 평가 이전에 기록된 사건:</p><ul class="pl-note">${ev}</ul>` : '');
}

// ---------------------------------------------------------------- sprints and the board
function hasBacklogAnc(s: State, nid: string): boolean {
	let p = s.nodes.get(nid)!.parent;
	while (p) {
		if (s.nodes.get(p)!.level === 'backlog') return true;
		p = s.nodes.get(p)!.parent;
	}
	return false;
}
const cardIds = (s: State) => s.order.filter((nid) => s.nodes.get(nid)!.level === 'backlog' || (s.nodes.get(nid)!.level === 'wbs' && !hasBacklogAnc(s, nid)));

function loadSprints(s: State) {
	const p = path.join(DOCS_DIR, 'plan', 'sprints.json');
	if (!fs.existsSync(p)) return;
	let sj: any;
	try {
		sj = JSON.parse(fs.readFileSync(p, 'utf-8'));
	} catch (e: any) {
		warn('plan', 'plan/sprints.json', String(e.message));
		return;
	}
	const cards = new Set(cardIds(s));
	const sprints: any[] = [];
	let active = 0;
	let prevEnd: D | null = null;
	for (const sp of sj.sprints || []) {
		const sid = String(sp.id ?? '');
		keys(`sprint ${sid}`, sp, SPRINT_KEYS);
		const a = date(sp.start), b = date(sp.end);
		if (!(a && b && a <= b)) {
			warn('plan', null, `sprint ${sid}: start / end missing or reversed`);
			continue;
		}
		if (prevEnd && a <= prevEnd) warn('plan', null, `sprint ${sid} starts before the previous one ends`);
		prevEnd = b;
		if (!(sp.state in SPRINT_STATE_KO)) warn('plan', null, `sprint ${sid}: state '${sp.state}' (planned | active | closed)`);
		if (sp.state === 'active') active++;
		for (const [k, col] of Object.entries(sp.items || {})) {
			if (!cards.has(k)) warn('plan', null, `sprint ${sid}: ${k} is not a backlog item or a WBS item outside a backlog`);
			if (!SPRINT_COLS.includes(col as string)) warn('plan', null, `sprint ${sid}: ${k} in column '${col}' (${SPRINT_COLS.join(' | ')})`);
		}
		sprints.push({ ...sp, id: sid, start: a, end: b });
	}
	if (active > 1) warn('plan', null, `${active} sprints are active (at most one)`);
	s.sprintCfg = sj;
	s.sprints = sprints;
}
const cardSize = (s: State, nid: string) => {
	const z = nodeSize(s, nid);
	return z ? mid(z) : 0;
};
function sprintStats(s: State, sp: any): [number, number, number] {
	const items: Record<string, string> = sp.items || {};
	const ks = Object.keys(items).filter((k) => s.nodes.has(k));
	return [
		ks.reduce((t, k) => t + cardSize(s, k), 0),
		ks.filter((k) => items[k] === 'done').reduce((t, k) => t + cardSize(s, k), 0),
		ks.filter((k) => items[k] === 'done' && s.nodes.get(k)!.state[0] !== 'done').length,
	];
}
function currentSprint(s: State): any {
	return s.sprints.find((x) => x.state === 'active') ?? s.sprints.find((x) => x.start <= s.today && s.today <= x.end) ?? null;
}
const boardHref = (here: string) => path.posix.relative(path.posix.dirname(here), 'plan/board/index.html');

function sprintNow(s: State, here: string): string {
	const sp = currentSprint(s);
	const link = `<a class="pl-btn pl-board-link" href="${boardHref(here)}" target="_blank">스프린트 보드 열기 (전체 화면, 끌어서 옮기기)</a>`;
	if (!sp) return `<div class="pl-sprint-now"><p class="pl-note">진행 중인 스프린트가 없습니다. 보드에서 시작합니다.</p>${link}</div>`;
	const cnt: Record<string, number> = {};
	for (const c of Object.values(sp.items || {}) as string[]) cnt[c] = (cnt[c] ?? 0) + 1;
	const [committed, done, proof] = sprintStats(s, sp);
	const left = days(sp.end, s.today);
	const cols = SPRINT_COLS.map((c) => `${COL_KO[c]} ${cnt[c] ?? 0}`).join(' · ');
	const blocked = Object.keys(sp.blocked || {}).length;
	const pct = committed ? (100 * done) / committed : 0;
	return (
		`<div class="pl-sprint-now"><div class="pl-sprint-h"><b>${h(sp.id)}</b> ${iso(sp.start)} ~ ${iso(sp.end)} <span class="pl-st pl-st-doing">${SPRINT_STATE_KO[sp.state] ?? ''}</span>` +
		`<span class="pl-note"> 남은 날 ${Math.max(0, left)}일</span></div><div class="pl-sprint-goal">목표: ${h(str(sp.goal || '(정하지 않음)'))}</div>` +
		`<div class="pl-stage-p"><span class="pl-bar"><span style="width:${f0(Math.min(100, pct))}%"></span></span><span>끝낸 ${g(done)} / 약속 ${g(committed)} 포인트 · ${cols}` +
		`${blocked ? ` · 막힘 ${blocked}` : ''}${proof ? ` · 근거 필요 ${proof}` : ''}</span></div>${link}</div>`
	);
}
function velocitySvg(s: State): string {
	const sp = s.sprints;
	if (!sp.length) return '';
	const W = 640, H = 170, L = 40, B = 28, T = 12;
	const vals = sp.map((x) => sprintStats(s, x).slice(0, 2) as [number, number]);
	const vmax = Math.max(1, ...vals.map((v) => Math.max(...v))) * 1.15;
	const bw = (W - L - 10) / Math.max(1, sp.length);
	const y = (v: number) => T + (H - T - B) * (1 - v / vmax);
	const o = [`<svg class="pl-svg pl-vel" viewBox="0 0 ${W} ${H}" role="img" aria-label="스프린트별 약속과 끝낸 포인트">`];
	for (let k = 0; k < 4; k++) {
		const v = (vmax * k) / 3;
		o.push(`<line class="pl-grid" x1="${L}" x2="${W - 10}" y1="${f1(y(v))}" y2="${f1(y(v))}"/><text class="pl-ax" x="${L - 6}" y="${f1(y(v) + 4)}" text-anchor="end">${f0(v)}</text>`);
	}
	sp.forEach((x, i) => {
		const [c, d] = vals[i];
		const x0 = L + i * bw + bw * 0.18, w = bw * 0.3;
		const tip = `${x.id} ${iso(x.start)}~${iso(x.end)}: 약속 ${g(c)}, 끝냄 ${g(d)} 포인트`;
		o.push(
			`<g data-tip="${attr(tip)}"><rect class="pl-vel-c" x="${f1(x0)}" y="${f1(y(c))}" width="${f1(w)}" height="${f1(y(0) - y(c))}" rx="2"/>` +
				`<rect class="pl-vel-d" x="${f1(x0 + w + 2)}" y="${f1(y(d))}" width="${f1(w)}" height="${f1(y(0) - y(d))}" rx="2"/></g>` +
				`<text class="pl-ax" x="${f1(x0 + w + 1)}" y="${H - 10}" text-anchor="middle">${h(x.id)}</text>`,
		);
	});
	o.push('</svg>');
	return '<div class="pl-chart">' + o.join('') + '</div><div class="pl-legend"><span class="pl-lg pl-lg-c">약속 (스프린트에 넣은 일)</span><span class="pl-lg pl-lg-d">끝냄</span><span>막대에 마우스를 올리면 숫자</span></div>';
}
function sprintsPage(s: State, here: string): string {
	const link = `<p><a class="pl-btn pl-board-link" href="${boardHref(here)}" target="_blank">스프린트 보드 열기 (전체 화면)</a></p>`;
	const rows = ["<table class='pl-table'><thead><tr><th>스프린트</th><th>기간</th><th>상태</th><th>목표</th><th>약속</th><th>끝냄</th><th>이월</th><th>막힘</th><th>회고</th></tr></thead><tbody>"];
	for (const sp of [...s.sprints].reverse()) {
		const [c, d, proof] = sprintStats(s, sp);
		const carried = (sp.carried || []).map((x: any) => h(str(x))).join(', ');
		const blocked = Object.entries(sp.blocked || {}).map(([k, v]) => `${h(k)}: ${h(str(v))}`).join('<br>');
		const r = sp.retro || {};
		const retro = ([['good', '잘됨'], ['problem', '문제'], ['try', '다음에']] as [string, string][]).filter(([k]) => r[k]).map(([k, lab]) => `<b>${lab}</b> ${h(str(r[k]))}`).join('<br>');
		const note = sp.note ? `<div class="pl-sub">${h(str(sp.note))}</div>` : '';
		rows.push(
			`<tr><td><a href="${boardHref(here)}#sprint=${h(sp.id)}" target="_blank"><b>${h(sp.id)}</b></a></td><td>${iso(sp.start)} ~ ${iso(sp.end)}</td><td>${SPRINT_STATE_KO[sp.state] ?? ''}</td>` +
				`<td>${h(str(sp.goal || ''))}${note}</td><td>${g(c)}</td><td>${g(d)}${proof ? ` (근거 필요 ${proof})` : ''}</td><td>${carried}</td><td>${blocked}</td><td>${retro}</td></tr>`,
		);
	}
	rows.push('</tbody></table>');
	return link + velocitySvg(s) + rows.join('');
}

const PALETTE = ['#6250d6', '#2a78d6', '#1baf7a', '#eb6834', '#c0328f', '#0b8a8a', '#b8860b', '#7a7a85', '#d93025', '#4f7a28'];

/** plan/board/data.js: window.PLAN_BOARD for the board page (assets/plan/board/). */
export function boardData(cfg: KitConfig = loadConfig()): string {
	const s = loadPlan(cfg);
	if (!s) return 'window.PLAN_BOARD = null;\n';
	const epics = s.order.filter((nid) => s.nodes.get(nid)!.level === 'epic');
	const ecol = new Map(epics.map((e, i) => [e, PALETTE[i % PALETTE.length]]));
	const rel = (p: string) => path.posix.relative('plan/board', p);
	const cards = cardIds(s).map((nid) => {
		const n = s.nodes.get(nid)!;
		const chain: string[] = [];
		let p = n.parent;
		while (p && s.nodes.get(p)!.level !== 'epic') {
			chain.push(str(s.nodes.get(p)!.title));
			p = s.nodes.get(p)!.parent;
		}
		const sz = nodeSize(s, nid);
		return {
			id: nid, title: str(n.title), level: n.level, kind: n.kind ?? '', wave: wave(s, nid), epic: epicOf(s, nid), chain: chain.reverse(), size: sz ? [...sz] : null,
			state: n.state[0], date: n.state[1] ? iso(n.state[1]) : '', issue: n.issue ?? null, roadmap: n.roadmap ? rel(`roadmap/items/${n.roadmap}.html`) : '',
			added: iso(n.added), removed: n.removed ? iso(n.removed) : '', dod: (n.dod || []).map((c: any) => str(c && typeof c === 'object' ? c.text : c)),
			subs: n.children.map((c) => ({ id: c, title: str(s.nodes.get(c)!.title), state: s.nodes.get(c)!.state[0], href: s.nodes.get(c)!.roadmap ? rel(`roadmap/items/${s.nodes.get(c)!.roadmap}.html`) : '' })),
		};
	});
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	const data = {
		today: iso(s.today), built: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
		issues_url: s.issuesUrl, team_dod: (s.sc.team_dod || []).map(String),
		epics: epics.map((e) => ({ id: e, short: str(s.nodes.get(e)!.short ?? s.nodes.get(e)!.title), title: str(s.nodes.get(e)!.title), color: ecol.get(e) })),
		cards, cols: SPRINT_COLS.map((c) => [c, COL_KO[c]]),
		sprints: JSON.parse(JSON.stringify((s.sprintCfg || {}).sprints || [])),
		cadence_days: Number((s.sprintCfg || {}).cadence_days || 7), wip_limit: Number((s.sprintCfg || {}).wip_limit || 3),
		save: (s.sprintCfg || {}).save || { port: 8002, from_ports: [8001] },
	};
	return 'window.PLAN_BOARD = ' + JSON.stringify(data) + ';\n';
}

export function planMarkers(cfg: KitConfig, page: { rel: string }): Record<string, MarkerHandler> {
	const s = loadPlan(cfg);
	if (!s) return {};
	const here = page.rel;
	return {
		'plan-summary': () => summary(s),
		'plan-burnup': () => burnups(s),
		'plan-stages': () => stages(s, here),
		'plan-epics': () => stages(s, here),
		'plan-tree': () => '',
		'plan-questions': () => questions(s, here),
		'plan-changes': () => changes(s, here),
		'risk-summary': () => riskSummary(s),
		'risk-matrix': () => riskMatrix(s),
		'risk-top': () => riskTop(s, here),
		'risk-trend': () => riskTrend(s),
		'risk-register': () => riskRegister(s, here),
		'plan-sprint-now': () => sprintNow(s, here),
		'plan-sprints': () => sprintsPage(s, here),
	};
}
