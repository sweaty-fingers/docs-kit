// Markdown → HTML for one page (prd.md FR-MD, FR-UI-3/4). The source-level passes (pre.ts) run first; this is the
// unified pipeline: CommonMark + GFM (tables, task lists, strikethrough, autolinks) + math (KaTeX at build time),
// raw HTML, then the kit's rehype passes.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import { slug as githubSlug } from 'github-slugger';
import { visit, SKIP } from 'unist-util-visit';
import { toString } from 'hast-util-to-string';
import type { Element, Root, Text, ElementContent } from 'hast';
import { createHighlighter, type Highlighter, bundledLanguages } from 'shiki';

export interface Heading {
	depth: number;
	text: string;
	id: string;
}

export interface RenderResult {
	html: string;
	headings: Heading[];
	/** Relative links to other pages as written, resolved to site urls later (lib/site.ts). */
	links: { href: string; line?: number }[];
}

let highlighter: Highlighter | null = null;
const loaded = new Set<string>(['text']);

async function hl(): Promise<Highlighter> {
	if (!highlighter) highlighter = await createHighlighter({ themes: ['github-light', 'github-dark'], langs: [] });
	return highlighter;
}

const LANG_ALIAS: Record<string, string> = { sh: 'bash', shell: 'bash', console: 'bash', yml: 'yaml', py: 'python', js: 'javascript', ts: 'typescript', text: 'text', txt: 'text', plain: 'text' };

