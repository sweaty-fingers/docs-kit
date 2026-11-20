// Grounding page (근거 점검, prd.md FR-QA, port of hooks/quality.py): runs the kit's bin/docs_check.py (Python,
// standard library only) on the project and draws its report — summary cards and layers, trend, the list of fixes,
// per-document and per-kind tables, retrieval evaluation, hallucination incidents. The report is cached in
// build/quality/report.json until a document, the code or the settings change (the same cache as the MkDocs edition).
// Data the project keeps: docs/quality/{config,questions,history,incidents,retrieval}.json (not published).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DOCS_DIR, KIT_DIR, ROOT } from '../config/paths.ts';
import { enabled, type KitConfig } from '../config/load.ts';
import { escapeHtml as h, type MarkerHandler } from '../markdown/pre.ts';
import { warn } from './warnings.ts';

const KIND: Record<string, [string, string, string]> = {
	'doc-id': ['문서 번호', 'ADR·VR·EXP·P 번호가 있는 문서인지', '번호를 고치거나 빠진 문서를 씀'],
	issue: ['이슈 번호', '#N이 이슈 스냅숏에 있는지', '번호를 고치거나 이슈 스냅숏(docs/plan/issues.json)을 새로 받음'],
	path: ['경로', '코드 칸의 저장소 경로가 있는지 (외부·계획 경로는 설정으로 구분)', '옮겨진 경로로 고치거나, 아직 없는 경로면 (예정)으로 적고 config.json `path_planned`'],
	port: ['포트', '본문의 포트가 포트 표(참고 문서)에 있는지', '포트 표에 넣거나 번호를 고침'],
	option: ['명령·옵션', '`tools/x.sh 하위명령 --옵션`이 그 스크립트에 있는지', '실제 명령으로 고치거나 스크립트에 추가'],
	ident: ['식별자', '코드 칸의 이름(snake_case, CamelCase, f())이 코드·설정·장비 출력에 있는지', '이름을 확인해 고치거나, 설계상 이름이면 (예정)·(제안) 표시'],
	'vr-number': ['VR 수치', 'VR 본문의 소수 수치가 그 VR의 원 출력(또는 설정)에 있는지', '원 출력에서 옮겨 적음. 바로잡을 때는 새 VR (VR은 고치지 않음)'],
	number: ['수치 근거', '보고·가이드·아키텍처의 소수 수치가 VR·EXP·ADR에 있는지', '근거 VR·EXP를 링크하거나, 외부 출처면 출처를 적음'],
	superseded: ['대체된 기록 인용', '살아 있는 문서가 대체된 VR·ADR만 인용하는지', '새 기록으로 바꾸거나 함께 링크'],
	stale: ['코드보다 오래된 문서', '가리키는 코드가 문서보다 14일 넘게 나중에 바뀌었는지 (git)', '문서를 다시 읽고 맞추거나 reviewed 날짜 갱신'],
};
const VERDICT: Record<string, string> = { false: '틀림', unverified: '확인 못 함', stale: '낡음' };

interface Q {
	rep: any;
	history: any[];
	incidents: any[];
}

/** Files whose change makes the cached report old (hooks/quality.py _stamp): [count, newest mtime in seconds]. */
function stamp(): [number, number] {
	let n = 0, newest = 0;
	const see = (p: string) => {
		const s = fs.statSync(p);
		n++;
		newest = Math.max(newest, s.mtimeMs / 1000);
	};
	const walk = (d: string) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			if (e.isDirectory()) {
				if (e.name !== '__pycache__' && e.name !== '.git') walk(path.join(d, e.name));
			} else see(path.join(d, e.name));
		}
	};
	for (const base of ['docs', 'packages', 'tools', '.docs-kit/bin', 'AGENTS.md', 'README.md']) {
		const p = path.join(ROOT, base);
		if (!fs.existsSync(p)) continue;
		if (fs.statSync(p).isFile()) see(p);
		else walk(p);
	}
	return [n, newest];
}

let mem: { key: string; q: Q | null } | null = null;

