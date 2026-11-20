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
| M5 progress tabs | to do: weekly, roadmap, plan + board |
| M6 grounding, map | to do: quality, graph |
| M7 migration checks | to do |
| M8 documents | partly: usage page and standard updated for the new commands |
