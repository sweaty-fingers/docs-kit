// Work memos (memos tab): one Markdown file per memo in <project>/docs/memos/ (docs-kit.yml memos.dir), written from
// the memo app (assets/memos/app/) through a small API that exists only in the preview server (docs.sh start / serve),
// and read by agents with bin/memos.py (weekly reports from chosen memos: bin/weekly_draft.py --memos).
//
//   ---
//   title: "회의 정리"
//   created: "2026-11-21T15:30:12+09:00"
//   updated: "2026-11-21T15:42:00+09:00"
//   work: "시뮬레이션 환경"            # 업무: the work item name used in weekly reports (roadmap unit)
//   tags: ["회의", "drake/contact"]
//   pinned: false
//   archived: false
//   trashed: ""                       # date-time when moved to the trash
//   ---
//   본문 (Markdown)
//
// Front-matter values are written as JSON (valid YAML), so bin/memos.py reads them with the standard library.
// The file name is the id: YYYYMMDD-HHMMSS (local time of creation), "-2", "-3" on a clash.
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parse as parseYaml } from 'yaml';
import { ROOT } from '../config/paths.ts';
import { enabled, loadConfig, type KitConfig } from '../config/load.ts';
import { splitFrontMatter } from '../markdown/pre.ts';

export const ID = /^\d{8}-\d{6}(-\d+)?$/;
const MAX_BODY = 1024 * 1024;

export interface Memo {
	id: string;
	title: string;
	created: string;
	updated: string;
	work: string;
	tags: string[];
	pinned: boolean;
	archived: boolean;
	trashed: string;
	body: string;
	mtime: number; // file modification time (ms): the version a client edits against
}

export function memoDir(cfg: KitConfig = loadConfig()): string {
	return path.resolve(ROOT, cfg.memos.dir);
}