function readJson(name: string, fallback: any): any {
	const p = path.join(DOCS_DIR, 'quality', name);
	if (!fs.existsSync(p)) return fallback;
	try {
		return JSON.parse(fs.readFileSync(p, 'utf-8'));
	} catch (e: any) {
		warn('quality', `quality/${name}`, String(e.message));
		return fallback;
	}
}

export function loadQuality(cfg: KitConfig): Q | null {
	if (!enabled(cfg, 'quality') || !fs.existsSync(path.join(DOCS_DIR, 'quality'))) return null;
	const st = stamp();
	const key = JSON.stringify(st);
	if (mem && mem.key === key) return mem.q;
	const cache = path.join(ROOT, 'build', 'quality', 'report.json');
	let rep: any = null;
	try {
		const c = JSON.parse(fs.readFileSync(cache, 'utf-8'));
		if (JSON.stringify(c.stamp) === key) rep = c.report;
	} catch {
		/* no cache yet */
	}
	if (!rep) {
		const py = process.env.DOCS_PYTHON || 'python3';
		try {
			const out = execFileSync(py, [path.join(KIT_DIR, 'bin', 'docs_check.py'), '--root', ROOT, '--json'], {
				encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000,
			});
			rep = JSON.parse(out);
		} catch (e: any) {
			// docs_check.py exits non-zero when it finds false claims; its JSON is still on stdout
			try {
				rep = JSON.parse(String(e.stdout || ''));
			} catch {
				warn('quality', null, `cannot run bin/docs_check.py with ${py}: ${String(e.stderr || e.message).trim().split('\n').pop()}`);
				mem = { key, q: null };
				return null;
			}
		}
		try {
			fs.mkdirSync(path.dirname(cache), { recursive: true });
			fs.writeFileSync(cache, JSON.stringify({ stamp: st, report: rep }));
		} catch {
			/* read-only build folder: no cache */
		}
	}
	const rec = readJson('retrieval.json', null);
	const live = rep.retrieval || {};
	if (rec && 'hybrid' in (rec.modes || {}) && !('hybrid' in (live.modes || {}))) rep = { ...rep, retrieval: { ...rec, recorded: rec.taken ?? '' } };
	const q: Q = { rep, history: readJson('history.json', { runs: [] }).runs || [], incidents: readJson('incidents.json', { incidents: [] }).incidents || [] };
	mem = { key, q };
	return q;
}

function hint(k: string, d: string): string {
	try {
		return String(JSON.parse(fs.readFileSync(path.join(DOCS_DIR, 'quality', 'config.json'), 'utf-8'))[k] || d);
	} catch {
		return d;
	}
}
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const s = (v: any) => (v === undefined || v === null ? '' : String(v));

function docLink(here: string, p: string, line = 0, text?: string): string {
	const t = h(text || p);
	if (!p.startsWith('docs/')) return `<code>${t}</code>`;
	let page = p.slice(5);
	if (page.endsWith('.md')) page = page.endsWith('README.md') ? page.slice(0, -'README.md'.length) + 'index.html' : page.slice(0, -3) + '.html';
	return `<a href="${path.posix.relative(path.posix.dirname(here), page)}" title="${h(p)}${line ? `:${line}` : ''}">${t}</a>`;
}

