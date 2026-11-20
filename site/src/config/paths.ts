// Where things are. The site (this Astro project) lives in the kit at .docs-kit/site/ and reads the project from
// outside: DOCS_ROOT (default: the kit's parent folder), its docs/ and docs-kit.yml (prd.md FR-ARC-1).
import path from 'node:path';

// Not import.meta.url: in the build this module runs from a bundled chunk elsewhere. bin/docs.sh sets DOCS_KIT;
// without it Astro runs in <kit>/site, so the kit is the working directory's parent.
/** The kit checkout (.docs-kit/). */
export const KIT_DIR = path.resolve(process.env.DOCS_KIT || path.join(process.cwd(), '..'));
/** The project root: the folder with docs-kit.yml and docs/. */
export const ROOT = path.resolve(process.env.DOCS_ROOT || path.dirname(KIT_DIR));
export const DOCS_DIR = path.join(ROOT, 'docs');
/** Kit pages and files, overlaid on docs/ at the same relative paths (project files win). */
export const ASSETS_DIR = path.join(KIT_DIR, 'assets');
/** Static site output (kept from the MkDocs edition: build/site/, prd.md MIG-5). */
export const OUT_DIR = path.resolve(process.env.DOCS_OUT || path.join(ROOT, 'build', 'site'));
/** Scratch files of the build (warnings list, caches). */
export const WORK_DIR = path.join(ROOT, 'build', '.kit');
export const CONFIG_FILE = path.join(ROOT, 'docs-kit.yml');
export const MKDOCS_FILE = path.join(ROOT, 'mkdocs.yml');

/** Kit assets that belong to the MkDocs edition only (Material theme CSS, MathJax, the scripts this engine replaced).
 *  The roadmap / dashboard styles and plan.js stay: their pages reuse them through the compatibility layer in kit.css. */
export const KIT_ASSET_SKIP = [
	'_kit/stylesheets/theme.css', '_kit/stylesheets/adr.css', '_kit/stylesheets/diagram-zoom.css',
	'_kit/javascripts/mathjax.js', '_kit/javascripts/links.js', '_kit/javascripts/rerun-embed.js', '_kit/javascripts/diagram-zoom.js',
	'_kit/vendor/mathjax/', '_kit/vendor/mermaid/', '_kit/vendor/README.txt',
];
