// The documents of one build: the project's docs/ overlaid on the kit's assets/ (same relative path → the project's
// file wins, prd.md FR-ARC-1), each page rendered once (cached by mtime, so the dev server re-renders only what
// changed), then finished with what needs every page: § links (FR-CORE-1), link and anchor checks (FR-ARC-4).
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ASSETS_DIR, DOCS_DIR, KIT_ASSET_SKIP } from '../config/paths.ts';
import { BY_ID, enabled, FEATURES, loadConfig, type Feature, type KitConfig } from '../config/load.ts';
import { blocks, fixLists, markers, mdInHtml, snippets, splitFrontMatter, eachLine } from '../markdown/pre.ts';
import { renderMarkdown, type Heading } from '../markdown/pipeline.ts';
import { markerHandlers } from './markers.ts';
import { warn } from './warnings.ts';
import { finishLinks } from './links.ts';

export interface SourceFile {
	rel: string; // path under docs/ (or the kit's assets/), "/" separated
	abs: string;
	origin: 'project' | 'kit';
}

export interface Page extends SourceFile {
	url: string; // site path: a/b.html, a/index.html (README.md / index.md), index.html
	slug: string | undefined; // route parameter: url without .html, folder for index pages, undefined for the root
	feature: Feature | null;
	front: Record<string, any>;
	title: string;
	html: string;
	headings: Heading[];
	links: { href: string }[];
	template: boolean;
	hide: string[];
}

const IGNORE_DIR = new Set(['.git', 'node_modules', '__pycache__']);

function walk(dir: string, base = ''): string[] {
	if (!fs.existsSync(dir)) return [];
	const out: string[] = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name.startsWith('.') || IGNORE_DIR.has(e.name)) continue;
		const rel = base ? `${base}/${e.name}` : e.name;
		if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
		else out.push(rel);
	}
	return out;
}

/** Every file of the site: kit assets (minus the MkDocs-only _kit/) under the project's docs/. */
export function scanFiles(): Map<string, SourceFile> {
	const files = new Map<string, SourceFile>();
	for (const rel of walk(ASSETS_DIR)) {
		if (KIT_ASSET_SKIP.some((p) => rel.startsWith(p))) continue;
		files.set(rel, { rel, abs: path.join(ASSETS_DIR, rel), origin: 'kit' });
	}
	for (const rel of walk(DOCS_DIR)) files.set(rel, { rel, abs: path.join(DOCS_DIR, rel), origin: 'project' });
	return files;
}

export function urlOf(rel: string): string {
	if (/(^|\/)(README|index)\.md$/i.test(rel)) return rel.replace(/(README|index)\.md$/i, 'index.html');
	return rel.replace(/\.md$/i, '.html');
}

export function slugOf(url: string): string | undefined {
	if (url === 'index.html') return undefined;
	if (url.endsWith('/index.html')) return url.slice(0, -'/index.html'.length);
	return url.slice(0, -'.html'.length);
}

export function featureOf(rel: string): Feature | null {
	const top = rel.includes('/') ? rel.split('/')[0] : rel;
	return FEATURES.find((f) => f.path === top) ?? null;
}

/** Page list without rendering (for routes, the integration and the menu). */
export function scanPages(): Omit<Page, 'front' | 'title' | 'html' | 'headings' | 'links' | 'hide'>[] {
	const byUrl = new Map<string, ReturnType<typeof scanPages>[number]>();
	for (const f of [...scanFiles().values()].sort((a, b) => a.rel.localeCompare(b.rel))) {
		if (!f.rel.toLowerCase().endsWith('.md')) continue;
		const url = urlOf(f.rel);
		const prev = byUrl.get(url);
		if (prev) {
			// README.md and index.md in one folder make the same page: MkDocs builds index.md
			const keep = /index\.md$/i.test(f.rel) ? f.rel : prev.rel;
			warn('kit', f.rel, `both ${prev.rel} and ${f.rel} make ${url}; using ${keep}`);
			if (keep === prev.rel) continue;
		}
		byUrl.set(url, { ...f, url, slug: slugOf(url), feature: featureOf(f.rel), template: /(^|\/)template\.md$/.test(f.rel) || /(^|\/)_template\.md$/.test(f.rel) });
	}
	return [...byUrl.values()];
}

// ---------------------------------------------------------------- rendering (cached per file)
interface Cached {
	key: string;
	page: Page;
}
const cache = new Map<string, Cached>();