function summary(q: Q): string {
	const r = q.rep, sm = r.summary, rt = r.retrieval || null;
	const cards: [string, string, string, string][] = [
		['검증 가능한 주장', s(sm.checkable), `문서 ${Object.keys(r.docs).length}개에서 뽑음, 기준 ${s(r.taken).replace('T', ' ')}`, '#종류별-점검'],
		['근거 있음', pct(sm.grounded_rate), `${sm.ok}개가 원천에서 확인됨`, '#문서별'],
		['틀림', s(sm.false), `${pct(sm.false_rate)}: 가리킨 것이 없음 (할루시네이션 의심)`, '#보완할-작업'],
		['확인 못 함', s(sm.unverified), `${pct(sm.unverified_rate)}: 있어야 할 곳에서 못 찾음`, '#보완할-작업'],
		['낡음', s(sm.stale), '대체된 기록 인용, 코드보다 오래된 문서', '#보완할-작업'],
		['검색 품질', rt ? (rt.recall5 ?? 0).toFixed(2) : '-', rt ? `recall@5 (${rt.n ?? 0}문항), hit@1 ${(rt.hit1 ?? 0).toFixed(2)}, MRR ${(rt.mrr ?? 0).toFixed(2)}` : 'questions.json 없음', '#검색-평가'],
		['할루시네이션 사례', String(q.incidents.length), '에이전트가 틀리게 말한 기록', '#사례-기록'],
	];
	const out = ['<div class="pl-cards">'];
	for (const [t, v, sub, href] of cards)
		out.push(`<a class="pl-card pl-card-link" href="${href}"><div class="pl-card-t">${t}</div><div class="pl-card-v">${h(v)}</div><div class="pl-card-s">${h(sub)}</div></a>`);
	out.push('</div>');
	const rows = ["<table class='pl-table'><thead><tr><th>층</th><th>문서</th><th>주장</th><th>근거 있음</th><th>틀림</th><th>확인 못 함</th><th>낡음</th></tr></thead><tbody>"];
	for (const name of ['정본', '운영', '발행물', '지식']) {
		const L = r.layers?.[name];
		if (!L) continue;
		const n = L.ok + L.false + L.unverified;
		rows.push(`<tr><td>${name}</td><td>${L.docs}</td><td>${n}</td><td>${n ? pct(L.ok / n) : '-'}</td><td>${L.false}</td><td>${L.unverified}</td><td>${L.stale}</td></tr>`);
	}
	rows.push('</tbody></table>');
	const git = r.git ? '' : '<p class="pl-note">이 빌드에는 git이 없어 "코드보다 오래된 문서" 점검을 건너뛰었습니다. <code>python3 .docs-kit/bin/docs_check.py</code>로 확인합니다.</p>';
	return out.join('\n') + rows.join('') + git;
}

function trend(q: Q): string {
	const runs = q.history;
	if (!runs.length)
		return '<p class="pl-note">기록이 아직 없습니다. 주간 보고 때 <code>python3 .docs-kit/bin/docs_check.py --record</code>로 그날 값을 <code>docs/quality/history.json</code>에 남기면 여기에 추이가 그려집니다.</p>';
	const W = 640, H = 180, L = 40, B = 26, T = 12;
	const n = runs.length;
	const xs = (i: number) => (n > 1 ? L + (W - L - 12) * (i / Math.max(1, n - 1)) : (W + L) / 2);
	const vmax = Math.max(0.05, ...runs.map((r) => Math.max(r.false_rate ?? 0, r.unverified_rate ?? 0))) * 1.2;
	const y = (v: number) => T + (H - T - B) * (1 - v / vmax);
	const o = [`<svg class="pl-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="틀림·확인 못 함 비율 추이">`];
	for (let k = 0; k < 4; k++) {
		const v = (vmax * k) / 3;
		o.push(`<line class="pl-grid" x1="${L}" x2="${W - 12}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="pl-ax" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${(100 * v).toFixed(0)}%</text>`);
	}
	for (const [k, cls] of [['unverified_rate', 'q-unv'], ['false_rate', 'q-false']]) {
		o.push(`<polyline class="q-line ${cls}" points="${runs.map((r, i) => `${xs(i).toFixed(1)},${y(r[k] ?? 0).toFixed(1)}`).join(' ')}"/>`);
		runs.forEach((r, i) => {
			const tip = `${r.date} ${s(r.commit)}: 틀림 ${r.false ?? 0} (${pct(r.false_rate ?? 0)}), 확인 못 함 ${r.unverified ?? 0} (${pct(r.unverified_rate ?? 0)}), recall@5 ${r.recall5 ?? '-'}`;
			o.push(`<circle class="q-dot ${cls}" cx="${xs(i).toFixed(1)}" cy="${y(r[k] ?? 0).toFixed(1)}" r="3.5" data-tip="${h(tip)}"/>`);
		});
	}
	runs.forEach((r, i) => o.push(`<text class="pl-ax" x="${xs(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${s(r.date).slice(5)}</text>`));
	o.push('</svg>');
	const legend = '<div class="pl-legend"><span class="pl-lg q-lg-false">틀림 비율</span><span class="pl-lg q-lg-unv">확인 못 함 비율</span><span>점에 마우스를 올리면 그날 숫자</span></div>';
	const rows = ["<table class='pl-table'><thead><tr><th>날짜</th><th>커밋</th><th>주장</th><th>틀림</th><th>확인 못 함</th><th>낡음</th><th>hit@1</th><th>recall@5</th></tr></thead><tbody>"];
	for (const r of [...runs].reverse())
		rows.push(`<tr><td>${h(s(r.date))}</td><td><code>${h(s(r.commit))}</code></td><td>${s(r.checkable)}</td><td>${s(r.false)}</td><td>${s(r.unverified)}</td><td>${s(r.stale)}</td><td>${s(r.hit1)}</td><td>${s(r.recall5)}</td></tr>`);
	rows.push('</tbody></table>');
	return `<div class="pl-chart">${o.join('')}</div>${legend}` + rows.join('');
}

