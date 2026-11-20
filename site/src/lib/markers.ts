// Marker lines (prd.md FR-MD-13): `<!-- name -->` / `<!-- name: arg k=v -->` on a line of its own becomes a table or
// a component. Each tab module owns its markers; this file has the common ones and a placeholder for the markers of
// tabs that the Astro edition does not build yet (milestones M4-M6), so a page shows that something will be there.
import { BY_ID, enabled, FEATURES, PROFILES, type KitConfig } from '../config/load.ts';
import { escapeHtml, type MarkerHandler } from '../markdown/pre.ts';
import { recordMarkers } from './records.ts';

interface Ctx {
	page: { rel: string; url: string };
	cfg: KitConfig;
}

function upTo(url: string): string {
	return '../'.repeat(url.split('/').length - 1);
}

function featuresTable(cfg: KitConfig): string {
	const prof = cfg.profile + (cfg.found ? '' : ' (docs-kit.yml 없음: 폴더가 있는 탭만)');
	const rows = [
		`묶음(profile): **${prof}**. 바꾸는 법: \`.docs-kit/bin/kit.py enable <id>\`, \`disable <id>\`, \`profile <이름>\` ([문서 규격](docs-standard.md) §13).`,
		'',
		'| id | 탭 | 상태 | 담는 것 | 함께 쓰면 좋은 탭 |',
		'| --- | --- | --- | --- | --- |',
	];
	for (const f of FEATURES)
		rows.push(
			`| \`${f.id}\` | ${f.title} | ${enabled(cfg, f.id) ? '**켬**' : '끔'} | ${f.summary} | ${f.recommends.map((r) => BY_ID[r].title).join(', ')} |`,
		);
	rows.push('', '| 묶음 | 켜지는 탭 |', '| --- | --- |');
	for (const [name, p] of Object.entries(PROFILES)) rows.push(`| \`${name}\` | ${p.summary}: ${p.features.map((i) => BY_ID[i].title).join(', ')} |`);
	return rows.join('\n');
}

function areasTable(cfg: KitConfig): string {
	const rows = ['| `area` 값 | 분야 |', '| --- | --- |', ...Object.entries(cfg.areas).map(([k, v]) => `| \`${k}\` | ${v} |`)];
	return rows.join('\n') + '\n\n분야 목록은 프로젝트의 `docs-kit.yml` `areas`에서 바꿉니다.';
}

function kind(to: string): string {
	if (to.startsWith('rerun:')) return `Rerun 기록 <code>${escapeHtml(to.slice(6))}</code>`;
	if (to.startsWith('catalog:')) return `Rerun 기록 목록 (카탈로그 <code>:${escapeHtml(to.slice(8).split('@')[0])}</code>)`;
	if (to.startsWith('port:')) return `같은 PC의 <code>:${escapeHtml(to.slice(5))}</code>`;
	return `문서 <code>${escapeHtml(to)}</code>`;
}

function shortLinks(ctx: Ctx): string {
	const up = upTo(ctx.page.url);
	const rows = ['| 짧은 주소 | 열리는 곳 | 설명 |', '| --- | --- | --- |'];
	for (const s of ctx.cfg.links)
		rows.push(
			`| <a class="kit-short" href="${up}r/${s.name}/index.html" data-path="/r/${s.name}/">/r/${s.name}/</a> | ${kind(s.to)} | ${escapeHtml(s.title)} |`,
		);
	if (!ctx.cfg.links.length) rows.push('| (없음) | `docs-kit.yml`의 `links`에 추가 | |');
	return rows.join('\n');
}

/** Hosted viewer address with the version folder when a version is set (app.rerun.io/version/<v>/). */
export function hostedBase(s: KitConfig['rerun']): string {
	const base = s.hosted_url.endsWith('/') ? s.hosted_url : s.hosted_url + '/';
	return s.version ? `${base}version/${s.version}/` : base;
}

