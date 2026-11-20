// Data of the document map (assets/graph/viewer/): window.DOCGRAPH = {kinds, nodes, topics, areas, ask}, from every
// finished page (links after all other passes), front matter relations and similarity (hooks/graph.py).
import type { APIRoute } from 'astro';
import { getSite } from '../../../lib/site.ts';
import { graphData } from '../../../lib/graph.ts';

export const GET: APIRoute = async () => new Response(graphData(await getSite()), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