function tasks(q: Q, here: string): string {
	const r = q.rep, docs = r.docs;
	const groups: Record<string, any[]> = {};
	for (const f of r.findings) {
		const mutable = docs[f.path]?.mutable ?? true;
		const key = !mutable ? '4' : f.verdict === 'false' ? '1' : f.verdict === 'stale' ? '2' : '3';
		(groups[key] ??= []).push(f);
	}
	const title: Record<string, [string, string]> = {
		'1': ['고칠 것: 틀린 주장 (살아 있는 문서)', '가리킨 것이 저장소·이슈·포트 표에 없습니다. 먼저 고칩니다.'],
		'2': ['맞출 것: 낡은 근거', '대체된 기록을 인용하거나, 가리키는 코드가 문서보다 나중에 바뀌었습니다.'],
		'3': ['확인할 것: 근거를 못 찾은 주장', '틀렸다는 뜻은 아닙니다. 근거를 링크하거나 (예정)·(외부 출처)를 표시하면 사라집니다.'],
		'4': ['기록 문서 (고치지 않음)', 'ADR·VR·주간 보고·작업 내역은 쓴 뒤 고치지 않습니다. 당시 사실이면 그대로 두고, 바로잡을 것이면 새 문서(새 VR, 새 ADR)로.'],
	};
	const out: string[] = [];
	for (const key of ['1', '2', '3', '4']) {
		const fs_ = groups[key] ?? [];
		const [t, sub] = title[key];
		const byDoc = new Map<string, any[]>();
		for (const f of fs_) byDoc.set(f.path, [...(byDoc.get(f.path) ?? []), f]);
		out.push(`<details class="q-group q-g${key}"${key === '1' || key === '2' ? ' open' : ''}><summary><b>${t}</b> <span class="pl-cnt">${fs_.length}건 · 문서 ${byDoc.size}개</span></summary><p class="pl-note">${sub}</p>`);
		if (!fs_.length) {
			out.push('<p class="pl-note">없음</p></details>');
			continue;
		}
		out.push("<table class='pl-table q-tasks'><thead><tr><th>문서</th><th>줄</th><th>종류</th><th>주장</th><th>판정</th><th>할 일</th></tr></thead><tbody>");
		for (const p of [...byDoc.keys()].sort((a, b) => byDoc.get(b)!.length - byDoc.get(a)!.length || a.localeCompare(b)))
			for (const f of byDoc.get(p)!.sort((a, b) => a.line - b.line)) {
				const [kname, , fix] = KIND[f.kind] ?? [f.kind, '', ''];
				out.push(
					`<tr><td>${docLink(here, p, f.line, docs[p]?.id || p.replace('docs/', ''))}</td><td>${f.line || ''}</td><td>${kname}</td><td><code>${h(s(f.text))}</code></td>` +
						`<td><span class="q-v q-v-${f.verdict}">${VERDICT[f.verdict]}</span> ${h(s(f.detail))}</td><td class="pl-sub">${h(fix)}</td></tr>`,
				);
			}
		out.push('</tbody></table></details>');
	}
	return out.join('');
}

