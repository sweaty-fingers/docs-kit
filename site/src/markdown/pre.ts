// Source-level compatibility with the MkDocs edition (Python-Markdown + pymdownx), prd.md FR-MD.
// The project's files stay as written; these passes turn pymdownx block syntax into CommonMark + raw HTML that the
// unified pipeline (pipeline.ts) renders. Every pass leaves fenced code alone.
//
//   snippets      --8<-- "path.md[:name]"  (;--8<-- shows the line itself)                    FR-MD-5
//   markers       <!-- name[: args] --> on a line of its own → a handler's Markdown / HTML      FR-MD-13
//   lists         2-3 space nesting → 4 spaces, a blank line before a list under text           FR-MD-11 (lists.py)
//   md in html    <div ... markdown> ... </div> → Markdown inside                               FR-MD-6
//   admonitions   !!! type "title" + 4-space body                                               FR-MD-2
//   details       ??? / ???+ type "title" + 4-space body                                        FR-MD-3
//   content tabs  === "label" + 4-space body                                                    FR-MD-4

export interface FenceState {
	marker: string | null;
}

const FENCE = /^( *)(`{3,}|~{3,})/;

/** Calls fn(line, inFence) for each line; inFence is true for the fence lines themselves and their content. */
export function eachLine(md: string, fn: (line: string, inFence: boolean, i: number) => string | string[]): string {
	const out: string[] = [];
	let fence: string | null = null;
	const lines = md.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const m = FENCE.exec(line);
		let inFence = fence !== null;
		if (m) {
			if (fence === null) {
				fence = m[2];
				inFence = true;
			} else if (m[2][0] === fence[0] && m[2].length >= fence.length && !line.trim().slice(m[2].length).trim()) {
				fence = null;
				inFence = true;
			}
		}
		const r = fn(line, inFence, i);
		if (Array.isArray(r)) out.push(...r);
		else out.push(r);
	}
	return out.join('\n');
}

export function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------- snippets (FR-MD-5)
export type ReadSnippet = (rel: string) => string | null;

const SNIP = /^(\s*)(;?)--8<--\s+(["'])(.+?)\3\s*$/;
const SECTION = /^\s*(?:<!--\s*)?(?:#\s*)?--8<--\s*\[(start|end):([\w.-]+)\]\s*(?:-->)?\s*$/;

/** Insert snippet files (pymdownx.snippets: base path docs/, check_paths). Applied everywhere, as pymdownx does,
 *  so an example line inside a code fence needs the `;` escape. */
export function snippets(md: string, read: ReadSnippet, onMissing: (what: string) => void, depth = 0): string {
	if (!md.includes('--8<--')) return md;
	return md
		.split('\n')
		.map((line) => {
			const m = SNIP.exec(line);
			if (!m) return line;
			const [, indent, escape, , target] = m;
			if (escape) return line.replace(';--8<--', '--8<--');
			const [file, name] = splitTarget(target);
			const text = read(file);
			if (text === null) {
				onMissing(`snippet file ${file} not found`);
				return line;
			}
			let part = text;
			if (name) {
				const got = section(text, name);
				if (got === null) {
					onMissing(`snippet ${file}:${name} has no [start:${name}] ... [end:${name}] section`);
					return line;
				}
				part = got;
			}
			part = part
				.split('\n')
				.filter((l) => !SECTION.test(l))
				.join('\n');
			if (depth < 4) part = snippets(part, read, onMissing, depth + 1);
			return part
				.replace(/\n+$/, '')
				.split('\n')
				.map((l) => (l ? indent + l : l))
				.join('\n');
		})
		.join('\n');
}

function splitTarget(t: string): [string, string | null] {
	const i = t.lastIndexOf(':');
	if (i > 0 && !t.slice(i + 1).includes('/') && !/^[a-z]+$/i.test(t.slice(0, i))) return [t.slice(0, i), t.slice(i + 1) || null];
	return [t, null];
}

function section(text: string, name: string): string | null {
	const lines = text.split('\n');
	let on = false;
	let found = false;
	const out: string[] = [];
	for (const l of lines) {
		const m = SECTION.exec(l);
		if (m && m[2] === name) {
			on = m[1] === 'start';
			found = true;
			continue;
		}
		if (on) out.push(l);
	}
	return found ? out.join('\n') : null;
}

// ---------------------------------------------------------------- markers (FR-MD-13)
export type MarkerHandler = (args: string, opts: Record<string, string>) => string | null;

const MARKER = /^[ \t]*<!--\s*([a-z0-9][a-z0-9-]*)(?::\s*(.*?))?\s*-->[ \t]*$/;

/** Replace each `<!-- name -->` / `<!-- name: arg k=v -->` that stands alone on a line, outside code fences. */
export function markers(md: string, handlers: Record<string, MarkerHandler>): string {
	if (!md.includes('<!--')) return md;
	return eachLine(md, (line, inFence) => {
		if (inFence) return line;
		const m = MARKER.exec(line);
		if (!m) return line;
		const h = handlers[m[1]];
		if (!h) return line;
		const raw = (m[2] ?? '').trim();
		const opts: Record<string, string> = {};
		const args: string[] = [];
		for (const tok of raw ? raw.split(/\s+/) : []) {
			const kv = /^(\w+)=(.*)$/.exec(tok);
			if (kv) opts[kv[1]] = kv[2];
			else args.push(tok);
		}
		const r = h(args.join(' '), opts);
		return r === null ? line : ['', r, ''];
	});
}

// ---------------------------------------------------------------- lists (FR-MD-11, port of hooks/lists.py)
const ITEM = /^( *)([-*+]|\d{1,9}[.)])( +)(\S.*)?$/;
const STEP = 4;
const ind = (l: string) => l.length - l.trimStart().length;

function isText(line: string): boolean {
	const s = line.trim();
	if (!s) return false;
	return !(
		/^(#|\||>|<|!!!|\?\?\?|```|~~~|---|\*\*\*|___|\[\/\/\]|:)/.test(s) ||
		ITEM.test(line) ||
		s.endsWith('-->')
	);
}

