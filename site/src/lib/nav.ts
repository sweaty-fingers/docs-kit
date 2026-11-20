// The menu (prd.md FR-NAV, docs-kit-context §4.2-§4.4): the project's `nav` (or "개요" alone), then every tab that is
// on adds its section the way the MkDocs hooks did (same order: kit.py → adr → records → experiments → arc42 →
// publications → weekly → roadmap → graph → plan → quality), then tabs the project did not write itself move to
// their place in the standard order (kit_nav.py).
import fs from 'node:fs';
import path from 'node:path';
import { DOCS_DIR } from '../config/paths.ts';
import { BY_ID, enabled, FEATURES, RANK, type KitConfig, type NavSpec } from '../config/load.ts';
import type { Page, Site } from './site.ts';
import { warn } from './warnings.ts';

export type NavNode =
	| { kind: 'page'; title: string; url: string; rel: string }
	| { kind: 'section'; title: string; children: NavNode[] };

type Spec = NavSpec;
type SpecDict = { [title: string]: string | Spec[] | null };

const titleOf = (it: Spec): string | null => (typeof it === 'object' && it && Object.keys(it).length ? Object.keys(it)[0] : null);

function mentions(nav: Spec[] | null | undefined, p: string): boolean {
	for (const it of nav ?? []) {
		if (it === p) return true;
		if (typeof it === 'object' && it)
			for (const v of Object.values(it)) if (v === p || (Array.isArray(v) && mentions(v, p))) return true;
	}
	return false;
}