function docsTable(q: Q, here: string): string {
	const rows = ["<table class='pl-table pl-sort'><thead><tr><th data-sort>문서</th><th data-sort>층</th><th data-sort>주장</th><th data-sort>근거율</th><th data-sort>틀림</th><th data-sort>확인 못 함</th><th data-sort>낡음</th></tr></thead><tbody>"];
	const bad = (d: any) => d.false * 10 + d.stale * 3 + d.unverified;
	for (const [p, d] of (Object.entries(q.rep.docs) as [string, any][]).sort((a, b) => bad(b[1]) - bad(a[1]) || a[0].localeCompare(b[0]))) {
		const n = d.ok + d.false + d.unverified;
		if (!n && !d.stale) continue;
		const rate = n ? d.ok / n : 1;
		rows.push(
			`<tr><td>${docLink(here, p, 0, (d.id ? d.id + ' ' : '') + p.replace('docs/', ''))}</td><td>${h(s(d.layer))}</td><td data-v="${n}">${n}</td><td data-v="${rate.toFixed(4)}">${pct(rate)}</td>` +
				`<td data-v="${d.false}">${d.false || ''}</td><td data-v="${d.unverified}">${d.unverified || ''}</td><td data-v="${d.stale}">${d.stale || ''}</td></tr>`,
		);
	}
	rows.push('</tbody></table>');
	return '<p class="pl-note">문제가 많은 문서가 위에 옵니다(틀림 × 10 + 낡음 × 3 + 확인 못 함). 열 이름을 누르면 정렬합니다.</p>' + rows.join('');
}

function kinds(q: Q): string {
	const rows = ["<table class='pl-table'><thead><tr><th>종류</th><th>무엇을 확인하나</th><th>틀림</th><th>확인 못 함</th><th>낡음</th><th>고치는 법</th></tr></thead><tbody>"];
	for (const [k, [name, what, fix]] of Object.entries(KIND)) {
		const c = q.rep.kinds?.[k] ?? {};
		rows.push(`<tr><td><b>${name}</b> <code>${k}</code></td><td>${h(what)}</td><td>${c.false || ''}</td><td>${c.unverified || ''}</td><td>${c.stale || ''}</td><td class='pl-sub'>${h(fix)}</td></tr>`);
	}
	rows.push('</tbody></table>');
	return rows.join('');
}