function rerunBox(ctx: Ctx, file: string, opts: Record<string, string>): string {
	const s = ctx.cfg.rerun;
	const height = Number(opts.height || 560);
	const name = escapeHtml(file.split('/').pop() || file);
	const data =
		`data-file="${escapeHtml(file)}" data-web-port="${s.web_port}" data-file-port="${s.file_port}" data-height="${height}" ` +
		`data-viewer="${s.viewer}" data-hosted="${escapeHtml(hostedBase(s))}"`;
	return (
		`<div class="rerun-embed" ${data}>` +
		`<div class="rerun-embed__bar"><span class="rerun-embed__name">Rerun · <code>${name}</code></span>` +
		`<span class="rerun-embed__state">서버 확인 중…</span>` +
		`<button type="button" class="rerun-embed__load" disabled>뷰어 불러오기</button>` +
		`<a class="rerun-embed__open" target="_blank" rel="noopener">새 창에서 열기</a></div>` +
		(s.viewer === 'hosted'
			? `<div class="rerun-embed__off" hidden>기록 파일을 찾지 못했습니다. <code>docs/${escapeHtml(file)}</code>가 사이트에 올라가 있는지(또는 주소가 맞는지) 확인합니다.</div>`
			: `<div class="rerun-embed__off" hidden>Rerun 서버가 응답하지 않습니다. 문서 서버가 도는 PC에서 <code>${escapeHtml(s.start)}</code>를 실행한 뒤 이 페이지를 새로고침합니다.</div>`) +
		`<div class="rerun-embed__frame"></div></div>`
	);
}

/** Markers of tabs whose Astro module comes in a later milestone (prd.md §11). */
const PENDING: Record<string, [string, string]> = {
	'adr-index': ['adr', 'M4'], 'adr-log': ['adr', 'M4'], 'c4-app': ['adr', 'M4'], 'c4-elements': ['adr', 'M4'], 'c4-view': ['adr', 'M4'],
	'arc42-index': ['arc42', 'M4'], 'pub-index': ['publications', 'M4'], 'exp-index': ['experiments', 'M4'], 'vr-index': ['records', 'M4'],
	'weekly-index': ['weekly', 'M5'], 'weekly-threads': ['weekly', 'M5'],
	'roadmap-map': ['roadmap', 'M5'], 'roadmap-units': ['roadmap', 'M5'], 'roadmap-table': ['roadmap', 'M5'],
	'plan-summary': ['plan', 'M5'], 'plan-burnup': ['plan', 'M5'], 'plan-sprint-now': ['plan', 'M5'], 'plan-stages': ['plan', 'M5'],
	'plan-epics': ['plan', 'M5'], 'plan-questions': ['plan', 'M5'], 'plan-changes': ['plan', 'M5'], 'plan-sprints': ['plan', 'M5'],
	'risk-summary': ['plan', 'M5'], 'risk-matrix': ['plan', 'M5'], 'risk-top': ['plan', 'M5'], 'risk-trend': ['plan', 'M5'], 'risk-register': ['plan', 'M5'],
	'graph-map': ['graph', 'M6'],
	'quality-summary': ['quality', 'M6'], 'quality-trend': ['quality', 'M6'], 'quality-tasks': ['quality', 'M6'], 'quality-docs': ['quality', 'M6'],
	'quality-kinds': ['quality', 'M6'], 'quality-retrieval': ['quality', 'M6'], 'quality-incidents': ['quality', 'M6'],
};

export function markerHandlers(ctx: Ctx): Record<string, MarkerHandler> {
	const h: Record<string, MarkerHandler> = {
		'kit-features': () => featuresTable(ctx.cfg),
		'kit-areas': () => areasTable(ctx.cfg),
		'short-links': () => shortLinks(ctx),
		rerun: (args, opts) => (args ? rerunBox(ctx, args.split(/\s+/)[0], opts) : null),
	};
	// tabs built so far (M4): their markers come from the tab module when the tab is on
	const DONE = new Set(['adr', 'records', 'experiments', 'arc42', 'publications']);
	for (const [name, [tab, milestone]] of Object.entries(PENDING)) {
		if (DONE.has(tab)) {
			h[name] = () => `<div class="kit-pending">${escapeHtml(BY_ID[tab].title)} 탭이 꺼져 있습니다(<code>.docs-kit/bin/kit.py enable ${tab}</code>).</div>`;
			continue;
		}
		h[name] = (args) =>
			`<div class="kit-pending" data-marker="${name}">표시 줄 <code>&lt;!-- ${name}${args ? ': ' + escapeHtml(args) : ''} --&gt;</code>: ` +
			`${escapeHtml(BY_ID[tab].title)} 탭의 표·그림은 Astro 판 ${milestone} 단계에서 만들어집니다.</div>`;
	}
	return { ...h, ...recordMarkers(ctx.cfg, ctx.page) };
}
