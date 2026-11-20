// Data of the roadmap viewer (assets/roadmap/viewer/): window.ROADMAP = {svg, items, units, refKinds, status}.
// A script (not JSON) so the viewer also works opened from the file system (hooks/roadmap.py).
import type { APIRoute } from 'astro';
import { roadmapData } from '../../../lib/roadmap.ts';

export const GET: APIRoute = () => new Response(roadmapData(), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
