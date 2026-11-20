// Data of the sprint board (assets/plan/board/): window.PLAN_BOARD = {...} (hooks/plan.py _board_js).
import type { APIRoute } from 'astro';
import { boardData } from '../../../lib/plan.ts';

export const GET: APIRoute = () => new Response(boardData(), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
