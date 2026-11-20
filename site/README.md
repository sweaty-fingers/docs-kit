# docs-kit site engine (Astro edition)

The site part of docs-kit, rebuilt on Astro ([../prd.md](../prd.md), decisions in [../decisions/](../decisions/)). Run it
through the kit's `bin/docs.sh` (it sets `DOCS_ROOT`, `DOCS_KIT`); `npm test` runs the unit tests.

```text
astro.config.mjs        static output to <project>/build/site, base from docs-kit.yml site.base, format "file"
src/config/             paths.ts (kit, project, output), load.ts (docs-kit.yml + zod, mkdocs.yml fallback), features.json
src/markdown/           pre.ts (pymdownx-compatible source passes), pipeline.ts (unified: GFM, KaTeX, Shiki, anchors, links)
src/lib/                site.ts (docs/ over assets/, render, cache), links.ts (§ links, checks), nav.ts (menu), markers.ts,
                        records.ts (ADR + C4, VR, EXP, arc42, P), warnings.ts
src/layouts/Page.astro  header, tab row, sidebar, page, "이 페이지", previous / next, drawer, search
src/pages/              [...slug].astro (every page), r/[name].astro (short addresses), adr/viewer/data.json.ts, 404.astro
src/integration.ts      dev: watch + static files; build: README pages → a/index.html, static files, vendor, Pagefind,
                        warning summary
public/_kit/            kit.css, kit.js (no dependencies)
tests/                  node --test
```

## Milestones (prd.md §11)

| Milestone | State |
| --- | --- |
| M0 decisions | done: [../decisions/0001-astro-engine.md](../decisions/0001-astro-engine.md) |
| M1 skeleton | done: site, `docs.sh` (docker / host), Dockerfile (not tested here: no Docker daemon), config, overlay, urls, layout, theme, tabs, warnings |
| M2 Markdown | done: FR-MD-1..13, FR-CORE-1..5 and 7..8, KaTeX, Mermaid with zoom, Pagefind, responsive layout and drawer |
| M3 tab settings | done: FR-NAV, features.json shared with `kit.py`, `kit.py init` / `migrate`, plain-page tabs, selftest for the five profiles |
| M4 record tabs | done: ADR (index, log, cards, C4 model checks, viewer data, `c4-view` embeds), records, experiments, arc42, publications, back links; the viewer itself is the kit's standalone page (assets/adr/viewer/, elkjs from npm) |
| M5 progress tabs | done: weekly (checks, index, threads, cards, number links), roadmap (map, item pages, viewer data), plan (every dashboard marker, board data); the roadmap viewer and the board are the kit's standalone pages |
| M6 grounding, map | done: quality (runs bin/docs_check.py with the host Python, report cached in build/quality/), graph (links from the finished pages, relations, similarity, topics; viewer data) |
| M7 migration checks | done except hand checks on real phones and the touch parts of FR-UI-7 (see below) |
| M8 documents | partly: usage page and standard updated for the new commands |

## M7 verification (2026-11-21)

Measured on macOS (Apple silicon), host runner, Node 24, Astro 7.4.13. Rerun with `bin/compare_editions.sh [project]`.

| Check | Result | Limit |
| --- | --- | --- |
| MIG-1 docs format | the same `docs/` builds with both editions; one exception: MkDocs reserves the front-matter key `template:`, so a project written for the Astro edition that uses it (robot-manipulation's reference pages) needs it renamed to build on MkDocs, not the other way round | unchanged |
| MIG-2 addresses | fixture (every tab) and robot-manipulation: 60 / 60 pages, same paths; viewer, board, short-address files identical; repeated headings now get `_1`, `_2` like Python-Markdown (they were `-1`) | same |
| MIG-3 `kit.py migrate` | `site_name`, `extra.links.short`, `nav` moved to `docs-kit.yml`; second run: "nothing to move" | idempotent |
| MIG-4 comparison | `bin/site_diff.py`: 0 differences beyond `tests/site-diff-allow.txt` (404 title, two extra anchors on the dashboard) | 0 or listed |
| MIG-5 output | `build/site/`, `docs.sh build` | unchanged |
| NFR-2 telemetry | `ASTRO_TELEMETRY_DISABLED=1` set by `docs.sh` | off |
| NFR-3 build time | 326 pages (300 documents): cold build 4.3 s; preview after editing one document 0.3 s (3 runs) | 60 s / 2 s |
| NFR-4 JS on a normal page | `kit.js` 6.8 KB + inline 0.3 KB gzip; Mermaid and Pagefind load on demand | 30 KB |
| NFR-5 same input, same output | two cold builds: only the grounding page's report time (and the search index entry of that page) differ | build time only |
| Mobile (390 x 844 and 844 x 390, touch) | all 64 pages incl. the 4 viewers: no horizontal overflow (fixed: board top bar wraps, C4 viewer drawer no longer scrollable into view); drawer menu opens | 0 overflow |

Not done: hand checks on a real Android Chrome and iOS Safari phone; the FR-UI-7 touch parts of the viewers (pinch zoom, bottom sheet on every viewer, 44 px tap targets) and NFR-9 frame rates were not measured; the Docker runner (deferred).

