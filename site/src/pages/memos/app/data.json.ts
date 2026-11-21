// Read-only copy of the memos for the built site, only when docs-kit.yml has memos.publish: true (default false: the
// memo app on the built site says that memos are opened in the preview). Memos in the trash are never published.
import type { APIRoute } from 'astro';
import { loadConfig } from '../../../config/load.ts';
import { listMemos, memoDir } from '../../../lib/memos.ts';

export const GET: APIRoute = () => {
	const cfg = loadConfig();
	const data = cfg.memos.publish
		? { published: true, memos: listMemos(memoDir(cfg)).filter((m) => !m.trashed).map(({ mtime, ...m }) => m) }
		: { published: false, memos: [] };
	return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
