// Unit tests of the Markdown compatibility layer (prd.md FR-MD) and the url helpers. `npm test` in site/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, fixLists, markers, mdInHtml, snippets, splitFrontMatter } from '../src/markdown/pre.ts';
import { mdHrefToHtml, renderMarkdown } from '../src/markdown/pipeline.ts';
import { relUrl } from '../src/lib/links.ts';
import { slugOf, urlOf } from '../src/lib/site.ts';

test('admonition with title, nested list and a nested admonition', () => {
	const md = ['!!! tip "제목"', '    본문', '', '    - a', '', '    !!! danger', '        안쪽', '', '뒤 문단'].join('\n');
	const out = blocks(md);
	assert.match(out, /<div class="admonition tip">\n<p class="admonition-title">제목<\/p>/);
	assert.match(out, /<div class="admonition danger">\n<p class="admonition-title">Danger<\/p>/);
	assert.match(out, /\n뒤 문단$/);
});

test('details: ??? closed, ???+ open', () => {
	assert.match(blocks('??? info "접힘"\n    x'), /<details class="admonition info">\n<summary>접힘<\/summary>/);
	assert.match(blocks('???+ note\n    x'), /<details class="admonition note" open>/);
});

test('content tabs: a run of === blocks is one set', async () => {
	const out = blocks('=== "A"\n    a\n\n=== "B"\n    b\n');
	assert.equal((out.match(/kit-tabs__panel/g) || []).length, 2);
	assert.equal((out.match(/data-kit-tabs/g) || []).length, 1);
	const html = (await renderMarkdown(out)).html;
	assert.match(html, /<p>a<\/p>/);
	assert.match(html, /<p>b<\/p>/);
});

test('code fences are left alone by every pass', () => {
	const md = '```text\n!!! tip\n    x\n<!-- kit-areas -->\n```';
	assert.equal(blocks(md), md);
	assert.equal(markers(md, { 'kit-areas': () => 'TABLE' }), md);
});

test('markers: alone on a line only, with args and options', () => {
	const got: string[] = [];
	const out = markers('a <!-- x --> b\n<!-- c4-view: ctx height=300 -->', {
		x: () => 'NO',
		'c4-view': (args, opts) => {
			got.push(args, opts.height);
			return 'VIEW';
		},
	});
	assert.deepEqual(got, ['ctx', '300']);
	assert.match(out, /^a <!-- x --> b\n\nVIEW\n$/);
});

test('lists: 2-space nesting becomes 4, a list under text gets its blank line', () => {
	assert.equal(fixLists('설명:\n- **상위**:\n  - 하위'), '설명:\n\n- **상위**:\n    - 하위');
	const ok = '- a\n    - b\n\n텍스트';
	assert.equal(fixLists(ok), ok);
});

test('markdown inside HTML (md_in_html)', () => {
	const out = mdInHtml('<div class="kit-dev-only" markdown>\n**굵게**\n</div>');
	assert.equal(out, '<div class="kit-dev-only">\n\n**굵게**\n\n</div>');
});

test('snippets: whole file, named section, escape, missing', () => {
	const files: Record<string, string> = { 'a.md': 'x\n<!-- --8<-- [start:s] -->\n| t |\n<!-- --8<-- [end:s] -->\ny' };
	const missing: string[] = [];
	const read = (p: string) => files[p] ?? null;
	assert.equal(snippets('--8<-- "a.md:s"', read, (m) => missing.push(m)), '| t |');
	assert.equal(snippets(';--8<-- "a.md:s"', read, (m) => missing.push(m)), '--8<-- "a.md:s"');
	assert.equal(snippets('--8<-- "a.md"', read, (m) => missing.push(m)), 'x\n| t |\ny');
	snippets('--8<-- "nope.md"', read, (m) => missing.push(m));
	assert.equal(missing.length, 1);
});

test('front matter split', () => {
	const [y, body] = splitFrontMatter('---\nstatus: accepted\n---\n# T\n');
	assert.equal(y, 'status: accepted');
	assert.equal(body, '# T\n');
	assert.equal(splitFrontMatter('# no front matter')[0], null);
});

