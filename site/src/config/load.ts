// docs-kit.yml: tabs, areas and (new in the Astro edition) the site settings that mkdocs.yml used to hold
// (prd.md §5, FR-CFG-1..3). One module reads it, a zod schema checks it, unknown keys become build warnings.
import fs from 'node:fs';
import { parse as parseYaml, parseDocument } from 'yaml';
import { z } from 'zod';
import catalog from './features.json' with { type: 'json' };
import { CONFIG_FILE, DOCS_DIR, MKDOCS_FILE } from './paths.ts';
import { warn } from '../lib/warnings.ts';
import path from 'node:path';

export type Feature = (typeof catalog.features)[number];
export const FEATURES: Feature[] = catalog.features;
export const BY_ID: Record<string, Feature> = Object.fromEntries(FEATURES.map((f) => [f.id, f]));
export const PROFILES = catalog.profiles as Record<string, { summary: string; features: string[] }>;
export const CORE_TITLES = catalog.core_titles as Record<string, number>;
export const RANK: Record<string, number> = { ...CORE_TITLES, ...Object.fromEntries(FEATURES.map((f) => [f.title, f.rank])) };
export const DEFAULT_AREAS = catalog.default_areas as Record<string, string>;

/** A menu entry as written in docs-kit.yml `nav` (MkDocs nav shape): "path.md" or {title: path | entries | null}. */
export type NavSpec = string | { [title: string]: string | NavSpec[] | null };

const LinkSchema = z
	.object({ name: z.string(), to: z.string(), title: z.string().optional() })
	.strict();

const SiteSchema = z
	.object({
		name: z.string().default('Docs'),
		logo_icon: z.string().default('book-open-page-variant'),
		issues_url: z.string().optional(),
		shared_port: z.union([z.number(), z.string()]).optional(),
		// Not in prd.md §5 (added): where the site is served. base = path prefix for a sub-path deploy
		// (GitHub Pages project site: "/<repo>/"), url = origin (https://<host>). Empty = served at the root.
		base: z.string().optional(),
		url: z.string().optional(),
		// Not in prd.md §5 (added): the project's repository (link in the header) and the edit link of a page:
		// edit_url + path under docs/ (e.g. https://github.com/<user>/<repo>/edit/main/docs/)
		repo_url: z.string().optional(),
		edit_url: z.string().optional(),
		// Not in prd.md §5 (added): project stylesheets / scripts under docs/ (paths relative to docs/).
		extra_css: z.array(z.string()).default([]),
		extra_js: z.array(z.string()).default([]),
	})
	.strict();

const RerunSchema = z
	.object({
		// local: Rerun web viewer and file server on the reader's host (ports below, the MkDocs edition's behaviour)
		// hosted: the hosted web viewer (app.rerun.io) opens the recording from the site itself (docs/<path>.rrd) or
		//         any http(s) URL - for public deploys such as GitHub Pages, no server to run
		viewer: z.enum(['local', 'hosted']).default('local'),
		hosted_url: z.string().default('https://app.rerun.io/'),
		version: z.string().optional(), // hosted viewer version (match the SDK that wrote the .rrd), e.g. "0.22.1"
		web_port: z.number().default(9090),
		file_port: z.number().default(9091),
		start: z.string().default('tools/rerun_server.sh start'),
	})
	.strict();

// Work memos (memos tab): files in docs/memos/; publish = also put a read-only copy on the built site
const MemosSchema = z
	.object({
		publish: z.boolean().default(false),
		dir: z.string().default('docs/memos'), // relative to the project root; a git-ignored folder keeps memos out of git
	})
	.strict();

const ConfigSchema = z
	.object({
		profile: z.string().default('dev'),
		features: z.record(z.string(), z.boolean()).nullable().default({}),
		areas: z.record(z.string(), z.string()).nullable().default({}),
		site: SiteSchema.optional(),
		nav: z.array(z.any()).optional(),
		links: z.array(LinkSchema).optional(),
		rerun: RerunSchema.optional(),
		memos: MemosSchema.optional(),
	})
	.strict();

export interface KitConfig {
	found: boolean; // docs-kit.yml exists (else profile auto: tabs whose docs/ folder exists)
	profile: string;
	features: Record<string, boolean>;
	areas: Record<string, string>;
	site: z.infer<typeof SiteSchema>;
	nav: NavSpec[] | null;
	links: { name: string; to: string; title: string }[];
	rerun: z.infer<typeof RerunSchema>;
	memos: z.infer<typeof MemosSchema>;
	/** Where site / nav / links came from: docs-kit.yml, mkdocs.yml (old projects, FR-CFG-3) or defaults. */
	siteFrom: 'docs-kit.yml' | 'mkdocs.yml' | 'default';
}