function retrieval(q: Q, here: string): string {
	const rt = q.rep.retrieval;
	if (!rt) return '<p class="pl-note"><code>docs/quality/questions.json</code>이 없어 검색 평가를 하지 않았습니다.</p>';
	const src = rt.recorded ? ` (호스트에서 잰 기록 ${h(s(rt.recorded).replace('T', ' '))}, <code>docs_check.py --record</code>)` : '';
	const f2 = (x: any) => Number(x ?? 0).toFixed(2);
	const rows = [
		`<p class="pl-note">${rt.n}문항, 검색 방식 <b>${h(s(rt.mode || 'bm25'))}</b>${src}: hit@1 ${f2(rt.hit1)} (정답 문서가 1위), recall@5 ${f2(rt.recall5)} (5위 안), ` +
			`MRR ${f2(rt.mrr)} (정답 순위의 역수 평균). 에이전트가 문서를 못 찾았거나 틀린 문서를 인용했던 질문을 여기 더해 갑니다.</p>`,
	];
	const modes = rt.modes || {};
	if (Object.keys(modes).length) {
		const KN: Record<string, string> = { exact: '문서 단어로 물음', paraphrase: '다른 말로 물음' };
		rows.push("<table class='pl-table'><thead><tr><th>검색 방식</th><th>모델</th><th>질문</th><th>hit@1</th><th>recall@5</th><th>MRR</th></tr></thead><tbody>");
		for (const [m, r] of Object.entries(modes) as [string, any][]) {
			const name = ({ bm25: 'BM25 (단어)', hybrid: '하이브리드 (BM25 + 임베딩, RRF)' } as any)[m] ?? m;
			const model = h(s(r.model).split('/').pop() || '') || '—';
			rows.push(`<tr><td><b>${name}</b></td><td>${model}</td><td>전체 ${r.n}</td><td>${f2(r.hit1)}</td><td>${f2(r.recall5)}</td><td>${f2(r.mrr)}</td></tr>`);
			for (const [k, v] of Object.entries(r.by_kind || {}) as [string, any][])
				rows.push(`<tr><td></td><td></td><td>${KN[k] ?? h(k)} ${v.n}</td><td>${f2(v.hit1)}</td><td>${f2(v.recall5)}</td><td>${f2(v.mrr)}</td></tr>`);
		}
		rows.push('</tbody></table>');
		if (!('hybrid' in modes))
			rows.push(`<p class="pl-note">임베딩 서버가 꺼져 있어 BM25만 쟀습니다(<code>${h(hint('embed_start', '임베딩 서버: DOCS_EMBED_URL'))}</code>). 문서 빌드 환경에서는 서버(127.0.0.1)에 닿지 않을 수 있습니다.</p>`);
	}
	rows.push("<table class='pl-table pl-sort'><thead><tr><th data-sort>순위</th><th>질문</th><th>정답</th><th>검색 1~3위</th></tr></thead><tbody>");
	for (const x of [...(rt.rows || [])].sort((a, b) => (a.rank || 99) - (b.rank || 99))) {
		const want = (x.expect || []).map((w: string) => docLink(here, w, 0, w.replace('docs/', ''))).join('<br>');
		const top = (x.top || []).map((t: string) => docLink(here, t, 0, t.replace('docs/', ''))).join('<br>');
		rows.push(`<tr${x.rank === 1 ? '' : ' class="q-miss"'}><td data-v="${x.rank || 99}">${x.rank || '없음'}</td><td>${h(s(x.q))}</td><td>${want}</td><td>${top}</td></tr>`);
	}
	rows.push('</tbody></table>');
	return rows.join('');
}

function incidents(q: Q): string {
	const inc = q.incidents;
	if (!inc.length) return '<p class="pl-note">기록된 사례가 없습니다.</p>';
	const cnt: Record<string, number> = {};
	for (const i of inc) cnt[i.type ?? '-'] = (cnt[i.type ?? '-'] ?? 0) + 1;
	const head = '<p class="pl-note">유형별: ' + Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${h(k)} ${v}`).join(' · ') + '</p>';
	const rows = ["<table class='pl-table'><thead><tr><th>날짜</th><th>누가</th><th>유형</th><th>주장 → 사실</th><th>어떻게 알았나</th><th>막는 법</th></tr></thead><tbody>"];
	for (const i of [...inc].sort((a, b) => s(b.date).localeCompare(s(a.date))))
		rows.push(
			`<tr><td>${h(s(i.date))}</td><td>${h(s(i.agent))}</td><td>${h(s(i.type))}</td><td>${h(s(i.claim))}<div class='pl-sub'>→ ${h(s(i.truth))}</div></td>` +
				`<td>${h(s(i.caught_by))}</td><td>${h(s(i.prevention))}</td></tr>`,
		);
	rows.push('</tbody></table>');
	return head + rows.join('');
}

export function qualityMarkers(cfg: KitConfig, page: { rel: string }): Record<string, MarkerHandler> {
	if (!enabled(cfg, 'quality') || !fs.existsSync(path.join(DOCS_DIR, 'quality'))) return {};
	const here = page.rel;
	// lazy: the report (docs_check.py) is made only when a page has one of these markers
	const run = (f: (q: Q) => string) => () => {
		const q = loadQuality(cfg);
		return q ? f(q) : '<div class="kit-pending">근거 점검 보고서를 만들지 못했습니다(빌드 경고 참고).</div>';
	};
	return {
		'quality-summary': run(summary),
		'quality-trend': run(trend),
		'quality-tasks': run((q) => tasks(q, here)),
		'quality-docs': run((q) => docsTable(q, here)),
		'quality-kinds': run(kinds),
		'quality-retrieval': run((q) => retrieval(q, here)),
		'quality-incidents': run(incidents),
	};
}
