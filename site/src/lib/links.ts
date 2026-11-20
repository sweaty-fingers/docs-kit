// What needs every page at once (port of hooks/section_links.py and parts of hooks/links.py):
//   - § references → links (FR-CORE-1): "§4.3" (this page), "11 §4" (file 11_*), "A5 §2" / "G1 §6" / "R2 §1",
//     and a link to a page whose text is "08 §3.1" gets the anchor of heading 3.1
//   - links to pages and anchors that do not exist → warnings (FR-ARC-4)
//   - rerun: / catalog: / port: links and kit-dev-only blocks get their data attributes (FR-CORE-2/3)
import path from 'node:path';
import type { Page, Site } from './site.ts';
import { urlOf } from './site.ts';
import { warn } from './warnings.ts';
import { escapeHtml } from '../markdown/pre.ts';

const HEADING_NUM = /^\s*(\d+(?:\.\d+)*)\.?(?:\s|$)/;
const REF = /(?:\b(\d{2}|A\d{1,2}|G\d{1,2}|R\d{1,2})\s)?§\s?(\d+(?:\.\d+)*)/g;
const ROW_NUM = /<tr>(\s*<td[^>]*>)(\d+\.\d+(?:\.\d+)*)<\/td>/g;
const PAGE_LINK = /<a href="([^"#:]+\.html)"([^>]*)>([\s\S]*?)<\/a>/g;
const SKIP = new Set(['code', 'pre', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'script', 'style', 'svg', 'math']);

/** Relative href from one site path to another (both like "a/b.html"). */
export function relUrl(from: string, to: string): string {
	if (from === to) return '';
	const src = from.split('/').slice(0, -1);
	const dst = to.split('/');
	let i = 0;
	while (i < src.length && i < dst.length - 1 && src[i] === dst[i]) i++;
	return [...Array(src.length - i).fill('..'), ...dst.slice(i)].join('/');
}

function resolve(fromUrl: string, href: string): string {
	const parts = fromUrl.split('/').slice(0, -1);
	for (const p of href.split('/')) {
		if (p === '..') parts.pop();
		else if (p && p !== '.') parts.push(p);
	}
	return parts.join('/');
}

export function finishLinks(site: Site): Page[] {
	const sections = new Map<string, Map<string, string>>(); // url → "4.3" → id
	const docUrls = new Map<string, string>(); // "11" / "A5" / "G1" / "R2" → url
	const ids = new Map<string, Set<string>>(); // url → ids on the page
	const pages = site.pages.map((p) => ({ ...p }));

	for (const p of pages) {
		const out = new Map<string, string>();
		for (const h of p.headings) {
			const m = HEADING_NUM.exec(h.text);
			if (m && !out.has(m[1])) out.set(m[1], h.id);
		}
		p.html = p.html.replace(ROW_NUM, (all, td, num) => {
			if (out.has(num)) return all;
			const id = 'sec-' + num.replace(/\./g, '-');
			out.set(num, id);
			return `<tr id="${id}">${td}${num}</td>`;
		});
		sections.set(p.url, out);
		const name = path.posix.basename(p.rel);
		const nn = /^(\d{2})_/.exec(name);
		if (nn) docUrls.set(nn[1], p.url);
		for (const [prefix, folder] of [['A', 'arc42'], ['G', 'guides'], ['R', 'reference']] as const) {
			const m = new RegExp(`^${prefix.toLowerCase()}(\\d{1,2})_`).exec(name);
			if (m && p.rel.startsWith(folder + '/')) docUrls.set(`${prefix}${Number(m[1])}`, p.url);
		}
		ids.set(p.url, new Set([...p.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
	}

	const sharedPort = site.cfg.site.shared_port !== undefined ? String(site.cfg.site.shared_port) : '';
	const { web_port, file_port } = site.cfg.rerun;

	for (const p of pages) {
		// 1. a link to a page with "08 §3.1" as its text gets the anchor
		let html = p.html.replace(PAGE_LINK, (all, href: string, attrs: string, inner: string) => {
			const text = inner.replace(/<[^>]+>/g, '');
			const sec = new RegExp(REF.source).exec(text);
			if (!sec) return all;
			const anchor = sections.get(resolve(p.url, href))?.get(sec[2]);
			return anchor ? `<a href="${href}#${anchor}"${attrs}>${inner}</a>` : all;
		});
		// 2. plain § text outside code, headings and links
		if (html.includes('§')) {
			const out: string[] = [];
			const skip: string[] = [];
			for (const part of html.split(/(<[^>]+>)/)) {
				if (part.startsWith('<')) {
					const tag = /^<\/?\s*([a-zA-Z0-9]+)/.exec(part);
					const name = tag ? tag[1].toLowerCase() : '';
					if (SKIP.has(name) && !part.endsWith('/>')) {
						if (part.startsWith('</')) {
							if (skip[skip.length - 1] === name) skip.pop();
						} else skip.push(name);
					}
					out.push(part);
				} else if (!skip.length && part.includes('§')) {
					out.push(
						part.replace(REF, (all, doc: string | undefined, sec: string) => {
							const target = doc ? docUrls.get(doc) : p.url;
							const anchor = target ? sections.get(target)?.get(sec) : undefined;
							if (!target || !anchor) return all;
							return `<a href="${relUrl(p.url, target)}#${anchor}">${all}</a>`;
						}),
					);
				} else out.push(part);
			}
			html = out.join('');
		}
		// 3. links to the project's other servers, on the reader's host (hooks/links.py)
		if (/href="(rerun|catalog|port):/.test(html))
			html = html.replace(/<a href="(rerun|catalog|port):([^"]*)"/g, (_, kind: string, rest: string) => {
				const v = rest.replace(/&amp;/g, '&');
				if (kind === 'rerun') return `<a href="#" data-kit-rerun="${escapeHtml(v)}" data-web-port="${web_port}" data-file-port="${file_port}"`;
				if (kind === 'catalog') {
					const [port, web] = v.split('@');
					return `<a href="#" data-kit-catalog="${escapeHtml(port)}" data-web-port="${escapeHtml(web || String(web_port))}"`;
				}
				const i = v.indexOf('/');
				const port = i < 0 ? v : v.slice(0, i);
				const rest2 = i < 0 ? '' : v.slice(i + 1);
				return `<a href="#" data-kit-port="${escapeHtml(port)}" data-kit-path="/${escapeHtml(rest2)}"`;
			});
		if (html.includes('kit-dev-only'))
			html = html.replace(/(<[a-zA-Z][^<>]*?\s)class="kit-dev-only"/g, (_, head: string) => `${head}class="kit-dev-only" data-shared-port="${escapeHtml(sharedPort)}"`);
		p.html = html;

		// 4. checks: pages and anchors that do not exist
		for (const { href } of p.links) {
			const [pathPart, frag] = href.split('#');
			let targetUrl = p.url;
			if (pathPart) {
				const rel = resolve(p.rel, decodeURI(pathPart));
				if (!rel.toLowerCase().endsWith('.md')) continue;
				const target = site.byRel.get(rel);
				if (!target) {
					if (!site.files.has(rel)) warn('links', p.rel, `link to ${pathPart}: no such page (${rel})`);
					continue;
				}
				targetUrl = urlOf(target.rel);
			}
			if (frag) {
				const f = decodeURIComponent(frag);
				const known = ids.get(targetUrl);
				if (known && !known.has(f)) warn('links', p.rel, `link ${href}: no heading or id "#${f}" in ${targetUrl === p.url ? 'this page' : pathPart}`);
			}
		}
	}
	return pages;
}