export function fixLists(md: string): string {
	const out: string[] = [];
	const stack: [number, number, number][] = []; // (source indent, new indent, source content column)
	let fence: [string, number] | null = null;
	let prevBlank = true;
	for (const line of md.split('\n')) {
		if (fence) {
			out.push(fence[1] > 0 && line.trim() ? ' '.repeat(fence[1]) + line : line);
			const m = FENCE.exec(line);
			if (m && m[2] === fence[0] && !line.trim().slice(3).trim()) fence = null;
			prevBlank = false;
			continue;
		}
		if (!line.trim()) {
			out.push(line);
			prevBlank = true;
			continue;
		}
		const i = ind(line);
		const m = ITEM.exec(line);
		if (m) {
			while (stack.length && i < stack[stack.length - 1][0]) stack.pop();
			let neu: number;
			if (stack.length && i > stack[stack.length - 1][0]) neu = stack[stack.length - 1][1] + STEP;
			else if (stack.length && i === stack[stack.length - 1][0]) {
				neu = stack[stack.length - 1][1];
				stack.pop();
			} else {
				neu = i % STEP === 0 ? i : Math.floor(i / STEP) * STEP;
				stack.length = 0;
			}
			const col = i + m[2].length + m[3].length;
			if (!stack.length && neu === i && !prevBlank && out.length && isText(out[out.length - 1]) && ind(out[out.length - 1]) <= i)
				out.push('');
			stack.push([i, neu, col]);
			out.push(' '.repeat(neu) + line.trimStart());
			prevBlank = false;
			continue;
		}
		if (stack.length && prevBlank && i === 0) stack.length = 0;
		let shift = 0;
		for (let k = stack.length - 1; k >= 0; k--) {
			const [src, neu, col] = stack[k];
			if (i > src) {
				const rel = i - src;
				shift = (rel >= STEP ? neu + rel : neu + STEP + Math.max(0, i - col)) - i;
				break;
			}
		}
		const fm = FENCE.exec(line);
		if (fm) fence = [fm[2], shift];
		out.push(shift > 0 ? ' '.repeat(shift) + line : line);
		prevBlank = false;
	}
	return out.join('\n');
}

// ---------------------------------------------------------------- markdown inside HTML (FR-MD-6)
const MD_OPEN = /^(\s*)<([a-zA-Z][\w-]*)(\s[^>]*?)\smarkdown(?:=(?:"[^"]*"|'[^']*'|\S+))?(\s[^>]*)?>\s*$/;

export function mdInHtml(md: string): string {
	if (!/\smarkdown(\s|=|>)/.test(md)) return md;
	const lines = md.split('\n');
	const out: string[] = [];
	let fence: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const f = FENCE.exec(line);
		if (f) fence = fence === null ? f[2] : f[2][0] === fence[0] ? null : fence;
		const m = fence === null ? MD_OPEN.exec(line) : null;
		if (!m) {
			out.push(line);
			continue;
		}
		const [, indent, tag, a1, a2] = m;
		// find the matching close tag (same name, nesting counted)
		let depth = 1;
		let j = i + 1;
		const open = new RegExp(`<${tag}(\\s|>)`, 'g');
		const close = new RegExp(`</${tag}\\s*>`, 'g');
		for (; j < lines.length; j++) {
			depth += (lines[j].match(open) || []).length - (lines[j].match(close) || []).length;
			if (depth <= 0) break;
		}
		const inner = lines.slice(i + 1, j);
		const closeLine = lines[j] ?? `${indent}</${tag}>`;
		const before = closeLine.slice(0, closeLine.search(new RegExp(`</${tag}`)));
		if (before.trim()) inner.push(before);
		out.push(`${indent}<${tag}${a1 ?? ''}${a2 ?? ''}>`, '', mdInHtml(inner.join('\n')), '', `${indent}</${tag}>`);
		i = j;
	}
	return out.join('\n');
}

