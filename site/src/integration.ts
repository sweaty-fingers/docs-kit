// The kit's Astro integration: what happens around the page routes.
//   dev   watch the project's docs/, docs-kit.yml and the kit's assets/ (outside the Astro root) and reload open
//         pages; serve the project's and the kit's static files (images, viewers) and the vendored libraries
//   build README pages a.html → a/index.html (prd.md FR-ARC-4), copy static files and vendored libraries, build the
//         Pagefind index (FR-CORE-7), print the warning summary (FR-ARC-3; DOCS_STRICT=1 fails on warnings)
import type { AstroIntegration } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ASSETS_DIR, CONFIG_FILE, DOCS_DIR, KIT_ASSET_SKIP, MKDOCS_FILE } from './config/paths.ts';
import { loadConfig } from './config/load.ts';
import { scanFiles, scanPages } from './lib/site.ts';
import { clearWarningFile, readWarnings, resetWarnings } from './lib/warnings.ts';

const require = createRequire(import.meta.url);

/** Vendored third-party files served at /_kit/vendor/ (offline, versions fixed by package-lock.json). */
function vendorFiles(): Map<string, string> {
	const m = new Map<string, string>();
	const katexDir = path.dirname(require.resolve('katex/package.json'));
	m.set('_kit/vendor/katex/katex.min.css', path.join(katexDir, 'dist', 'katex.min.css'));
	for (const f of fs.readdirSync(path.join(katexDir, 'dist', 'fonts'))) if (/\.woff2$/.test(f)) m.set(`_kit/vendor/katex/fonts/${f}`, path.join(katexDir, 'dist', 'fonts', f));
	// Mermaid: the copy that the kit already vendors (assets/_kit/vendor/README.txt: 11.4.1, sha256 recorded)
	m.set('_kit/vendor/mermaid/mermaid.min.js', path.join(ASSETS_DIR, '_kit', 'vendor', 'mermaid', 'mermaid.min.js'));
	m.set('_kit/vendor/mermaid/LICENSE.txt', path.join(ASSETS_DIR, '_kit', 'vendor', 'mermaid', 'LICENSE.txt'));
	return m;
}

/** Non-Markdown files of the site: docs/ over the kit's assets/ (minus _kit/), plus vendored libraries. */
function staticFiles(): Map<string, string> {
	const m = new Map<string, string>();
	for (const f of scanFiles().values()) if (!f.rel.toLowerCase().endsWith('.md')) m.set(f.rel, f.abs);
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
					if (KIT_ASSET_SKIP.some((p) => rel.startsWith(p)) && !rel.startsWith('_kit/vendor/')) continue;
					const to = path.join(out, rel);
					if (fs.existsSync(to)) continue;
					fs.mkdirSync(path.dirname(to), { recursive: true });
					fs.copyFileSync(abs, to);
				}
				// 3. search index (offline, static)
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
				// 4. warnings
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
