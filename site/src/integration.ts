// The kit's Astro integration: what happens around the page routes.
//   dev   watch the project's docs/, docs-kit.yml and the kit's assets/ (outside the Astro root) and reload open
//         pages; serve the project's and the kit's static files (images, viewers) and the vendored libraries
//   build README pages a.html → a/index.html (prd.md FR-ARC-4), copy static files and vendored libraries, build the
//         Pagefind index (FR-CORE-7), print the warning summary (FR-ARC-3; DOCS_STRICT=1 fails on warnings)
import type { AstroIntegration } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ASSETS_DIR, CONFIG_FILE, DOCS_DIR, MKDOCS_FILE } from './config/paths.ts';
import { enabled, loadConfig } from './config/load.ts';
import { scanFiles, scanPages } from './lib/site.ts';
import { clearWarningFile, readWarnings, resetWarnings } from './lib/warnings.ts';

const require = createRequire(import.meta.url);

/** Vendored third-party files served at /_kit/vendor/ (offline, versions fixed by package-lock.json). */
function vendorFiles(): Map<string, string> {
	const m = new Map<string, string>();
	const katexDir = path.dirname(require.resolve('katex/package.json'));
	m.set('_kit/vendor/katex/katex.min.css', path.join(katexDir, 'dist', 'katex.min.css'));
	for (const f of fs.readdirSync(path.join(katexDir, 'dist', 'fonts'))) if (/\.woff2$/.test(f)) m.set(`_kit/vendor/katex/fonts/${f}`, path.join(katexDir, 'dist', 'fonts', f));
	// Pretendard (OFL-1.1): variable font, dynamic subset - a page loads only the unicode ranges it uses
	const pre = path.join(path.dirname(require.resolve('pretendard/package.json')), 'dist', 'web', 'variable');
	m.set('_kit/vendor/pretendard/pretendardvariable-dynamic-subset.css', path.join(pre, 'pretendardvariable-dynamic-subset.css'));
	for (const f of fs.readdirSync(path.join(pre, 'woff2-dynamic-subset')))
		m.set(`_kit/vendor/pretendard/woff2-dynamic-subset/${f}`, path.join(pre, 'woff2-dynamic-subset', f));
	// Mermaid (npm, version in package-lock.json): the ESM build loads only the chunks of the diagram types a page uses
	const mer = path.join(path.dirname(require.resolve('mermaid/package.json')), 'dist');
	m.set('_kit/vendor/mermaid/mermaid.esm.min.mjs', path.join(mer, 'mermaid.esm.min.mjs'));
	for (const f of fs.readdirSync(path.join(mer, 'chunks', 'mermaid.esm.min')))
		if (!f.endsWith('.map')) m.set(`_kit/vendor/mermaid/chunks/mermaid.esm.min/${f}`, path.join(mer, 'chunks', 'mermaid.esm.min', f));
	m.set('_kit/vendor/mermaid/LICENSE', path.join(path.dirname(mer), 'LICENSE'));
	// elkjs (npm) for the C4 viewer, at the path the viewer loads it from
	const elk = path.dirname(require.resolve('elkjs/package.json'));
	m.set('adr/viewer/vendor/elk.bundled.js', path.join(elk, 'lib', 'elk.bundled.js'));
	if (fs.existsSync(path.join(elk, 'LICENSE.md'))) m.set('adr/viewer/vendor/elkjs-LICENSE.txt', path.join(elk, 'LICENSE.md'));
	// JetBrains Mono (OFL-1.1, @fontsource-variable): code blocks
	const jb = path.dirname(require.resolve('@fontsource-variable/jetbrains-mono/package.json'));
	m.set('_kit/vendor/jetbrains-mono/index.css', path.join(jb, 'index.css'));
	for (const f of fs.readdirSync(path.join(jb, 'files'))) if (f.endsWith('-normal.woff2')) m.set(`_kit/vendor/jetbrains-mono/files/${f}`, path.join(jb, 'files', f));
	return m;
}

/** Data files the tabs read at build time; not published (hooks/roadmap.py, plan.py, graph.py, quality.py). */
const SOURCES = /^(roadmap\/roadmap\.yml|plan\/(scope|risks)\.yml|plan\/(sprints|issues)\.json|graph\/topics\.yml|quality\/[^/]+\.json)$/;

/** Non-Markdown files of the site: docs/ over the kit's assets/ (minus _kit/), plus vendored libraries. */
function staticFiles(): Map<string, string> {
	const m = new Map<string, string>();
	for (const f of scanFiles().values()) if (!f.rel.toLowerCase().endsWith('.md') && f.abs && !SOURCES.test(f.rel)) m.set(f.rel, f.abs);
	for (const [k, v] of vendorFiles()) m.set(k, v);
	return m;
}

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
	'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff',
	'.txt': 'text/plain; charset=utf-8', '.yml': 'text/plain; charset=utf-8', '.yaml': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
	'.mp4': 'video/mp4', '.webm': 'video/webm',
};