// ---------------------------------------------------------------- admonitions, details, tabs (FR-MD-2..4)
const ADMON = /^( *)(!!!|\?\?\?\+?)[ \t]+([\w-]+(?:[ \t]+[\w-]+)*)(?:[ \t]+"(.*)")?[ \t]*$/;
const TAB = /^( *)===(!?)[ \t]+"(.*)"[ \t]*$/;

function body(lines: string[], start: number, indent: number): [string[], number] {
	const want = indent + 4;
	const out: string[] = [];
	let j = start;
	for (; j < lines.length; j++) {
		const l = lines[j];
		if (!l.trim()) {
			// a blank line belongs to the block if the next non-blank line is indented under it
			let k = j + 1;
			while (k < lines.length && !lines[k].trim()) k++;
			if (k < lines.length && ind(lines[k]) >= want) {
				out.push('');
				continue;
			}
			break;
		}
		if (ind(l) < want) break;
		out.push(l.slice(want));
	}
	while (out.length && !out[out.length - 1].trim()) out.pop();
	return [out, j];
}

function title(type: string): string {
	return type.charAt(0).toUpperCase() + type.slice(1);
}

let tabGroup = 0;

export function blocks(md: string): string {
	if (!/^\s*(!!!|\?\?\?|===)/m.test(md)) return md;
	const lines = md.split('\n');
	const out: string[] = [];
	let fence: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const f = FENCE.exec(line);
		if (f) {
			fence = fence === null ? f[2] : f[2][0] === fence[0] && f[2].length >= fence.length ? null : fence;
			out.push(line);
			continue;
		}
		if (fence !== null) {
			out.push(line);
			continue;
		}
		const a = ADMON.exec(line);
		if (a) {
			const indent = a[1].length;
			const pad = a[1];
			const kinds = a[3].split(/\s+/);
			const type = kinds[0];
			const head = a[4] === undefined ? title(type) : a[4];
			const [inner, next] = body(lines, i + 1, indent);
			const content = blocks(inner.join('\n'))
				.split('\n')
				.map((l) => (l ? pad + l : l));
			if (a[2] === '!!!') {
				out.push(`${pad}<div class="admonition ${kinds.map(escapeHtml).join(' ')}">`);
				if (head) out.push(`${pad}<p class="admonition-title">${escapeHtml(head)}</p>`);
			} else {
				out.push(`${pad}<details class="admonition ${kinds.map(escapeHtml).join(' ')}"${a[2] === '???+' ? ' open' : ''}>`);
				out.push(`${pad}<summary>${escapeHtml(head || title(type))}</summary>`);
			}
			out.push('', ...content, '', `${pad}</${a[2] === '!!!' ? 'div' : 'details'}>`, '');
			i = next - 1;
			continue;
		}
		const t = TAB.exec(line);
		if (t) {
			// a run of === blocks (blank lines between) is one tab set; ===! starts a new set
			const pad = t[1];
			const indent = pad.length;
			const tabs: { label: string; content: string[] }[] = [];
			let j = i;
			while (j < lines.length) {
				const tt = TAB.exec(lines[j]);
				if (!tt || tt[1].length !== indent || (tabs.length && tt[2] === '!')) break;
				const [inner, next] = body(lines, j + 1, indent);
				tabs.push({ label: tt[3], content: blocks(inner.join('\n')).split('\n') });
				j = next;
				let k = j;
				while (k < lines.length && !lines[k].trim()) k++;
				if (k < lines.length && TAB.test(lines[k]) && !/^\s*===!/.test(lines[k])) j = k;
				else break;
			}
			const g = ++tabGroup;
			out.push(`${pad}<div class="kit-tabs" data-kit-tabs="${g}">`, '');
			out.push(
				`${pad}<div class="kit-tabs__bar" role="tablist">${tabs
					.map(
						(tb, k) =>
							`<button type="button" role="tab" class="kit-tabs__tab" aria-selected="${k === 0}" data-tab="${k}">${escapeHtml(tb.label)}</button>`,
					)
					.join('')}</div>`,
				'',
			);
			tabs.forEach((tb, k) => {
				out.push(`${pad}<div class="kit-tabs__panel" role="tabpanel" data-tab="${k}"${k ? ' hidden' : ''}>`, '');
				out.push(...tb.content.map((l) => (l ? pad + l : l)), '', `${pad}</div>`, '');
			});
			out.push(`${pad}</div>`, '');
			i = j - 1;
			continue;
		}
		out.push(line);
	}
	return out.join('\n');
}

/** Front matter: YAML between a first line `---` and the next `---`. Returns [yaml text | null, body]. */
export function splitFrontMatter(text: string): [string | null, string, number] {
	if (!text.startsWith('---')) return [null, text, 0];
	const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
	if (!m) return [null, text, 0];
	const lines = m[0].split('\n').length - 1;
	return [m[1], text.slice(m[0].length), lines];
}