function readYaml(file: string): Record<string, unknown> | null {
	if (!fs.existsSync(file)) return null;
	const text = fs.readFileSync(file, 'utf-8');
	// mkdocs.yml may carry !!python/... tags (slugify, fence formats); they only matter to MkDocs.
	const doc = parseDocument(text, { logLevel: 'silent', customTags: [] });
	const data = doc.toJS({ maxAliasCount: 100 }) as unknown;
	return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

/** Settings read from an old project's mkdocs.yml (FR-CFG-3, MIG-3). */
export function fromMkdocs(): Partial<KitConfig> | null {
	const m = readYaml(MKDOCS_FILE) as any;
	if (!m) return null;
	const extra = m.extra || {};
	const links = extra.links || {};
	const logo = String(m.theme?.icon?.logo || '').replace(/^material\//, '');
	return {
		site: SiteSchema.parse({
			name: m.site_name ?? 'Docs',
			...(logo ? { logo_icon: logo } : {}),
			...(extra.issues_url ? { issues_url: String(extra.issues_url) } : {}),
			...(links.shared_port !== undefined ? { shared_port: links.shared_port } : {}),
		}),
		nav: Array.isArray(m.nav) ? m.nav : null,
		links: (links.short || []).map((e: any) => ({ name: String(e.name ?? ''), to: String(e.to ?? ''), title: String(e.title ?? '') })),
		rerun: RerunSchema.parse(extra.rerun || {}),
	};
}

let cached: { key: string; cfg: KitConfig } | null = null;

function fileKey(file: string): string {
	try {
		const s = fs.statSync(file);
		return `${s.mtimeMs}:${s.size}`;
	} catch {
		return 'none';
	}
}

/** The project's settings (re-read when docs-kit.yml or mkdocs.yml changes, so the dev server follows edits). */
export function loadConfig(): KitConfig {
	const key = fileKey(CONFIG_FILE) + '|' + fileKey(MKDOCS_FILE);
	if (cached && cached.key === key) return cached.cfg;
	const raw = readYaml(CONFIG_FILE);
	let parsed: z.infer<typeof ConfigSchema> = ConfigSchema.parse({});
	if (raw) {
		const r = ConfigSchema.safeParse(raw);
		if (r.success) parsed = r.data;
		else {
			for (const issue of r.error.issues) {
				const where = issue.path.join('.') || '(top)';
				const what = issue.code === 'unrecognized_keys' ? `unknown key(s) ${(issue as any).keys.join(', ')}` : issue.message;
				warn('config', 'docs-kit.yml', `${where}: ${what}`);
			}
			// Keep what is valid: drop the offending keys one level down and parse again.
			const cleaned: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(raw)) if (k in ConfigSchema.shape) cleaned[k] = v;
			const again = ConfigSchema.safeParse(cleaned);
			if (again.success) parsed = again.data;
		}
	}
	let siteFrom: KitConfig['siteFrom'] = raw?.site ? 'docs-kit.yml' : 'default';
	let site = parsed.site ?? SiteSchema.parse({});
	let nav = (parsed.nav as NavSpec[] | undefined) ?? null;
	let links = (parsed.links ?? []).map((l) => ({ ...l, title: l.title ?? '' }));
	let rerun = parsed.rerun ?? RerunSchema.parse({});
	if (!raw?.site && fs.existsSync(MKDOCS_FILE)) {
		const m = fromMkdocs();
		if (m) {
			siteFrom = 'mkdocs.yml';
			warn('config', null, 'settings read from mkdocs.yml; run kit.py migrate');
			site = m.site!;
			nav = nav ?? m.nav ?? null;
			if (!parsed.links) links = m.links ?? [];
			if (!parsed.rerun) rerun = m.rerun!;
		}
	}
	const profile = raw ? parsed.profile : 'auto';
	const cfg: KitConfig = {
		found: !!raw,
		profile,
		features: parsed.features ?? {},
		areas: parsed.areas && Object.keys(parsed.areas).length ? parsed.areas : { ...DEFAULT_AREAS },
		site,
		nav,
		links,
		rerun,
		memos: parsed.memos ?? MemosSchema.parse({}),
		siteFrom,
	};
	if (raw && !(profile in PROFILES)) warn('kit', 'docs-kit.yml', `profile '${profile}' is not one of ${Object.keys(PROFILES).join(', ')}`);
	for (const id of Object.keys(cfg.features))
		if (!(id in BY_ID)) warn('kit', 'docs-kit.yml', `feature '${id}' is not one of ${Object.keys(BY_ID).join(', ')}`);
	cached = { key, cfg };
	return cfg;
}

/** Is tab `id` on for this project? (docs-kit-context §5.1: override → profile list; no file: auto). */
export function enabled(cfg: KitConfig, id: string): boolean {
	if (id in cfg.features) return cfg.features[id];
	if (cfg.profile === 'auto') {
		if (id === 'adr') return true;
		const f = BY_ID[id];
		return !!f && fs.existsSync(path.join(DOCS_DIR, f.data ?? f.path));
	}
	return (PROFILES[cfg.profile] ?? PROFILES.dev).features.includes(id);
}

export { parseYaml };