/** Local date-time with offset: 2026-11-21T15:30:12+09:00. */
export function stamp(d = new Date()): string {
	const p = (n: number) => String(Math.abs(n)).padStart(2, '0');
	const off = -d.getTimezoneOffset();
	return (
		`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
		`${off >= 0 ? '+' : '-'}${p(Math.trunc(off / 60))}:${p(off % 60)}`
	);
}

const str = (v: any) => (v === undefined || v === null ? '' : v instanceof Date ? stamp(v) : String(v));

export function cleanTags(v: any): string[] {
	const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
	const out: string[] = [];
	for (const t of arr) {
		const s = String(t).trim().replace(/^#+/, '').replace(/\s*\/\s*/g, '/').replace(/\s+/g, '-').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
		if (s && !out.includes(s)) out.push(s);
	}
	return out;
}

export function parseMemo(id: string, text: string, mtime = 0): Memo {
	const [y, body] = splitFrontMatter(text.replace(/\r\n/g, '\n'));
	let m: any = {};
	try {
		m = (y && parseYaml(y)) || {};
	} catch {
		m = {};
	}
	const firstLine = body.split('\n').find((l) => l.trim()) ?? '';
	return {
		id,
		title: str(m.title) || firstLine.replace(/^#+\s*/, '').slice(0, 80),
		created: str(m.created),
		updated: str(m.updated) || str(m.created),
		work: str(m.work),
		tags: cleanTags(m.tags),
		pinned: m.pinned === true,
		archived: m.archived === true,
		trashed: str(m.trashed),
		body: body.replace(/^\n+/, ''),
		mtime,
	};
}

export function serializeMemo(m: Memo): string {
	const j = (v: any) => JSON.stringify(v);
	return [
		'---',
		`title: ${j(m.title)}`,
		`created: ${j(m.created)}`,
		`updated: ${j(m.updated)}`,
		`work: ${j(m.work)}`,
		`tags: ${j(m.tags)}`,
		`pinned: ${j(m.pinned)}`,
		`archived: ${j(m.archived)}`,
		`trashed: ${j(m.trashed)}`,
		'---',
		'',
		m.body.replace(/\s+$/, '') + '\n',
	].join('\n');
}

export function listMemos(dir = memoDir()): Memo[] {
	if (!fs.existsSync(dir)) return [];
	const out: Memo[] = [];
	for (const f of fs.readdirSync(dir)) {
		const id = f.replace(/\.md$/, '');
		if (!f.endsWith('.md') || !ID.test(id)) continue;
		const p = path.join(dir, f);
		out.push(parseMemo(id, fs.readFileSync(p, 'utf-8'), fs.statSync(p).mtimeMs));
	}
	return out.sort((a, b) => b.updated.localeCompare(a.updated));
}

function newId(dir: string, d = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	const base = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
	let id = base;
	for (let k = 2; fs.existsSync(path.join(dir, id + '.md')); k++) id = `${base}-${k}`;
	return id;
}

function writeAtomic(file: string, text: string) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, text);
	fs.renameSync(tmp, file);
}

/** Fields a client may set; anything else is ignored. */
function applyFields(m: Memo, b: any) {
	if (typeof b.title === 'string') m.title = b.title.slice(0, 300);
	if (typeof b.body === 'string') m.body = b.body;
	if (typeof b.work === 'string') m.work = b.work.trim().slice(0, 120);
	if (b.tags !== undefined) m.tags = cleanTags(b.tags).slice(0, 50);
	if (typeof b.pinned === 'boolean') m.pinned = b.pinned;
	if (typeof b.archived === 'boolean') m.archived = b.archived;
	if (typeof b.trashed === 'boolean') m.trashed = b.trashed ? stamp() : '';
}

export function createMemo(b: any, dir = memoDir()): Memo {
	fs.mkdirSync(dir, { recursive: true });
	const now = new Date();
	const id = newId(dir, now);
	const m: Memo = { id, title: '', created: stamp(now), updated: stamp(now), work: '', tags: [], pinned: false, archived: false, trashed: '', body: '', mtime: 0 };
	applyFields(m, b);
	const file = path.join(dir, id + '.md');
	writeAtomic(file, serializeMemo(m));
	m.mtime = fs.statSync(file).mtimeMs;
	return m;
}

/** Update a memo the client read at version `base` (its mtime). Returns [status, memo]: 409 with the file's memo when it
 *  changed since (another tab, an agent, an editor), unless `force`. */
export function updateMemo(id: string, b: any, dir = memoDir()): [number, Memo | null] {
	const file = path.join(dir, id + '.md');
	if (!fs.existsSync(file)) return [404, null];
	const cur = parseMemo(id, fs.readFileSync(file, 'utf-8'), fs.statSync(file).mtimeMs);
	if (!b.force && typeof b.base === 'number' && Math.abs(b.base - cur.mtime) > 1) return [409, cur];
	applyFields(cur, b);
	cur.updated = stamp();
	writeAtomic(file, serializeMemo(cur));
	cur.mtime = fs.statSync(file).mtimeMs;
	return [200, cur];
}

/** Delete for good: only memos already in the trash. */
export function deleteMemo(id: string, dir = memoDir()): number {
	const file = path.join(dir, id + '.md');
	if (!fs.existsSync(file)) return 404;
	if (!parseMemo(id, fs.readFileSync(file, 'utf-8')).trashed) return 409;
	fs.rmSync(file);
	return 204;
}

// ---------------------------------------------------------------- the preview server's API
/** Only the person at this computer: the page must be opened as localhost (not by LAN address), same origin. */
export function localOnly(req: IncomingMessage): boolean {
	const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
	if (!['localhost', '127.0.0.1', '::1'].includes(host)) return false;
	const origin = req.headers.origin;
	if (origin) {
		try {
			if (new URL(String(origin)).host !== req.headers.host) return false;
		} catch {
			return false;
		}
	}
	return true;
}

function readBody(req: IncomingMessage): Promise<any> {
	return new Promise((resolve, reject) => {
		let n = 0;
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => {
			n += c.length;
			if (n > MAX_BODY + 64 * 1024) {
				reject(new Error('too large'));
				req.destroy();
			} else chunks.push(c);
		});
		req.on('end', () => {
			try {
				resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {});
			} catch (e) {
				reject(e);
			}
		});
		req.on('error', reject);
	});
}

function send(res: ServerResponse, status: number, data?: any) {
	res.statusCode = status;
	res.setHeader('Cache-Control', 'no-store');
	if (data === undefined) return res.end();
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.end(JSON.stringify(data));
}

/** Names to offer for 업무: the roadmap's units, work items of weekly reports, and what memos already use. */
export type Suggest = () => string[];

/** Handle /_kit/api/memos[/<id>] (rel = the part after the site base). Returns false when it is not ours. */
export async function memoApi(req: IncomingMessage, res: ServerResponse, rel: string, suggest: Suggest): Promise<boolean> {
	const m = /^_kit\/api\/memos(?:\/([^/]+))?\/?$/.exec(rel);
	if (!m) return false;
	const cfg = loadConfig();
	if (!enabled(cfg, 'memos')) return send(res, 404, { error: 'memos tab is off (kit.py enable memos)' }), true;
	if (!localOnly(req)) return send(res, 403, { error: 'memos are written only from this computer (open the preview as localhost)' }), true;
	const dir = memoDir(cfg);
	const id = m[1] ? decodeURIComponent(m[1]) : null;
	try {
		if (req.method === 'GET' && !id) {
			const memos = listMemos(dir);
			const works = [...new Set([...suggest(), ...memos.map((x) => x.work).filter(Boolean)])];
			return send(res, 200, { dir: path.relative(ROOT, dir), writable: true, memos, works }), true;
		}
		if (req.method === 'POST' && !id) {
			if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') return send(res, 415, { error: 'JSON only' }), true;
			const b = await readBody(req);
			if (typeof b.body === 'string' && b.body.length > MAX_BODY) return send(res, 413, { error: 'memo too large' }), true;
			return send(res, 201, createMemo(b, dir)), true;
		}
		if (id === 'empty-trash' && req.method === 'POST') {
			let n = 0;
			for (const x of listMemos(dir)) if (x.trashed && deleteMemo(x.id, dir) === 204) n++;
			return send(res, 200, { deleted: n }), true;
		}
		if (!id || !ID.test(id)) return send(res, 404, { error: 'no such memo' }), true;
		if (req.method === 'PUT') {
			if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') return send(res, 415, { error: 'JSON only' }), true;
			const b = await readBody(req);
			if (typeof b.body === 'string' && b.body.length > MAX_BODY) return send(res, 413, { error: 'memo too large' }), true;
			const [status, memo] = updateMemo(id, b, dir);
			return send(res, status, status === 404 ? { error: 'no such memo' } : memo), true;
		}
		if (req.method === 'DELETE') {
			const status = deleteMemo(id, dir);
			return send(res, status, status === 204 ? undefined : { error: status === 409 ? 'move it to the trash first' : 'no such memo' }), true;
		}
		return send(res, 405, { error: 'method not allowed' }), true;
	} catch (e: any) {
		return send(res, 400, { error: String(e?.message || e) }), true;
	}
}
