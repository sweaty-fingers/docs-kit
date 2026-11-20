// docs-kit site engine. Run through the kit's bin/docs.sh (build | serve | start), not directly: it sets DOCS_ROOT
// (the project) and, in Docker, DOCS_KIT. Static output (prd.md §6.1) to <project>/build/site/.
import { defineConfig } from 'astro/config';
import kit from './src/integration.ts';
import { loadConfig } from './src/config/load.ts';
import { DOCS_DIR, KIT_DIR, OUT_DIR, ROOT } from './src/config/paths.ts';

const cfg = loadConfig();
const base = cfg.site.base ? '/' + cfg.site.base.replace(/^\/+|\/+$/g, '') : '/';

export default defineConfig({
	output: 'static',
	outDir: OUT_DIR,
	base,
	site: cfg.site.url || undefined,
	// docs/a/b.md → /a/b.html (use_directory_urls: false); README pages are moved to a/index.html after the build
	build: { format: 'file', assets: '_kit/astro' },
	trailingSlash: 'ignore',
	devToolbar: { enabled: false },
	integrations: [kit()],
	vite: {
		server: { fs: { allow: [ROOT, KIT_DIR, DOCS_DIR] } },
		logLevel: 'warn',
	},
});