function readSnippetFactory(files: Map<string, SourceFile>) {
	return (rel: string): string | null => {
		const f = files.get(rel.replace(/^\.?\//, ''));
		if (!f) return null;
		try {
			return fs.readFileSync(f.abs, 'utf-8');
		} catch {
			return null;
		}
	};
}

async function renderPage(p: ReturnType<typeof scanPages>[number], files: Map<string, SourceFile>, cfg: KitConfig, cfgKey: string): Promise<Page> {
	const stat = fs.statSync(p.abs);
	const key = `${stat.mtimeMs}:${stat.size}:${cfgKey}`;
	const hit = cache.get(p.rel);
	if (hit && hit.key === key) return hit.page;
	const text = fs.readFileSync(p.abs, 'utf-8').replace(/\r\n/g, '\n');
	// Pages that pull in other files (snippets) or show generated tables (markers) depend on more than their own
	// file: render them every time.
	const dynamic = text.includes('--8<--') || /^[ \t]*<!--\s*[a-z][a-z0-9-]*(:[^>]*)?-->[ \t]*$/m.test(text);
	const [yamlText, bodyText] = splitFrontMatter(text);
	let front: Record<string, any> = {};
	if (yamlText !== null) {
		try {
			const v = parseYaml(yamlText);
			if (v && typeof v === 'object') front = v;
		} catch (e: any) {
			warn('kit', p.rel, `front matter is not valid YAML: ${String(e.message).split('\n')[0]}`);
		}
	}
	let md = bodyText;
	// A page without "# title" but with a front matter title (Starlight / MkDocs meta) gets one.
	let hasH1 = false;
	eachLine(md, (line, inFence) => {
		if (!inFence && /^# \S/.test(line)) hasH1 = true;
		return line;
	});
	if (!hasH1 && front.title) md = `# ${front.title}\n\n${md}`;
	md = snippets(md, readSnippetFactory(files), (what) => warn('snippets', p.rel, what));
	md = markers(md, markerHandlers({ page: p, cfg }));
	md = fixLists(md);
	md = mdInHtml(md);
	md = blocks(md);
	const r = await renderMarkdown(md);
	const h1 = r.headings.find((h) => h.depth === 1);
	const title = h1?.text || String(front.title || '') || path.basename(p.rel, '.md');
	const hide = Array.isArray(front.hide) ? front.hide.map(String) : [];
	const page: Page = { ...p, front, title, html: r.html, headings: r.headings, links: r.links, hide };
	if (!dynamic) cache.set(p.rel, { key, page });
	return page;
}

export interface Site {
	cfg: KitConfig;
	pages: Page[];
	byUrl: Map<string, Page>;
	byRel: Map<string, Page>;
	files: Map<string, SourceFile>;
}

let current: { key: string; site: Site } | null = null;

function fingerprint(files: Map<string, SourceFile>): string {
	let n = 0;
	let t = 0;
	for (const f of files.values()) {
		try {
			const s = fs.statSync(f.abs);
			t += s.mtimeMs % 1e9;
			n += s.size;
		} catch {
			/* removed meanwhile */
		}
	}
	return `${files.size}:${n}:${Math.round(t)}`;
}

/** All pages, rendered and finished. Recomputed when any file or the settings change. */
export async function getSite(): Promise<Site> {
	const cfg = loadConfig();
	const files = scanFiles();
	const cfgKey = JSON.stringify([cfg.profile, cfg.features, cfg.areas, cfg.site, cfg.links, cfg.rerun]);
	const key = fingerprint(files) + '|' + cfgKey;
	if (current && current.key === key) return current.site;
	const list = scanPages();
	const pages: Page[] = [];
	for (const p of list) pages.push(await renderPage(p, files, cfg, cfgKey));
	const site: Site = { cfg, pages, byUrl: new Map(pages.map((p) => [p.url, p])), byRel: new Map(pages.map((p) => [p.rel, p])), files };
	// finishing needs every page's headings; it works on copies so the per-file cache stays raw
	const finished = finishLinks(site);
	site.pages = finished;
	site.byUrl = new Map(finished.map((p) => [p.url, p]));
	site.byRel = new Map(finished.map((p) => [p.rel, p]));
	current = { key, site };
	return site;
}

export function isOff(site: Site, p: { feature: Feature | null }): boolean {
	return !!p.feature && !enabled(site.cfg, p.feature.id);
}

export { BY_ID };
