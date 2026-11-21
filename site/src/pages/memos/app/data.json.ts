// What the memo app needs from the build: where memos are stored (GitHub repository, docs-kit.yml memos.github: the
// app writes there with the reader's own token; no token or memo text is in this file), the 업무 names to offer
// (roadmap units and weekly report work items), and, only with memos.publish: true, a read-only copy of the local memos
// (never those in the trash).
import type { APIRoute } from 'astro';
import { enabled, loadConfig } from '../../../config/load.ts';
import { listMemos, memoDir } from '../../../lib/memos.ts';
import { loadRoadmap } from '../../../lib/roadmap.ts';
import { workNames } from '../../../lib/weekly.ts';

export const GET: APIRoute = () => {
	const cfg = loadConfig();
	const units = [...(loadRoadmap(cfg)?.units.values() ?? [])].map((u) => u.name);
	const works = [...new Set([...units, ...(enabled(cfg, 'weekly') ? workNames() : [])])];
	const publish = cfg.memos.publish && !cfg.memos.github;
	const data = {
		published: publish,
		github: cfg.memos.github ?? null,
		works,
		memos: publish ? listMemos(memoDir(cfg)).filter((m) => !m.trashed).map(({ mtime, ...m }) => m) : [],
	};
	return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