export default function kit(): AstroIntegration {
	let base = '/';
	return {
		name: 'docs-kit',
		hooks: {
			'astro:config:setup': ({ config, command }) => {
				base = config.base.endsWith('/') ? config.base : config.base + '/';
				if (command === 'build') clearWarningFile();
				process.env.ASTRO_TELEMETRY_DISABLED = '1';
			},
			'astro:server:setup': ({ server }) => {
				const watched = [DOCS_DIR, ASSETS_DIR, CONFIG_FILE, MKDOCS_FILE];
				server.watcher.add(watched);
				const inProject = (f: string) => watched.some((w) => f === w || f.startsWith(w + path.sep));
				const reload = (f: string) => {
					if (!inProject(f)) return;
					resetWarnings();
					// page list may have changed: drop Astro's cached getStaticPaths results for the page routes
					for (const mod of server.moduleGraph.idToModuleMap.values())
						if (mod.file && /src[\\/]pages[\\/]/.test(mod.file)) server.moduleGraph.invalidateModule(mod);
					server.ws.send({ type: 'full-reload', path: '*' });
				};
				server.watcher.on('change', reload);
				server.watcher.on('add', reload);
				server.watcher.on('unlink', reload);
				server.middlewares.use((req, res, next) => {
					const url = decodeURIComponent((req.url || '').split('?')[0]);
					if (!url.startsWith(base)) return next();
					const rel = url.slice(base.length);
					if (!rel || rel.endsWith('.md')) return next();
					const file = staticFiles().get(rel) ?? (rel.endsWith('/') ? undefined : staticFiles().get(rel + '/index.html'));
					if (!file || !fs.existsSync(file)) return next();
					res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
					res.setHeader('Cache-Control', 'no-cache');
					fs.createReadStream(file).pipe(res);
				});
			},
			'astro:build:done': async ({ dir, logger }) => {
				const out = dir.pathname.startsWith('/') && process.platform !== 'win32' ? decodeURIComponent(dir.pathname) : new URL(dir).pathname;
				// 1. README / index pages and short addresses: a.html → a/index.html
				const moves: string[] = [];
				for (const p of scanPages()) if (p.url.endsWith('/index.html')) moves.push(p.url.slice(0, -'/index.html'.length));
				for (const l of loadConfig().links) moves.push(`r/${l.name}`);
				for (const slug of moves) {
					const from = path.join(out, slug + '.html');
					const to = path.join(out, slug, 'index.html');
					if (!fs.existsSync(from)) continue;
					fs.mkdirSync(path.dirname(to), { recursive: true });
					fs.renameSync(from, to);
				}
				// 2. static files (project first) and vendored libraries
				for (const [rel, abs] of staticFiles()) {
					const to = path.join(out, rel);
					if (fs.existsSync(to)) continue;
					fs.mkdirSync(path.dirname(to), { recursive: true });
					fs.copyFileSync(abs, to);
				}
				// 2b. viewer data of tabs that are off (or have no data file): the endpoints always run, the MkDocs edition
				//     wrote these only for tabs that are on
				{
					const c = loadConfig();
					const has = (rel: string) => fs.existsSync(path.join(DOCS_DIR, rel));
					const keep: Record<string, boolean> = {
						'adr/viewer/data.json': enabled(c, 'adr'),
						'roadmap/viewer/data.js': enabled(c, 'roadmap') && has('roadmap/roadmap.yml'),
						'plan/board/data.js': enabled(c, 'plan') && has('plan/scope.yml'),
						'graph/viewer/data.js': enabled(c, 'graph'),
					};
					for (const [rel, on] of Object.entries(keep)) if (!on) fs.rmSync(path.join(out, rel), { force: true });
				}
				// 3. sitemap.xml for public sites (docs-kit.yml site.url): every page except templates
				const kcfg = loadConfig();
				if (kcfg.site.url) {
					const root = kcfg.site.url.replace(/\/+$/, '') + base;
					const urls = scanPages()
						.filter((p) => !p.template && !p.generated && !(p.origin === 'kit' && p.feature && !enabled(kcfg, p.feature.id)))
						.map((p) => `  <url><loc>${root}${p.url === 'index.html' ? '' : encodeURI(p.url)}</loc></url>`);
					fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
				}
				// 4. search index (static)
				try {
					const pagefind = await import('pagefind');
					const { index } = await pagefind.createIndex({ forceLanguage: 'ko' });
					if (index) {
						await index.addDirectory({ path: out });
						await index.writeFiles({ outputPath: path.join(out, '_kit', 'pagefind') });
					}
					await pagefind.close();
				} catch (e: any) {
					logger.warn(`search index not built: ${e?.message ?? e}`);
				}
				// 5. warnings
				const warnings = readWarnings();
				const pages = scanPages().length;
				console.log(`docs-kit: ${pages} pages, ${warnings.length} warning(s)`);
				if (warnings.length && process.env.DOCS_STRICT === '1') {
					for (const w of warnings) console.log(w);
					throw new Error(`docs-kit: ${warnings.length} warning(s) with DOCS_STRICT=1`);
				}
			},
		},
	};
}