test('rendering: GitHub-style Korean anchors, attr_list, .md links, task list, mermaid', async () => {
	const r = await renderMarkdown('## 4.3 장비와 정의\n\n문단 {: .x #y }\n\n[링크](../a/README.md#절) [b](b.md)\n\n- [x] 끝\n\n```mermaid\nflowchart LR\n```\n');
	assert.equal(r.headings[0].id, '43-장비와-정의');
	assert.match(r.html, /<p class="x" id="y">문단<\/p>/);
	assert.match(r.html, /href="\.\.\/a\/index\.html#%EC%A0%88"/); // browsers decode the fragment before matching ids
	assert.match(r.html, /href="b\.html"/);
	assert.match(r.html, /class="kit-task"/);
	assert.match(r.html, /<pre class="mermaid">flowchart LR\n?<\/pre>/);
});

test('urls: page paths, README → index, relative links', () => {
	assert.equal(urlOf('adr/README.md'), 'adr/index.html');
	assert.equal(urlOf('README.md'), 'index.html');
	assert.equal(urlOf('guides/g1_x.md'), 'guides/g1_x.html');
	assert.equal(slugOf('adr/index.html'), 'adr');
	assert.equal(slugOf('index.html'), undefined);
	assert.equal(mdHrefToHtml('../x/README.md#a'), '../x/index.html#a');
	assert.equal(relUrl('adr/index.html', 'guides/g1.html'), '../guides/g1.html');
	assert.equal(relUrl('index.html', 'adr/index.html'), 'adr/index.html');
	assert.equal(relUrl('a/b/c.html', 'a/d.html'), '../d.html');
});

test('heading ids: GitHub-style slugs, repeats get _1 / _2 like the MkDocs edition (MIG-2)', async () => {
	const r = await renderMarkdown('## 개념\n\n## 장점\n\n## 개념\n\n## 개념\n\n## A B. c\n');
	assert.deepEqual(r.headings.map((x) => x.id), ['개념', '장점', '개념_1', '개념_2', 'a-b-c']);
});

test('memos: a memo file round-trips; tags are cleaned; the title falls back to the first line', async () => {
	const { parseMemo, serializeMemo, cleanTags } = await import('../src/lib/memos.ts');
	const m = parseMemo('20261121-153012', '---\ntitle: ""\ncreated: "2026-11-21T15:30:12+09:00"\nwork: "업무"\ntags: [회의, "#실험", " a / b "]\npinned: true\n---\n\n# 첫 줄 제목\n본문\n', 0);
	assert.equal(m.title, '첫 줄 제목');
	assert.deepEqual(m.tags, ['회의', '실험', 'a/b']);
	assert.equal(m.pinned, true);
	assert.equal(m.updated, m.created);
	const again = parseMemo(m.id, serializeMemo({ ...m, title: '제목 "따옴표"' }), 0);
	assert.equal(again.title, '제목 "따옴표"');
	assert.equal(again.body, m.body);
	assert.deepEqual(cleanTags('a, #b, a'), ['a', 'b']);
});

test('memos: the browser format (memo-format.js, GitHub storage) writes and reads the same files as the server', async () => {
	const { createRequire } = await import('node:module');
	const F = createRequire(import.meta.url)('../../assets/memos/app/memo-format.js');
	const { parseMemo, serializeMemo } = await import('../src/lib/memos.ts');
	const m = { ...F.blank('20261121-153012', new Date(2026, 10, 21, 15, 30, 12)), title: '제목 "q"', body: '# 본문\n- [ ] 할 일\n', work: '업무', tags: ['a/b', '회의'], pinned: true };
	assert.equal(F.serialize(m), serializeMemo(m as any));
	const text = F.serialize(m);
	const a = F.parse(m.id, text, 0), b = parseMemo(m.id, text, 0);
	assert.deepEqual(a, b);
	assert.equal(F.newId(new Date(2026, 10, 21, 15, 30, 12)), '20261121-153012');
	assert.equal(F.newId(new Date(2026, 10, 21, 15, 30, 12), (id: string) => id === '20261121-153012'), '20261121-153012-2');
	assert.match(F.stamp(new Date(2026, 0, 2, 3, 4, 5)), /^2026-01-02T03:04:05[+-]\d\d:\d\d$/);
});
