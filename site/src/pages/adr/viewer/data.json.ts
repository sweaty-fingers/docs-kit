// Data of the C4 architecture viewer (assets/adr/viewer/): views with their nodes and edges, element details, ADR
// summaries and verification records, from docs/adr/c4-model.yml and the records' front matter (hooks/adr.py).
import type { APIRoute } from 'astro';
import { loadConfig } from '../../../config/load.ts';
import { c4Data } from '../../../lib/records.ts';

export const GET: APIRoute = () =>
	new Response(JSON.stringify(c4Data(loadConfig())), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