function mentionsPrefix(nav: Spec[] | null | undefined, prefix: string): boolean {
	for (const it of nav ?? []) {
		if (typeof it === 'string' && it.startsWith(prefix)) return true;
		if (typeof it === 'object' && it)
			for (const v of Object.values(it))
				if ((typeof v === 'string' && v.startsWith(prefix)) || (Array.isArray(v) && mentionsPrefix(v, prefix))) return true;
	}
	return false;
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function listDir(sub: string, re: RegExp, desc = false): string[] {
	const d = path.join(DOCS_DIR, sub);
	if (!fs.existsSync(d)) return [];
	const names = fs.readdirSync(d).filter((f) => re.test(f)).sort(natural);
	return desc ? names.reverse() : names;
}

/** Plain-page tabs (kind 'nav'): README.md first, then by number (template.md left out). hooks/kit.py */
function addNavFeature(nav: Spec[], id: string) {
	const f = BY_ID[id];
	if (id === 'history') {
		if (mentions(nav, 'history.md')) return;
		if (!fs.existsSync(path.join(DOCS_DIR, 'history.md'))) {
			warn('kit', null, 'feature history is on but docs/history.md is missing (.docs-kit/bin/kit.py enable history)');
			return;
		}
		for (const it of nav) {
			if (titleOf(it) === '개요') {
				const d = it as SpecDict;
				const v = d['개요'];
				d['개요'] = [...(typeof v === 'string' ? [v] : Array.isArray(v) ? v : []), 'history.md'];
				return;
			}
		}
		nav.push({ [f.title]: 'history.md' });
		return;
	}
	if (mentionsPrefix(nav, f.path + '/')) return; // the project lists these pages itself
	const names = listDir(f.path, /\.md$/).filter((n) => n !== 'template.md');
	names.sort((a, b) => Number(a !== 'README.md') - Number(b !== 'README.md'));
	const pages = names.map((n) => `${f.path}/${n}`);
	if (!pages.length) {
		warn('kit', null, `feature ${id} is on but docs/${f.path}/ has no page (.docs-kit/bin/kit.py enable ${id})`);
		return;
	}
	nav.push({ [f.title]: pages.length === 1 && pages[0].endsWith('README.md') ? pages[0] : pages });
}

/** hooks/*.py _fill_nav: the list that holds <dir>/README.md gets the files; also a tab written by title with no
 *  pages (FR-NAV-3: "기능 탭 이름만 적고 하위를 비우면 탭 모듈이 채웁니다"). */
function fillNav(nav: Spec[], dir: string, title: string, files: string[]): boolean {
	for (const it of nav) {
		if (typeof it !== 'object' || !it) continue;
		for (const [k, v] of Object.entries(it)) {
			if (k === title && (v === null || (Array.isArray(v) && !v.length))) {
				(it as SpecDict)[k] = files;
				return true;
			}
			if (Array.isArray(v)) {
				if (v.includes(`${dir}/README.md`)) {
					(it as SpecDict)[k] = files;
					return true;
				}
				if (fillNav(v, dir, title, files)) return true;
			}
		}
	}
	return false;
}

const NNNN = /^(\d{4})-[a-z0-9-]+\.md$/;

/** The section each kit tab module adds (the menu part of hooks/<tab>.py). */
const HOOK_NAV: Record<string, (nav: Spec[]) => void> = {
	adr(nav) {
		const files = ['README.md', 'log.md', 'c4.md', 'guide.md', 'template.md', ...listDir('adr', NNNN)].map((f) => `adr/${f}`);
		const it = nav.find((x) => titleOf(x) === 'ADR');
		if (it) (it as SpecDict)['ADR'] = files;
		else nav.push({ ADR: files });
	},
	records(nav) {
		const files = ['README.md', 'template.md', ...listDir('records', NNNN)].map((f) => `records/${f}`);
		if (!fillNav(nav, 'records', '검증 기록', files)) nav.push({ '검증 기록': files });
	},
	experiments(nav) {
		const files = ['list.md', 'README.md', 'template.md', ...listDir('experiments', NNNN)].map((f) => `experiments/${f}`);
		if (!fillNav(nav, 'experiments', '실험', files)) nav.push({ 실험: files });
	},
	arc42(nav) {
		const secs = listDir('arc42', /^a(\d{2})_[a-z0-9_]+\.md$/);
		const extra = listDir('arc42', /\.md$/).filter((f) => !secs.includes(f) && f !== 'README.md' && f !== 'template.md');
		const files = ['README.md', 'template.md', ...secs, ...extra].map((f) => `arc42/${f}`);
		if (!fillNav(nav, 'arc42', '아키텍처', files)) nav.push({ 아키텍처: files });
	},
	publications(nav) {
		const files = ['README.md', 'template.md', ...listDir('publications', NNNN)].map((f) => `publications/${f}`);
		if (!fillNav(nav, 'publications', '문서함', files)) nav.push({ 문서함: files });
	},
	weekly(nav) {
		const files = ['README.md', 'threads.md', 'template.md', ...listDir('weekly', /^\d{4}-\d{2}-\d{2}\.md$/, true)].map((f) => `weekly/${f}`);
		if (!fillNav(nav, 'weekly', '주간 보고', files)) nav.push({ '주간 보고': files });
	},
	roadmap(nav) {
		if (!fs.existsSync(path.join(DOCS_DIR, 'roadmap', 'roadmap.yml'))) return;
		const pages = ['roadmap/README.md', 'roadmap/guide.md'];
		if (!fillNav(nav, 'roadmap', '로드맵', pages)) nav.push({ 로드맵: pages });
	},
	graph(nav) {
		if (mentions(nav, 'graph/README.md')) return;
		let at = nav.findIndex((it) => titleOf(it) === '로드맵');
		if (at < 0) at = nav.findIndex((it) => titleOf(it) === '주간 보고');
		nav.splice(at < 0 ? 1 : at + 1, 0, { '문서 지도': 'graph/README.md' });
	},
	plan(nav) {
		if (!fs.existsSync(path.join(DOCS_DIR, 'plan', 'scope.yml'))) return;
		const pages = ['plan/README.md', 'plan/sprints.md', 'plan/guide.md'];
		if (!fillNav(nav, 'plan', '현황판', pages) && !mentions(nav, 'plan/README.md')) nav.splice(1, 0, { 현황판: pages });
	},
	quality(nav) {
		if (!fs.existsSync(path.join(DOCS_DIR, 'quality')) || mentions(nav, 'quality/README.md')) return;
		const i = nav.findIndex((it) => typeof it === 'object' && it && Object.values(it).some((v) => v === 'graph/README.md' || (Array.isArray(v) && v.includes('graph/README.md'))));
		if (i >= 0) nav.splice(i + 1, 0, { '근거 점검': 'quality/README.md' });
		else nav.push({ '근거 점검': 'quality/README.md' });
	},
};
const HOOK_ORDER = ['adr', 'records', 'experiments', 'arc42', 'publications', 'weekly', 'roadmap', 'graph', 'plan', 'quality'];

/** kit_nav.py: tabs the kit added go just after the last tab that ranks before them. */
function reorder(nav: Spec[], original: Set<string>) {
	const added = nav.filter((it) => {
		const t = titleOf(it);
		return t !== null && t in RANK && !original.has(t);
	});
	for (const it of added) nav.splice(nav.indexOf(it), 1);
	added.sort((a, b) => RANK[titleOf(a)!] - RANK[titleOf(b)!]);
	for (const it of added) {
		const r = RANK[titleOf(it)!];
		let at = 0;
		nav.forEach((other, i) => {
			const t = titleOf(other);
			if (t !== null && t in RANK && RANK[t] < r) at = i + 1;
			else if (t === null && typeof other === 'string' && r > 0) at = Math.max(at, i + 1);
		});
		nav.splice(at, 0, it);
	}
}

/** The menu as written plus what the kit adds (MkDocs nav shape). */
export function navSpec(cfg: KitConfig): Spec[] {
	const nav: Spec[] = structuredClone(cfg.nav ?? [{ 개요: 'README.md' }]);
	const original = new Set(nav.map(titleOf).filter((t): t is string => !!t));
	for (const f of FEATURES) if (f.kind === 'nav' && enabled(cfg, f.id)) addNavFeature(nav, f.id);
	for (const [page, title] of [
		['docs-standard.md', '문서 규격'],
		['docs-kit.md', '문서 사이트 사용법'],
	])
		if (!mentions(nav, page)) nav.push({ [title]: page });
	for (const id of HOOK_ORDER) if (enabled(cfg, id)) HOOK_NAV[id](nav);
	reorder(nav, original);
	return nav;
}

function toNodes(specs: Spec[], site: Site, used: Set<string>): NavNode[] {
	const out: NavNode[] = [];
	for (const s of specs) {
		if (typeof s === 'string') {
			const n = pageNode(s, null, site, used);
			if (n) out.push(n);
			continue;
		}
		if (!s || typeof s !== 'object') continue;
		for (const [title, v] of Object.entries(s)) {
			if (typeof v === 'string') {
				const n = /^[a-z]+:\/\//i.test(v) ? null : pageNode(v, title, site, used);
				if (n) out.push(n);
			} else if (Array.isArray(v)) out.push({ kind: 'section', title, children: toNodes(v, site, used) });
		}
	}
	return out;
}

function pageNode(rel: string, title: string | null, site: Site, used: Set<string>): NavNode | null {
	const p = site.byRel.get(rel);
	if (!p) {
		warn('nav', 'docs-kit.yml', `nav entry ${rel} is not a page in docs/`);
		return null;
	}
	used.add(rel);
	return { kind: 'page', title: title ?? p.title, url: p.url, rel };
}

export interface Nav {
	tree: NavNode[];
	/** pages in menu order (prev / next) */
	order: { title: string; url: string; rel: string; tab: number }[];
}

let cachedNav: { site: Site; nav: Nav } | null = null;

export function buildNav(site: Site): Nav {
	if (cachedNav && cachedNav.site === site) return cachedNav.nav;
	const used = new Set<string>();
	const tree = toNodes(navSpec(site.cfg), site, used);
	const order: Nav['order'] = [];
	const walk = (nodes: NavNode[], tab: number) => {
		for (const n of nodes) {
			if (n.kind === 'page') order.push({ title: n.title, url: n.url, rel: n.rel, tab });
			else walk(n.children, tab);
		}
	};
	tree.forEach((n, i) => walk([n], i));
	// MkDocs validation omitted_files: a project page that is in no menu (a tab that is off keeps its pages out on purpose)
	for (const p of site.pages)
		if (p.origin === 'project' && !used.has(p.rel) && !p.template && !(p.feature && !enabled(site.cfg, p.feature.id)) && !p.front.kit_hidden)
			warn('nav', p.rel, 'page is not in the menu (add it to docs-kit.yml nav, or move it into a tab folder)');
	const nav = { tree, order };
	cachedNav = { site, nav };
	return nav;
}

/** Index of the top-level tab that holds the page (-1: the page is not in the menu). */
export function tabOf(nav: Nav, page: Page): number {
	return nav.order.find((o) => o.rel === page.rel)?.tab ?? -1;
}