// ------------------------------------------------------------ attr_list: {: .class #id key="v"} (FR-MD-7)
const ATTR = /\{:?\s*((?:[.#][\w-]+|[\w-]+=(?:"[^"]*"|'[^']*'|[^\s}]+))(?:\s+(?:[.#][\w-]+|[\w-]+=(?:"[^"]*"|'[^']*'|[^\s}]+)))*)\s*\}/;

function parseAttrs(s: string): Record<string, string | string[]> {
	const out: Record<string, any> = {};
	const re = /([.#])([\w-]+)|([\w-]+)=("([^"]*)"|'([^']*)'|([^\s}]+))/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(s))) {
		if (m[1] === '.') (out.className ||= []).push(m[2]);
		else if (m[1] === '#') out.id = m[2];
		else out[m[3]] = m[5] ?? m[6] ?? m[7];
	}
	return out;
}

function applyAttrs(el: Element, attrs: Record<string, any>) {
	for (const [k, v] of Object.entries(attrs)) {
		if (k === 'className') {
			const cur = (el.properties.className as string[]) || [];
			el.properties.className = [...cur, ...v];
		} else el.properties[k] = v;
	}
}

function rehypeAttrList() {
	return (tree: Root) => {
		visit(tree, 'element', (node: Element, index, parent: any) => {
			// inline: <a>...</a>{: .x} or <img>{: .x}
			node.children.forEach((child, i) => {
				if (child.type !== 'text') return;
				const prev = node.children[i - 1];
				const m = /^\{:?\s*[.#\w][^}]*\}/.exec(child.value);
				if (m && prev && prev.type === 'element' && ATTR.test(m[0])) {
					applyAttrs(prev, parseAttrs(m[0]));
					child.value = child.value.slice(m[0].length);
				}
			});
			// block: a trailing "{: ...}" at the end of a paragraph / heading / list item / cell text
			if (/^(p|h[1-6]|li|td|th|dt|dd)$/.test(node.tagName)) {
				const last = node.children[node.children.length - 1];
				if (last && last.type === 'text') {
					const m = /\s*\{:\s*([^}]*)\}\s*$/.exec(last.value);
					if (m && ATTR.test(m[0].trim())) {
						last.value = last.value.slice(0, m.index);
						// a paragraph that was only the attribute line applies to the block before it
						if (node.tagName === 'p' && !toString(node).trim() && parent && typeof index === 'number') {
							let k = index - 1;
							while (k >= 0 && parent.children[k].type === 'text' && !parent.children[k].value.trim()) k--;
							if (k >= 0 && parent.children[k].type === 'element') applyAttrs(parent.children[k], parseAttrs(m[0]));
							parent.children.splice(index, 1);
							return [SKIP, index];
						}
						applyAttrs(node, parseAttrs(m[0]));
					}
				}
			}
		});
	};
}

// ------------------------------------------------------------ Mermaid (FR-MD-10): rendered in the browser
function rehypeMermaid() {
	return (tree: Root) => {
		visit(tree, 'element', (node: Element, index, parent: any) => {
			if (node.tagName !== 'pre' || !parent || typeof index !== 'number') return;
			const code = node.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
			const cls = (code?.properties.className as string[] | undefined) ?? [];
			if (!code || !cls.includes('language-mermaid')) return;
			parent.children[index] = {
				type: 'element',
				tagName: 'div',
				properties: { className: ['kit-mermaid'] },
				children: [{ type: 'element', tagName: 'pre', properties: { className: ['mermaid'] }, children: [{ type: 'text', value: toString(code) }] }],
			};
			return SKIP;
		});
	};
}

// ------------------------------------------------------------ code highlighting (Shiki, build time)
function rehypeCode(h: Highlighter) {
	return () => (tree: Root) => {
		visit(tree, 'element', (node: Element, index, parent: any) => {
			if (node.tagName !== 'pre' || !parent || typeof index !== 'number') return;
			const code = node.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
			if (!code) return;
			const cls = ((code.properties.className as string[]) ?? []).find((c) => c.startsWith('language-'));
			let lang = cls ? cls.slice(9).toLowerCase() : 'text';
			lang = LANG_ALIAS[lang] ?? lang;
			if (!loaded.has(lang)) lang = 'text';
			const text = toString(code).replace(/\n$/, '');
			const out = h.codeToHast(text, { lang, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false });
			const pre = out.children[0] as Element;
			pre.properties.tabindex = undefined;
			parent.children[index] = { type: 'element', tagName: 'div', properties: { className: ['kit-code'], dataLang: lang }, children: [pre] };
			return SKIP;
		});
	};
}

async function ensureLangs(md: string) {
	const h = await hl();
	const want = new Set<string>();
	for (const m of md.matchAll(/^\s*(?:`{3,}|~{3,})\s*\{?\.?([\w+-]+)/gm)) want.add(LANG_ALIAS[m[1].toLowerCase()] ?? m[1].toLowerCase());
	for (const l of want) {
		if (loaded.has(l) || l === 'mermaid') continue;
		if (l in bundledLanguages) {
			await h.loadLanguage(l as any);
			loaded.add(l);
		}
	}
	return h;
}

// ------------------------------------------------------------ headings: GitHub-style ids + ¶ (FR-UI-3/4)
function rehypeHeadings(out: Heading[]) {
	return () => (tree: Root) => {
		// a repeated heading gets "_1", "_2" (Python-Markdown toc, the MkDocs edition), so links keep working (MIG-2)
		const used = new Set<string>();
		const unique = (id: string) => {
			while (used.has(id)) {
				const m = /^(.*)_(\d+)$/.exec(id);
				id = m ? `${m[1]}_${Number(m[2]) + 1}` : `${id}_1`;
			}
			used.add(id);
			return id;
		};
		visit(tree, 'element', (node: Element) => {
			if (!/^h[1-6]$/.test(node.tagName)) return;
			const text = toString(node).trim();
			const own = node.properties.id as string | undefined;
			if (own) used.add(own);
			const id = own || unique(githubSlug(text));
			node.properties.id = id;
			out.push({ depth: Number(node.tagName[1]), text, id });
			if (node.tagName !== 'h1')
				node.children.push({ type: 'element', tagName: 'a', properties: { className: ['headerlink'], href: `#${id}`, ariaLabel: '이 절의 링크' }, children: [{ type: 'text', value: '¶' }] });
		});
	};
}

// ------------------------------------------------------------ links: page.md → page.html (FR-ARC-4)
export function mdHrefToHtml(href: string): string {
	const m = /^([^#?]*?)((?:README|index)\.md|\.md)([?#].*)?$/i.exec(href);
	if (!m) return href;
	const [, base, file, rest = ''] = m;
	if (/^(readme|index)\.md$/i.test(file)) return `${base}index.html${rest}`;
	return `${base}.html${rest}`;
}

function isRelative(href: string) {
	return !!href && !/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(href);
}

function rehypeLinks(links: RenderResult['links']) {
	return () => (tree: Root) => {
		visit(tree, 'element', (node: Element) => {
			if (node.tagName !== 'a') return;
			const href = node.properties.href as string | undefined;
			if (!href) return;
			if (isRelative(href) && /\.md([?#]|$)/i.test(href)) {
				links.push({ href });
				node.properties.href = mdHrefToHtml(href);
			} else if (href.startsWith('#') && href.length > 1) links.push({ href });
		});
	};
}

// ------------------------------------------------------------ wide tables scroll on their own (FR-UI-5)
function rehypeTables() {
	return (tree: Root) => {
		visit(tree, 'element', (node: Element, index, parent: any) => {
			if (node.tagName !== 'table' || !parent || typeof index !== 'number') return;
			if (parent.type === 'element' && (parent.properties?.className as string[] | undefined)?.includes('kit-table')) return;
			parent.children[index] = { type: 'element', tagName: 'div', properties: { className: ['kit-table'] }, children: [node] };
			return SKIP;
		});
	};
}

// ------------------------------------------------------------ task lists: GFM checkboxes, styled (FR-MD-8)
function rehypeTasks() {
	return (tree: Root) => {
		visit(tree, 'element', (node: Element) => {
			if (node.tagName === 'input' && node.properties.type === 'checkbox') {
				node.properties.className = ['kit-task'];
			}
		});
	};
}

export async function renderMarkdown(md: string): Promise<RenderResult> {
	const h = await ensureLangs(md);
	const headings: Heading[] = [];
	const links: RenderResult['links'] = [];
	const file = await unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkMath)
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(rehypeRaw)
		.use(rehypeAttrList)
		.use(rehypeMermaid)
		.use(rehypeKatex, { throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' })
		.use(rehypeCode(h))
		.use(rehypeHeadings(headings))
		.use(rehypeLinks(links))
		.use(rehypeTables)
		.use(rehypeTasks)
		.use(rehypeStringify, { allowDangerousHtml: true })
		.process(md);
	return { html: String(file), headings, links };
}

export type { Text, ElementContent };
