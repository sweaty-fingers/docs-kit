# docs-kit 구축 컨텍스트

이 문서는 docs-kit **전체를 다른 세션·다른 환경에서 그대로 다시 만들거나 이어서 고칠 수 있도록** 구조, 동작, 형식, 도구, 시험, 에이전트 운영을 한곳에 적은 명세입니다. 에이전트가 처음 읽는 문서로 씁니다.

> 기준: docs-kit 0.15.4, 2026-11-20. 키트 동작을 바꾸면 이 문서의 해당 절도 같은 커밋에서 고칩니다(AGENTS-GUIDE §7).

- **저장소가 있으면 저장소가 정본**입니다. 이 문서와 코드가 다르면 코드를 믿고 이 문서를 고칩니다.
- **저장소를 가져갈 수 있으면** 복제가 가장 확실합니다(`git clone`, 또는 `git bundle create docs-kit.bundle --all`로 파일 하나로 옮김). 이 명세는 가져갈 수 없을 때 다시 만드는 기준이고, 순서는 §12입니다.
- 키트를 Astro로 처음부터 다시 만드는 요구사항은 [prd.md](prd.md)입니다. 이 문서는 그 구현이 따라야 할 지금 판의 동작 기준입니다.
- 사람용 안내와 에이전트 지시문: [README.md](README.md). 에이전트 절차: [AGENTS-GUIDE.md](AGENTS-GUIDE.md). 문서 규격 본문: `assets/docs-standard.md`.

---

## 1. 목적과 요구사항

| # | 요구사항 | 어떻게 충족하나 |
| --- | --- | --- |
| R1 | 여러 프로젝트가 같은 규격으로 문서를 쓰고 웹으로 봄 | 키트 = git 저장소 하나, 프로젝트에 서브모듈 `.docs-kit/`. MkDocs Material 기본 설정을 `INHERIT` |
| R2 | 키트에는 구조·템플릿·예시만, 내용은 프로젝트가 채움 | 키트 페이지는 목록·안내·템플릿과 표시 줄(`<!-- ... -->`)뿐. 프로젝트 고유 이름·값·경로를 넣지 않음. 프로젝트 파일이 같은 경로 키트 파일을 덮어씀 |
| R3 | 모든 탭 기능을 갖되 프로젝트마다 켤 탭을 고름 | `docs-kit.yml`(묶음 `profile` + `features` 덮어쓰기), `hooks/kitconf.py`의 `gate()`, `bin/kit.py enable/disable/profile` |
| R4 | 새 탭이 필요하면 먼저 있는 템플릿을 켬 | 탭 목록·설명을 `kit.py status`, 사이트의 `<!-- kit-features -->` 표, 규격 §13, AGENTS-GUIDE §6에 둠. 켜면 시작 파일이 복사됨 |
| R5 | 새 프로젝트와 진행 중 프로젝트 모두 지원 | README §1.1/§1.2 지시문, AGENTS-GUIDE §2(묻기 → 제안 → 승인 → 실행)/§3(조사 → 이전 대응표 → 승인 → 이전) |
| R6 | 제안 먼저, 사용자 승인 뒤 작업 | AGENTS-GUIDE 원칙 1, 제안서 형식 §4 |
| R7 | 프로젝트에서 바꾼 형식이 키트에 반영되어 늘 최신 | AGENTS.md 템플릿 D6, AGENTS-GUIDE §7: 공통 형식은 키트에서 고치고 키트 먼저 push. `kit.py check --fetch`가 새 버전을 알리고 `kit.py update`로 받음 |
| R8 | 에이전트가 일관되게 키트를 씀 | `template/agents/AGENTS.docs-kit.md`(프로젝트 AGENTS.md에 넣는 절, 탭별 항목 `[탭: id]`) |
| R9 | 사내망만, 외부 인터넷 없이 동작 | MathJax·Mermaid·ELK를 키트에 내장, 외부 스크립트 금지(selftest가 검사), 로컬 모델 서버는 127.0.0.1 |
| R10 | 호스트에 설치 최소 | 사이트는 고정 Docker 이미지, 호스트 도구는 Python 3.8 표준 라이브러리만 |
| R11 | 할루시네이션을 줄이는 근거 체계 | 문서 검색(`docs_search.py`), 근거 점검(`docs_check.py` + 근거 점검 탭), 질문 답의 문장별 인용 점검(`docs_ask.py`) |
| R12 | 빌드 경고 0 = 문서 작업 끝 | 모든 훅이 형식 위반을 MkDocs `WARNING`으로 냄 |

## 2. 설계 원칙

1. **사실은 정본에만**(arc42, ADR, EXP, VR, MC). 발행물·보고·가이드는 링크·인용. **할 일은 이슈 트래커**(문서에 체크리스트 없음, 예외: 로드맵·현황판은 큰 흐름과 상태 원천 링크).
2. **기록은 추가만**: ADR(승인 뒤), VR, EXP, 주간 보고(발행 뒤), 발행물 스냅숏. 바뀌면 새 문서 + `supersedes`.
3. **원천 하나**: 상태는 로드맵·이슈 스냅숏에서만, 리스크는 `risks.yml`에서만, 용어는 용어집 색인에서만.
4. **자동화는 머리말과 표시 줄로**: 목록·카드·메뉴는 머리말(front matter)에서, 표·그림은 페이지의 `<!-- 표시 -->` 한 줄에서 빌드 때 만듦. 손으로 쓰는 목록 없음.
5. **화면 문구 한국어, 코드·주석·CLI 출력 영어.** 문서 문체 "~합니다", 날짜 `YYYY-MM-DD`.
6. **덮어쓰기 가능**: 프로젝트 `docs/`의 같은 경로 파일이 키트 파일보다 우선.
7. **꺼진 탭은 완전히 빠짐**: 훅은 아무것도 안 하고, 키트 페이지는 메뉴 밖(링크는 살아 있음), 프로젝트 문서는 남음.

---

## 3. 실행 환경과 저장소 구조

| 항목 | 값 |
| --- | --- |
| 사이트 이미지 | `squidfunk/mkdocs-material:9.5.49` (MkDocs 1.6.1, Python 3.11). `DOCS_IMAGE`로 바꿈 |
| 호스트 도구 | Python 3.8+, 표준 라이브러리만(PyYAML이 있으면 `kitconf.parse`가 씀) |
| 내장 라이브러리 | MathJax 3.2.2(tex-mml-chtml + 글꼴 + TeX 확장), Mermaid 11.4.1, elkjs 0.9.3. 출처·sha256은 `assets/_kit/vendor/README.txt`, `assets/adr/viewer/vendor/README.txt` |
| 포트 기본값 | 공유 사이트 8000(`docs.sh`의 `DOCS_PORT` 기본), 개발 미리보기 8001(프로젝트가 정함), 보드 저장 8002, 질문 서버 8003, 임베딩 9298, 생성 9299(프로젝트 서버) |

```text
docs-kit/
  README.md  AGENTS-GUIDE.md  docs-kit-context.md  CHANGELOG.md  VERSION  .gitignore(build/, __pycache__/, *.pyc)
  mkdocs.base.yml                 # 프로젝트가 INHERIT
  hooks/
    kitconf.py                    # 탭 목록·묶음·분야, docs-kit.yml 읽기, gate(), nav 도우미 (훅 아님, import됨)
    kit.py                        # 첫 훅: 설정 읽기, 키트 자산 더하기, 일반 탭 메뉴, kit-features/kit-areas 표
    lists.py  section_links.py    # 공통: 목록 바로잡기, §4.3 링크
    adr.py records.py experiments.py arc42.py publications.py weekly.py roadmap.py graph.py plan.py quality.py
    rerun_embed.py  links.py      # 공통: Rerun 상자, 짧은 주소·서버 링크
    kit_nav.py                    # 마지막 훅: 탭 순서
  assets/                         # 사이트 경로 그대로 들어감 (hooks/kit.py)
    docs-standard.md  docs-kit.md
    _kit/stylesheets/{theme,adr,diagram-zoom,roadmap,plan}.css
    _kit/javascripts/{mathjax,rerun-embed,links,diagram-zoom,plan}.js
    _kit/vendor/{mathjax,mermaid}/
    adr/{README,log,c4,guide,template}.md  adr/viewer/{index.html,viewer.js,viewer.css,vendor/elk.bundled.js}
    arc42/{README,template}.md
    publications/{README,template}.md
    experiments/{README,list,template}.md
    records/{README,template}.md
    weekly/{README,threads,template}.md
    roadmap/{README,guide}.md  roadmap/viewer/{index.html,viewer.js,viewer.css}
    graph/README.md  graph/viewer/{index.html,graph.js,graph.css}
    plan/{README,sprints,guide}.md  plan/board/{index.html,board.js,board.css}
    quality/README.md
  template/
    base/{mkdocs.yml,docs-kit.yml,docs/README.md}
    features/<id>/<프로젝트 경로>  # adr, roadmap, plan, quality, history, guides, reference, shared, background, glossary, models
    agents/AGENTS.docs-kit.md
  tests/fixtures/all/             # selftest 고정 입력 (docs/ 아래 그대로, README.append.md)
  bin/
    kit.py init.sh docs.sh selftest.sh
    docs_search.py docs_check.py docs_ask.py serve.sh plan_board.py repro.sh weekly_draft.py
```

프로젝트 쪽 모양:

```text
<프로젝트>/
  .docs-kit/            # 서브모듈 (직접 고칠 때는 AGENTS-GUIDE §7)
  docs-kit.yml          # 켤 탭, 분야
  mkdocs.yml            # INHERIT: .docs-kit/mkdocs.base.yml, site_name, extra, nav(개요만이어도 됨)
  AGENTS.md (+ CLAUDE.md: @AGENTS.md)
  docs/ ...             # 내용
  build/                # git 제외: site/, quality/, rag/, plan/, serve/, repro/, weekly/
```

---

## 4. 사이트 조립 방식

### 4.1 `mkdocs.base.yml`

- `docs_dir: docs`, `site_dir: build/site`, `use_directory_urls: false`(`.md` 상대 링크가 그대로 동작).
- 테마 material, `language: ko`, `font: false`(시스템 글꼴), 로고 아이콘, 기능 `navigation.tabs(.sticky)`, `navigation.sections`, `navigation.indexes`, `navigation.top`, `navigation.footer`, `search.suggest`, `search.highlight`, `content.code.copy`, `toc.follow`. 팔레트 밝음/어두움 둘 다 `primary: custom`, `accent: custom`(색은 `theme.css`).
- 훅 순서(순서가 뜻이 있음):

| 순서 | 훅 | 이유 |
| --- | --- | --- |
| 1 | `kit.py` | 다른 훅보다 먼저 `docs-kit.yml`을 읽고(캐시 초기화), 원래 nav 제목을 기억하고, 키트 자산을 더함 |
| 2 | `lists.py` | 마크다운 단계에서 목록 들여쓰기를 먼저 바로잡음 |
| 3 | `section_links.py` | 렌더된 HTML의 `§` 참조 |
| 4 | `adr.py` | ADR 데이터·C4 `data.json` (records·experiments가 그 뒤에 덧붙임) |
| 5 | `records.py`, `experiments.py` | ADR 카드에 역링크, C4 데이터에 VR |
| 6 | `arc42.py`, `publications.py`, `weekly.py`, `roadmap.py` | 탭별 |
| 7 | `graph.py` | 다른 훅이 링크를 만든 뒤의 HTML로 연결을 셈(`on_page_content`에 `@event_priority(-100)`) |
| 8 | `plan.py` | 로드맵 상태를 읽음 |
| 9 | `quality.py`, `rerun_embed.py`, `links.py` | |
| 10 | `kit_nav.py` | 마지막: 훅이 더한 탭을 규격 순서로 |

- 마크다운 확장: tables, admonition, attr_list, md_in_html, pymdownx.details, pymdownx.tabbed(alternate_style), pymdownx.tasklist(custom_checkbox), pymdownx.highlight, inlinehilite, superfences(mermaid 커스텀 펜스), pymdownx.snippets(`base_path: [docs]`, `check_paths: true`), pymdownx.arithmatex(generic), toc(`title: 이 페이지`, permalink, `slugify: pymdownx.slugs.slugify(case=lower)` → 한글 앵커가 GitHub/GitLab과 같음).
- `extra_css`: theme, adr, diagram-zoom, roadmap, plan. `extra_javascript`: mathjax.js(설정, MathJax보다 먼저), vendor MathJax, vendor Mermaid(전역 `mermaid`가 있으면 Material이 CDN을 안 씀), rerun-embed, links, diagram-zoom, plan.
- `validation: {omitted_files: warn, unrecognized_links: info, anchors: warn}`.

### 4.2 키트 자산 겹치기 (`hooks/kit.py`)

- `on_files`: `assets/` 아래 모든 파일을 같은 상대 경로로 `File(rel, ASSETS, site_dir, use_directory_urls)`로 더함. 프로젝트에 같은 경로가 있으면 건너뜀(프로젝트 우선). `config["watch"]`에 `assets/`.
- 꺼진 탭(§5)의 키트 `.md`는 `InclusionLevel.NOT_IN_NAV`(빌드되고 링크 가능, 메뉴 밖, "nav에 없음" 경고 없음). 프로젝트 `docs/<탭 폴더>/`의 페이지도 꺼진 탭이면 `NOT_IN_NAV`(nav에 직접 적은 것은 예외).
- `on_config`: "문서 규격"(`docs-standard.md`), "문서 사이트 사용법"(`docs-kit.md`)을 nav에 없으면 끝에 더함. 켠 일반 탭(`kind: nav`)의 메뉴를 만듦: `history`는 "개요" 절에 `history.md`를 더하고(없으면 "작업 내역" 탭), 나머지는 `docs/<폴더>/*.md`를 README 먼저·번호 자연 정렬로(템플릿 제외) 한 탭으로. 프로젝트 nav가 그 폴더 파일을 하나라도 적었으면 손대지 않음. 켰는데 페이지가 없으면 `WARNING: kit: feature <id> is on but ...`.
- `on_page_markdown`: 한 줄에 단독인 `<!-- kit-features -->`(탭 표 + 묶음 표), `<!-- kit-areas -->`(분야 표)를 바꿈.

### 4.3 탭 끄기 (`hooks/kitconf.py` `gate`)

각 탭 훅 파일 끝에:

```python
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import kitconf as _kitconf
_kitconf.gate(globals(), "<feature id>")
```

`gate()`는 모듈의 모든 `on_*` 함수를 감쌉니다. `on_config`에서 그 빌드의 켬/끔을 정하고, 꺼져 있으면 모든 이벤트가 첫 인자(config, files, markdown, html, nav)를 그대로 돌려줍니다(`on_post_build`는 None). `functools.wraps`라 `mkdocs_priority`(graph의 `event_priority`)가 유지됩니다. `on_config`가 없는 훅에도 하나를 만들어 넣습니다. ADR·VR·EXP 훅은 감싸기 전에 `on_config`를 한 번 더 감싸 `AREAS`를 `docs-kit.yml`의 `areas`로 바꿉니다.

### 4.4 탭 순서 (`hooks/kit_nav.py`)

`kit.py`가 기억한 "프로젝트가 직접 쓴 최상위 제목" 밖의 탭 중 순위표(`kitconf.RANK`)에 있는 것을 빼서, 순위가 낮은 순서로 "자기보다 순위가 낮은 마지막 탭" 바로 뒤에 다시 넣습니다. 순위: 개요 0, 작업 내역 1, 현황판 2, 주간 보고 3, 로드맵 4, 문서 지도 5, 근거 점검 6, 문서함 7, 아키텍처 8, ADR 9, 실험 10, 검증 기록 11, 모델 12, 실행 가이드 13, 참고 14, 공용 파일 15, 배경 16, 용어집 17, 문서 규격 90, 문서 사이트 사용법 91. 프로젝트가 nav에 직접 쓴 탭과 모르는 제목은 그 자리에 둡니다.

---

## 5. 탭 설정

### 5.1 `docs-kit.yml` (프로젝트 루트)

```yaml
profile: dev              # minimal | app | dev | research | all
features:                 # 묶음 기본값에서 바꿀 탭만 (true/false). 없으면 features: {}
  weekly: false
areas:                    # ADR·VR·EXP 머리말 area 값 (id: 이름). 없으면 기본 분야
  dev-env: 개발 환경
```

- 읽기: PyYAML, 없으면 이 모양(최상위 키, 한 단계 `key: value` 맵, `#` 주석, 따옴표)만 읽는 작은 파서.
- 켬 판정: `features`에 있으면 그 값 → 묶음 목록에 있으면 켬. 파일이 없으면 `auto`: ADR은 늘 켬, 나머지는 `docs/<data>`가 있으면 켬(0.15 이전 프로젝트 호환).
- 모르는 `profile`·탭 id는 빌드 `WARNING: kit: docs-kit.yml: ...`.
- 기본 분야: `arch` 구조·설계, `dev-env` 개발 환경, `platform` 플랫폼·연동, `data` 데이터, `quality` 품질·시험, `safety` 안전·보안, `ops` 배포·운영, `docs` 문서.

### 5.2 탭 목록 (`kitconf.FEATURES`)

| id | 탭 | 종류 | 폴더 (`data`: auto 판정) | 시작 파일 (`template/features/<id>/`) | 함께 |
| --- | --- | --- | --- | --- | --- |
| `history` | 작업 내역 | nav | `history.md` | `docs/history.md` | |
| `plan` | 현황판 | hook | `plan` (`plan/scope.yml`) | `docs/plan/{scope.yml,risks.yml,sprints.json}` | roadmap |
| `weekly` | 주간 보고 | hook | `weekly` | (없음: `weekly_draft.py --write`) | |
| `roadmap` | 로드맵 | hook | `roadmap` (`roadmap/roadmap.yml`) | `docs/roadmap/roadmap.yml` | |
| `graph` | 문서 지도 | hook | `graph` | (없음) | |
| `quality` | 근거 점검 | hook | `quality` | `docs/quality/{config,questions,incidents}.json` | |
| `publications` | 문서함 | hook | `publications` | (없음) | |
| `arc42` | 아키텍처 | hook | `arc42` | 12개 섹션을 `kit.py`가 생성(`aNN_<이름>.md`, `status: empty`) | adr |
| `adr` | ADR | hook | `adr` | `docs/adr/0001-record-architecture-decisions.md`, `docs/adr/c4-model.yml` | |
| `experiments` | 실험 | hook | `experiments` | (없음) | records |
| `records` | 검증 기록 | hook | `records` | (없음) | |
| `models` | 모델 | nav | `models` | `docs/models/README.md` | experiments, records |
| `guides` | 실행 가이드 | nav | `guides` | `docs/guides/g1_getting_started.md` | |
| `reference` | 참고 | nav | `reference` | `docs/reference/r1_ports.md` | |
| `shared` | 공용 파일 | nav | `shared` | `docs/shared/README.md` | |
| `background` | 배경 | nav | `background` | `docs/background/01_background.md` | |
| `glossary` | 용어집 | nav | `glossary` | `docs/glossary/README.md` | |

arc42 섹션 파일 이름: a01_goals, a02_constraints, a03_context, a04_solution_strategy, a05_building_blocks, a06_runtime, a07_deployment, a08_crosscutting, a09_decisions, a10_quality, a11_risks(`<!-- risk-register -->`), a12_glossary.

### 5.3 묶음 (`kitconf.PROFILES`)

| 묶음 | 탭 |
| --- | --- |
| `minimal` | adr, guides, glossary |
| `app` | adr, roadmap, guides, reference, history, glossary |
| `dev` | history, plan, weekly, roadmap, graph, quality, publications, arc42, adr, records, guides, reference, shared, glossary |
| `research` | history, plan, weekly, roadmap, graph, quality, publications, adr, experiments, records, models, guides, background, glossary |
| `all` | 모두 |

### 5.4 `bin/kit.py`

| 명령 | 동작 |
| --- | --- |
| `init [--name N] [--profile P]` | `template/base/` 복사(`{{PROJECT}}`, `{{TODAY}}`, `{{PROFILE}}` 치환, 있는 파일 그대로), 켠 탭의 시작 파일, `.gitignore`에 `build/` |
| `status [--fetch]` | 키트 버전·커밋·브랜치, 고치다 만 것, origin/main과 앞뒤, 프로젝트 묶음·덮어쓰기, 탭마다 켬/끔과 "파일 없음" |
| `enable <id>... [--no-starters]` | 묶음에 있으면 덮어쓰기를 지우고, 없으면 `true`. 시작 파일 복사. 함께 쓰면 좋은 탭 안내 |
| `disable <id>...` | 묶음에 있거나 auto면 `false`, 아니면 덮어쓰기 지움. 문서는 그대로 |
| `profile <이름>` / `profiles` | 묶음 바꾸기 / 묶음 설명 |
| `check [--fetch]` | 세션 시작용. 키트에 커밋 안 된 변경, push 안 된 커밋, 설정 오류, `docs-kit.yml` 없음, 켰는데 파일 없는 탭이 있으면 `WARN` + 종료 코드 1. 새 버전은 `INFO` |
| `update` | 문제 없을 때만 `git fetch` → `checkout -B main origin/main`, 옛 버전 이후 CHANGELOG 제목을 보여 줌 |

`docs-kit.yml`은 줄 단위로 고쳐 주석을 보존합니다. `bin/init.sh "이름" [묶음]`은 `kit.py init`의 얇은 감싸기입니다.

---

## 6. 탭별 명세

공통: 파일 번호는 네 자리(`NNNN-영문-소문자-제목.md`), 제목 첫 줄은 `# <접두사>-NNNN. <제목>`이고 번호가 파일과 같아야 함. 카드는 제목 바로 아래 HTML. 표시 줄은 한 줄에 단독일 때만 바꿈(코드 펜스 안은 그대로). `extra.issues_url`이 있으면 이슈 `#N`과 MR `!N`이 트래커로 링크됨.

### 6.1 ADR과 C4 (`adr`)

- 머리말(필수 `status`, `date`, `deciders`, `area`, `summary`; 선택 `c4`, `supersedes`, `superseded_by`, `related`). `status`: proposed 제안, accepted 승인, rejected 기각, deprecated 폐기, superseded 대체됨.
- 템플릿 순서: 배경 → 결정 요인 → 고려한 선택지(`### N. 이름`마다 **장점 / 단점 / 기각 사유**, 고른 것 `(채택)` + **채택 이유**) → 결정 → 선택지 비교 표 → 결과(좋아지는 점, 감수할 점, 후속 작업) → 재검토 조건 → 참고. 작성 가이드(`assets/adr/guide.md`)에 검토 체크리스트와 "승인 뒤 고치지 않음, 예외: 오타·링크, 후속 작업 체크, 형식 정리".
- 메뉴: nav의 "ADR" 절(없으면 더함)을 README, log, c4, guide, template + 모든 ADR(번호순)로 채움.
- 표시 줄: `<!-- adr-index -->`(번호, 제목, 상태, 분야, 날짜), `<!-- adr-log -->`(시간순 한 줄 요약), `<!-- c4-app -->`(뷰어 삽입), `<!-- c4-elements -->`(요소 표), 어느 페이지에서나 `<!-- c4-view: <뷰 id> [height=N] -->`.
- 카드: 상태 배지, 날짜, 결정한 사람, 분야, 아키텍처 요소(뷰어 링크), 대체 관계, (records·experiments 훅이 더함) 검증 기록·실험.
- C4 모델 `docs/adr/c4-model.yml`: `elements`(`id` 바꾸지 않음, `name`, `kind`: person/system/container/component, `parent`, `technology`, `description`, `external: true` 상속), `relations`(`from`, `to`, `label`, `tech`, `kind`: flow 실선 기본 / alt 점선 택1 / call 짧은 점선 양방향), `views`(`id`, `title`, `description`, `scope`(없으면 최상위 컨텍스트), `include`, `direction: RIGHT|DOWN`, `outside: elements`). 하위 요소 관계는 상위 그림에서 상위 요소 관계로 합쳐짐.
- 뷰어 `adr/viewer/`(독립 페이지, `data.json`을 빌드 뒤 씀): ELK layered + 직각 경로, 카드 HTML + 선 SVG를 한 무대에서 CSS transform으로 이동·확대. 카드 클릭 → 패널(설명, 기술, 결정 카드, 보내는·받는 관계, 검증 기록), 더블클릭 → 안으로(드릴다운), 마우스 올리면 연결만 강조(관계 종류별 색), 결정 필터, 결정 카드 탭, 밝음/어두움, 주소 `#view=<id>&el=<id>`, `#tab=decisions&adr=<n>`, `?embed=1`이면 페이지 테마를 따르고 자체 토글 숨김. 다른 팀·외부는 점선 테두리 채움 없음.
- 검사: 머리말 누락·값, 번호 중복, 파일·제목 번호 불일치, 없는 C4 요소·뷰, 모르는 관계 종류.

### 6.2 arc42 (`arc42`)

- `docs/arc42/aNN_<이름>.md` 12개 모두(비어도). 제목 `# A<N>. <제목>`. 머리말 `arc42: N`, `status`(empty 비어 있음 · partial 일부 · stable 안정 · n/a 해당 없음), `owner`, `reviewed`, 선택 `c4_views`, `summary`.
- 섹션 이름: 1 목표와 요구사항, 2 제약, 3 컨텍스트와 범위, 4 해결 전략, 5 빌딩 블록, 6 런타임, 7 배포, 8 횡단 개념, 9 결정, 10 품질 요구사항, 11 리스크와 기술 부채, 12 용어집. 섹션별 "담는 것 / 연구 과제에서 더 담는 것 / 그림 / 여기 두지 않는 것"은 규격 §3 표.
- 메뉴: "아키텍처" 절 = README, template, 섹션들, 그 밖의 `docs/arc42/*.md`(예: 이전 대응표). `<!-- arc42-index -->`: 섹션, 제목, 담는 것(규격 요약 한 줄), 지금 들어 있는 것(`summary`), 상태, 담당, 확인일, C4 뷰. 카드: 상태, 담당, 확인일, 담는 것.
- 검사: 빠진 섹션, 번호 불일치, 상태 값, owner/reviewed 누락, 없는 C4 뷰.

### 6.3 발행물 (`publications`)

- `docs/publications/NNNN-*.md`, `# P-NNNN.`. 머리말 `kind`(overview 개요 · report 보고서 · release 릴리스 노트 · note 해설 · slides 발표), `audience`, `date`, `status`(draft · published · archived), `based_on`(`[A1, ADR-0004, VR-0002, EXP-0001, MC-0001, G2, R1]`), 스냅숏이면 `commit`.
- `<!-- pub-index -->`, 카드(종류, 독자, 날짜, 상태, 근거 링크, overview 밖은 "이 날짜의 스냅숏" 안내). 정본 끼워 넣기 `--8<-- "arc42/a01_goals.md:rq"`(정본에 `<!-- --8<-- [start:rq] -->` … `[end:rq]`), 예시로 보일 땐 `;--8<--`.
- 검사: 머리말, 번호, 없는 `based_on`, 커밋 없는 발행 스냅숏.

### 6.4 실험 (`experiments`)

- `docs/experiments/NNNN-*.md`, `# EXP-NNNN.`. 연구 질문·가설 하나 = 문서 하나, 실행은 문서 안 "실행 목록" 표의 줄. 머리말 `status`(planned 계획 · running 진행 중 · done 끝남 · stopped 중단), `started`, `by`, `area`, `question`, 선택 `adr`, `issues`.
- 메뉴: list(실험 목록, `<!-- exp-index -->`), README(프로젝트의 실험 계획, 키트 기본은 안내), template, EXP들. 카드, ADR 카드에 "실험" 줄. 검사: 머리말, 번호, 없는 ADR.

### 6.5 검증 기록 (`records`)

- `docs/records/NNNN-*.md`, `# VR-NNNN.`. 머리말 필수 `result`(pass 통과 · partial 부분 통과 · fail 실패), `date`, `by`, `area`, `subject`; 선택 `host`, `commit`, `adr`, `guide`, `c4`, `supersedes`.
- 증거 `docs/records/assets/VR-NNNN/`: 명령과 시각을 첫 줄에 남긴 출력 파일, `repro.sh`(인자: 출력 폴더, 그 아래에만 씀, `actual.txt`에 `key=value`, 안 돌린 단계는 `SKIP ...`), `expected.txt`(기록의 값, `A..B` 정수 범위 허용).
- `<!-- vr-index -->`, 결과 카드(배지, 날짜, 장비, 커밋, 절차, ADR, C4 요소, 재현 파일, 대체/대체됨 — 대체됨은 다른 VR의 `supersedes`로 계산), ADR 카드의 "검증 기록", C4 뷰어 `data.json`에 `records`와 요소·ADR별 VR.
- 검사: 머리말·값, 번호, 없는 ADR·VR, 재현 파일 누락.
- 재현 실행기 `bin/repro.sh VR-NNNN [args]`: `build/repro/<VR>/<시각>/`에 새로 돌리고 키마다 OK / DIFF / SKIP / MISSING, `report.txt`. 종료 0(모두 OK·SKIP) / 1 / 2(실행 실패).

### 6.6 주간 보고 (`weekly`)

- `docs/weekly/YYYY-MM-DD.md`(쓴 날), `# YYYY-MM-DD 주간 보고`. 머리말 `date`, `from`(지난 보고 `date`, 첫 보고는 시작일), `status`(draft 작성 중 · published 발행), `by`, 발행하면 `commit`, 선택 `meeting`.
- 본문: 1 요약 표 → 2 지난 회의 요청사항(이슈·상태) → 3 업무별 진행(`### 3.N <업무 이름>`마다 `- **배경**:`, `- **한 일**:`, `- **결과**:`, `- **다음**:`, 선택 `- **막힌 것**:`) → 4 정할 것과 도움 필요 → 5 회의 메모. 업무 이름은 매 보고 같게(= 마일스톤 = 로드맵 unit).
- 메뉴: README(목록 `<!-- weekly-index -->`: 날짜, 기간, 상태, 업무), threads(업무별 흐름 `<!-- weekly-threads -->`: 업무마다 보고들의 한 일·결과·막힌 것 최신순), template, 보고들(최신순). 탭을 켜면 보고가 없어도 탭이 보임.
- 보고 페이지 안의 `#12`, `!27`, `VR-0004`·`ADR-0011`·`EXP-0001`·`P-0001`은 자동 링크(코드·제목·기존 링크 제외). 카드: 기간, 상태, 작성, 회의, 커밋, 앞뒤 보고.
- 검사: 머리말, 파일 이름 = 날짜, 제목, `from` = 지난 보고 날짜, 발행인데 commit 없음, 업무 절의 빠진 항목.
- 재료 도구 `bin/weekly_draft.py [--since D] [--until D] [--branch B] [--write]`: 지난 보고의 "다음"·회의 메모, 이슈 스냅숏(`meeting` 라벨, 마일스톤별 닫힘·새로 열림·계속 열림), 커밋, 새 문서(VR, ADR, EXP, P, G, R, 배경), 작업 내역 줄 → `build/weekly/<날짜>_material.md`. `--write`는 로드맵 units + 마일스톤을 업무로 한 뼈대.

### 6.7 로드맵 (`roadmap`)

- `docs/roadmap/roadmap.yml` 한 파일: `title`, `tracks`(`{id, name, color}` 위→아래, 합류하는 트랙은 이웃), `units`(`{id, name, summary}` 업무), `items`(`id` 바꾸지 않음, `title`, `track`(하나 또는 이웃한 트랙 목록 = 합친 일), `unit`, `status`: done 완료 · doing 진행 중 · next 다음 · later 그다음 · future 나중 · dropped 취소, `date`(done·dropped), `after`, `refs`, `summary`).
- `refs` 풀이: `ADR-/VR-/EXP-/P-NNNN`, `G<N>`, `R<N>`, `A<N>`(+ ` §x.y`), `배경 NN`, `"#N"` 이슈, `"!N"` MR, docs 경로(`guides/g2_x.md#anchor`), URL.
- 열: 완료 항목이 있는 주(월요일)마다 한 칸, 그다음 지금 / 다음 / 그다음 / 나중. 같은 트랙 앞뒤는 굵은 실선, 다른 트랙에서 이어짐은 점선, 여러 트랙에서 들어오거나 걸친 항목은 합류(고리).
- 뷰어 `roadmap/viewer/`(독립, `data.js` = 노선도 SVG + 항목, `file://`에서도 동작): 역 클릭 → 패널(상태, 요약, 앞뒤, 관련 문서를 종류별 묶음: 결정·검증 기록·실험·실행 가이드·참고·아키텍처·배경·문서함·이슈·MR, 같은 업무의 다른 항목), 마우스 올리면 사슬 강조, 업무·상태·글자 거르기, `#item=<id>`, 페이지 테마를 따름.
- 표시 줄: `<!-- roadmap-map -->`(뷰어 삽입 + 전체 화면), `<!-- roadmap-units -->`, `<!-- roadmap-table -->`. 항목마다 `roadmap/items/<id>.md` 생성(메뉴 밖). 메뉴: README, guide.
- 검사: 없는 트랙·업무·앞 항목, 이웃하지 않은 트랙, 순환, 날짜 없는 완료, 모르는 상태, 중복 id, 문서로 풀리지 않는 참조.

### 6.8 문서 지도 (`graph`)

- 노드: 모든 페이지(템플릿, 로드맵 항목 페이지, 꺼진 탭의 키트 페이지 제외). 종류(색+모양): 아키텍처, 결정, 검증, 실험, 발행물·보고, 가이드·참고, 배경·용어, 목록·안내(처음엔 숨김). 크기 = 연결 수.
- 선 세 종류: **본문 링크**(렌더된 HTML, 다른 훅이 만든 링크 포함, 방향·백링크), **머리말 관계**(VR `adr`·`guide`·`supersedes`, ADR `related`·`supersedes`, EXP `adr`, 발행물 `based_on`), **비슷한 내용**(제안: 0.55 × TF-IDF 코사인(한국어 조사·어미·불용어 제거) + 0.30 × 서지 결합(같은 문서를 가리킴, 드문 대상 가중) + 0.15 × 같은 C4 요소(드문 요소 가중), 문서마다 상위 3개, 링크 없는 쌍만, 이유 보관).
- 주제: 로드맵 `tracks` + `common`. 문서마다 최대 2개, 순서: 머리말 `topics` → `docs/graph/topics.yml`(`ADR-0003: [core]`, `G2: [core, ui]`, docs 경로) → 그 문서를 `refs`에 둔 로드맵 항목의 트랙 → 이웃에서 추정(추정 표시, 엇갈리면 common). 주제마다 고리 위 자리로 끌림(서로 링크 많은 주제끼리 이웃), 두 주제 문서는 그 사이, 주제 색 성운.
- 뷰어 `graph/viewer/`(캔버스 힘 배치, 라이브러리 없음, 밤하늘 모양): 끌기·이동·확대, 마우스 이웃, 겹치지 않는 이름표, 클릭 → 패널(요약, 관계, 양방향 링크, 비슷한 문서와 이유, 문서 열기), 주변만 1~3단계, 모으기(주제/링크만/종류), 색(주제/종류/분야), 찾기, `#doc=<경로>`. 아무것도 고르지 않으면 **점검**: 연결 없는 문서, 추정 주제, 링크가 주로 다른 주제로 가는 문서, 링크할 쌍. 움직임 줄이기 설정·숨은 탭에서 멈춤.
- **질문 칸**: 개발 미리보기에서 `bin/docs_ask.py --serve`(`serve.sh ask`)에 묻고, 답의 인용 문서를 가운데로 모아 순위 배지, 패널에 점검된 답과 근거(경로·줄, `[n]` 클릭), "에이전트에게 묻기"(질문 + 근거 목록 복사), `#ask=<질문>`. 설정 `docs/quality/config.json`의 `ask`(`port`, `from_ports`, `start`).
- 표시 줄 `<!-- graph-map -->`. 페이지 `graph/README.md`(키트). 빌드 경고 없음(점검은 패널).

### 6.9 현황판 (`plan`)

- 원천: `docs/plan/scope.yml`, `risks.yml`, `sprints.json`, 선택 `issues.json`, 그리고 `docs/roadmap/roadmap.yml`(상태·날짜). 원천 파일은 사이트에 싣지 않음.
- `scope.yml`: `title`, `start`, `unit`, `unit_note`, `baselines`(`{id: B0, date, note}`), `legend`(`[{key, text}]`), `team_dod`, `items`(평평한 목록: `id`, `level`: epic/feature/story/backlog/wbs, `parent`, `title`, `short`, `size`(숫자 또는 `[최소, 최대]`, 한 갈래에 한 번), 상태 `roadmap:` / `issue:` / `status`(todo/doing/done/dropped)+`date`, `dod`(문자열 또는 `{text, met: yes|partial|no, evidence}`), `added`, `removed`+`reason`, `kind`: deliver/learn/decide/enabler, `wave`: now/next/later(물려받음)), `questions`(`{id, title, status: open|investigating|answered|dropped, confidence: low|medium|high, evidence, note, items}`).
- 계산: 작업량 띠 = 그날 계획에 있던 크기 합(최소~최대, `added`/`removed` 반영), 끝낸 일 = 끝난 항목 크기(폭은 가운데 값), 예측 = 지난 주별 처리량(낮음/평균/높음)으로 남은 작업량을 나눈 날짜, 비관은 남은 작업량 +50%, 6주 미만이면 신뢰 낮음. "지금 시기"와 "전체" 두 탭.
- 표시 줄: `plan-summary`(누르면 그 절로 가는 카드), `plan-burnup`, `plan-sprint-now`, `plan-stages`(단계 칸 띠 + 단계별 아코디언: 통과 기준과 그 아래 Feature > Story > Backlog > WBS, 완료 정의·크기·상태), `plan-questions`, `plan-changes`(기준선별 계획 변경), `risk-summary`, `risk-matrix`(5×5 PI, 점수 띠 색), `risk-top`, `risk-trend`(평가별 노출 합), `risk-register`(어느 페이지에서나, 예: arc42 A11), `plan-sprints`(스프린트 기록 표와 속도 그림). 모두 `<!-- 이름 -->`.
- `risks.yml`: `title`, `scales.p`/`scales.i`(1~5 설명), `bands`(기본 low 1~4, medium 5~9, high 10~14, critical 15~25), `risks`(`id`, `title`, `category`, `cause`, `effect`, `response`: avoid/mitigate/transfer/accept, `actions`, `owner`, `status`: open 관리 중/watch 지켜봄/occurred 일어남/closed, `links`, `history: [{date, p, i, note}]` 마지막 줄이 현재).
- 상호작용 `_kit/javascripts/plan.js`(없어도 읽힘): 툴팁 `[data-tip]`, 진척 그림 읽기, 탭, 단계 찾기·상태·시기 거르기·모두 펼치기, 리스크 거르기(등급 카드·PI 칸 클릭), 열 정렬, `#ep-<id>`·`#r01` 링크가 대상을 엶.
- 스프린트 `sprints.json`: `{cadence_days: 7, wip_limit: 3, save: {port: 8002, from_ports: [8001], start: "<명령>"}, sprints: [{id, start, end, state: planned|active|closed, goal, items: {카드 id: todo|doing|review|done}, blocked: {id: 이유}, carried: [...], retro: {good, problem, try}, note}]}`. 카드 = Backlog + Backlog 밖 WBS.
- 보드 `plan/board/`(독립, `data.js`): 백로그 목록(찾기, 단계·시기 거르기) + 칸 할 일/진행 중/검토/완료, 끌어 놓기 또는 카드 패널(키보드), WIP 한도 초과 표시, 막힘 이유, 목표, 만들기·시작·마감(끝나지 않은 카드를 다음 스프린트로 이월하고 `carried` 기록), 회고, 지난 스프린트, 단계별 가로줄(접기), 근거와 다르면 "근거 필요"(보드 완료인데 근거 없음)·"완료됨 MM-DD"(근거로는 끝남). 저장: 개발 미리보기 포트에서 연 보드만 `bin/plan_board.py`(Origin 검사, 값 검사, `build/plan/sprints-backup/` 최근 50개)로 POST, 그 밖은 보기 전용 + 내보내기(JSON).
- `issues.json`: `{"taken": "...", "issues": [{"iid", "title", "state": "opened|closed", "labels", "milestone", "created", "closed"}]}`. 트래커에서 받는 스크립트는 프로젝트 몫.
- 검사: 모르는 키(따옴표 없는 쉼표), 없는 부모·로드맵 항목·이슈, 순환, 크기 위 크기, 크기 없는 잎, 완료 정의 없는 백로그·WBS, 날짜 없는 완료, 점수 범위 밖, 모르는 리스크 상태, 스프린트의 모르는 카드·칸, 겹친 기간, 진행 중 둘 이상.

### 6.10 근거 점검과 문서 검색·질문 (`quality`)

- `bin/docs_search.py "<질문>" [-k 8] [--json] [--root .] [--current] [--mode auto|bm25|hybrid|dense] [--build-vectors]`: `docs/**/*.md`(assets 제외) + 루트 AGENTS.md·README.md를 제목에서 잘라 절 단위로. BM25(k1 1.2, b 0.75), 낱말 + 한글 글자 2-gram, 조사·의문 어미 떼기, 제목 필드 2배, 문서 ID(ADR-0012, VR-0004, #61, G7) 정확 일치 가산, 결과마다 층(정본/운영/발행물/지식)과 상태, `supersedes`로 대체된 기록은 "대체됨 → 새것" 표시와 낮춤, 발행물은 정본보다 조금 낮춤, 질문 낱말의 절반 미만만 맞으면 결과 없음("찾은 곳 없음"). 색인 캐시 `build/rag/index.json`. 임베딩 서버(`DOCS_EMBED_URL`, TEI `POST /embed`)가 답하면 하이브리드(RRF k=60, `DOCS_DENSE_WEIGHT`, 모델별 `dense_min`).
- `bin/docs_check.py [--root .] [--json] [--changed] [--record] [--only 경로...]`: 주장 종류와 판정 — doc-id(없는 번호 → 틀림), issue(스냅숏에 없음 → 틀림), path(저장소에 없음, 글로브·커밋 해시가 있는 줄은 그 커밋에서 → 틀림), port(8000~9999가 포트 표 `ports_doc`에 없음 → 틀림), option(`tools/x.sh sub --flag`·`.docs-kit/bin/...`의 하위 명령·옵션이 스크립트에 없음 → 확인 못 함), ident(코드 식별자가 코드·설정에 없음 → 확인 못 함), vr-number(VR의 단위 붙은 소수가 원 출력에 없음 → 확인 못 함), number(보고·가이드의 수치가 VR·EXP·ADR에 없음 → 확인 못 함), superseded(대체된 기록만 인용 → 낡음), stale(가리키는 코드가 문서보다 14일 넘게 나중에 바뀜 → 낡음). 문서별·층별 비율, 검색 평가(`questions.json`: hit@1, recall@5, MRR, exact/paraphrase), `--record`는 `history.json`에 그날 요약, `--changed`는 git HEAD 대비 바뀐 파일만.
- 설정 `docs/quality/config.json`(기본값 `DEFAULT_CFG`): `code_roots`, `path_roots`, `ports_doc`(비우면 `docs/reference/r*_ports*.md` 첫 파일), `number_free`, `ident_ignore`, `path_ignore`, `path_external`, `path_planned`, `immutable`, `ask`, `embed_start`, `llm_start`, `embed_model`, `llm_model`, `dense_min`.
- `embed_instruct`(임베딩 질의 지시문, 환경 변수 `DOCS_EMBED_INSTRUCT`가 우선). `incidents.json`: `{about, incidents: [{date, agent, type(없는 것을 있다고 함 | 낡은 근거 인용 | 수치 오기 | 확인 누락 | 추측을 사실로), claim, truth, caught_by, prevention, links}]}`. `questions.json`: `{about, questions: [{q, expect: [docs 경로...], kind(선택: paraphrase = 문서와 다른 낱말로 물은 질문), note(선택)}]}`. `history.json`: `{runs: [{date, commit, checkable, ok, false, unverified, stale, *_rate, hit1, recall5, mrr}]}`.
- 훅: 빌드마다 `docs_check`를 불러(모듈을 매번 새로 읽음, `mkdocs serve`가 오래 살기 때문) 결과를 `build/quality/report.json`에 캐시(문서·코드·설정이 바뀔 때까지). 표시 줄 `quality-summary`, `quality-trend`, `quality-tasks`(살아 있는 문서에서 고칠 것, 낡은 근거, 확인할 것, 고치지 않는 기록), `quality-docs`, `quality-kinds`(종류별 확인법·고치는 법), `quality-retrieval`, `quality-incidents`.
- `bin/docs_ask.py "<질문>"` / `--serve [--port 8003] [--from-ports 8001]`: 검색(하이브리드 또는 BM25, 문서당 최대 2절, 상위 K) → 없으면 모델을 부르지 않고 "문서에서 확인 못 함" → 생성(`DOCS_LLM_URL`, llama.cpp OpenAI API, 온도 0, 번호 붙은 절만 쓰고 문장마다 `[n]`, 모르면 "문서에서 확인 못 함") → 문장 점검(인용 없음·범위 밖 번호 → 근거 없음, 인용 절에 없는 문서 ID·이슈·경로·`코드`·단위 붙은 수·포트 → 확인 못 함(그 말을 표시), 그 밖 → 근거 있음). 생성 서버가 없으면 근거만. API `GET /api/health`, `GET /api/search?q=&k=`, `POST /api/ask {q, k}`, 미리보기 포트에서 온 요청만, 생성은 한 번에 하나.

### 6.11 일반 탭 (`history`, `guides`, `reference`, `shared`, `background`, `glossary`, `models`)

훅 없이 `hooks/kit.py`가 메뉴만 만듭니다(§4.2). 형식은 규격: 실행 가이드 `gN_*.md` `# G<N>.`, 맨 위 `> 기준: 날짜 + 마지막 검증 VR`, 단계마다 명령 → 기대 결과 → 안 될 때. 참고 `rN_*.md` `# R<N>.` 값의 표. 배경 `NN_*.md` `# NN.`(두 자리 번호는 배경에만). 작업 내역 `docs/history.md` 최신순 표(날짜, 업무, 내용, 결과, 재현·실행, 자세히). 공용 파일은 짧게(이름·버전·내용물·받기·경로). 모델 카드 형식은 첫 승격 때 정함.

---

## 7. 공통 기능

| 기능 | 파일 | 동작 |
| --- | --- | --- |
| 절 참조 링크 | `hooks/section_links.py` | 렌더된 HTML에서 `§4.3`(같은 페이지 제목 "4.3 …" 또는 첫 칸이 번호인 표 행), `11 §4`(파일 이름이 `11_`로 시작하는 페이지), `A5 §2`·`G1 §6`·`R2 §1`, 페이지만 가리키는 링크 텍스트 "08 §3.1"에 앵커를 붙임. 코드·제목·기존 링크는 그대로, 없는 번호는 텍스트 |
| 목록 바로잡기 | `hooks/lists.py` | 렌더 전(원본 그대로): 2~3칸 하위 목록을 4칸 단위로(이어지는 줄·코드 펜스 함께), 글 바로 아래 목록 앞에 빈 줄. 코드·표·제목·HTML·인용 그대로 |
| 짧은 주소 | `hooks/links.py`, `_kit/javascripts/links.js` | `extra.links.short: [{name, to, title}]` → `r/<name>/index.html`(리다이렉트). `to`: `.md`, `rerun:<경로>`(Rerun 뷰어 + 파일 서버, `extra.rerun` 포트), `catalog:<port>[@<viewer port>]`, `port:<port>/<경로>`. 호스트는 언제나 읽는 사람이 연 호스트. `<!-- short-links -->` 표. 본문 링크 `[글](rerun:...)`도 같음. `<div class="kit-dev-only" markdown>`은 `extra.links.shared_port`가 아닌 포트에서만 보임. 이름 규칙 `^[a-z0-9][a-z0-9._-]*$`, 없는 페이지는 경고 |
| Rerun 기록 상자 | `hooks/rerun_embed.py`, `_kit/javascripts/rerun-embed.js` | `<!-- rerun: <경로> [height=N] -->` → "뷰어 불러오기" 버튼 상자(누르기 전 아무것도 받지 않음), 파일 서버가 안 답하면 시작 명령(`extra.rerun.start`) 안내. 기본 `web_port` 9090, `file_port` 9091 |
| 그림 확대 | `_kit/javascripts/diagram-zoom.js` | Mermaid 그림(닫힌 shadow root)을 틀로 감싸 −/+/맞춤/100%/전체 화면, 끌어 이동, Ctrl/⌘+휠 확대 |
| 수식 | `_kit/javascripts/mathjax.js` + vendor | `$...$`, `$$...$$` (arithmatex generic) |
| 테마 | `_kit/stylesheets/theme.css` | 시스템 글꼴, 따뜻한 바탕(밝음 `#fdfdf7`, 어두움 `#0d0c0a`), custom primary/accent, 카드·배지 공통 |

---

## 8. 도구 (`bin/`)

| 도구 | 실행 | 계약 |
| --- | --- | --- |
| `docs.sh start\|stop\|status\|logs\|serve\|build` | 호스트(Docker) | 컨테이너 이름 `docs-<프로젝트 폴더>`, 호스트 사용자로 실행, `--restart unless-stopped`, `DOCS_PORT`(8000), `DOCS_IMAGE`, `DOCS_ROOT`. 훅을 고치면 stop/start |
| `kit.py` | 호스트 | §5.4 |
| `init.sh "이름" [묶음]` | 호스트 | `kit.py init` |
| `selftest.sh` | 호스트(Docker) | §11 |
| `docs_search.py`, `docs_check.py`, `docs_ask.py` | 호스트 | §6.10. 사내망 밖으로 보내는 것 없음 |
| `serve.sh board\|ask start\|stop\|status\|logs` | 호스트 | 배경 서버, `build/serve/<이름>.{pid,log}`, `DOCS_DEV_PORT`(8001), `BOARD_PORT`(8002), `DOCS_ASK_PORT`(8003), `DOCS_ASK_PRESTART`(모델 서버 시작 명령) |
| `plan_board.py --root R [--port 8002] [--from-ports 8001]` | 호스트 | `POST /api/sprints` → 검사 → 백업 → `docs/plan/sprints.json` |
| `repro.sh VR-NNNN [args]` | 호스트 | §6.5 |
| `weekly_draft.py` | 호스트 | §6.6 |

**프로젝트가 맡는 것**(키트 밖): 이슈 트래커 스냅숏 내보내기(`issues.json` 형식만 맞춤), 임베딩·생성 모델 서버(예: TEI CPU 이미지, llama.cpp 서버를 127.0.0.1에, 모델은 내부 보관소에서 오프라인), 공유 배포(예: 기본 브랜치 병합 뒤 자동 빌드·검증·교체), Rerun 뷰어·파일 서버, 프로젝트 환경 점검 스크립트(키트 상태는 `kit.py check`로 위임 가능).

---

## 9. 템플릿

- `template/base/mkdocs.yml`: `INHERIT`, `site_name: "{{PROJECT}}"`, `extra.links.short`에 home, 주석 처리한 `issues_url`, `nav: [개요: README.md]`(나머지 탭은 키트가 넣음).
- `template/base/docs-kit.yml`: `profile: {{PROFILE}}`, `features: {}`, 기본 분야.
- `template/base/docs/README.md`: 목적 자리, 사이트 여는 법, "어디서 무엇을 보나" 표.
- `template/features/<id>/`: §5.2. 예시 값은 일반적인 것(트랙 env/core/ui, Epic E0·M1, 리스크 R01 `<예시>`)이고 프로젝트가 바꿈. JSON에는 `about` 설명 줄.
- `template/agents/AGENTS.docs-kit.md`: §10.

## 10. 에이전트 운영

- 사람은 README §1의 지시문을 붙여 넣고, 에이전트는 AGENTS-GUIDE를 따릅니다: 새 프로젝트(§2: 묻기 9가지 → 제안서 → 승인 → `kit.py init` + 예시 바꾸기 + AGENTS.md → 경고 0), 진행 중 프로젝트(§3: 읽기만 조사 → 이전 대응표 → 승인 → 형식만 이전), 운영 요청(§6), 키트 고치기(§7).
- 프로젝트 AGENTS.md의 "문서 관리 (docs-kit)" 절(템플릿 D1~D7): D1 세션 시작 `kit.py check --fetch`와 경고별 조치, 동시 세션 주의 / D2 어디에 쓰나(층 표, 정본·이슈·용어·번호·링크·큰 파일·ADR·VR 규칙) / D3 근거 먼저(`docs_search` → 읽기 → 근거 붙이기 → 못 찾으면 그렇게 말하기 → 사례 기록) / D4 쓰고 나서 확인(빌드 경고 0, `docs_check --changed`) / D5 탭별 흐름(`[탭: id]` 항목: roadmap, plan, weekly, graph, quality, history; 끈 탭은 지움) / D6 키트 고치기(있는 탭 먼저, main 확인, VERSION·CHANGELOG·context, selftest, 키트 먼저 push, `--recurse-submodules=no`) / D7 git(요청 시만, 내 파일만 경로로, 주제별 커밋).
- 최신 유지 고리: 프로젝트 A에서 공통 형식을 고침 → 키트 저장소 push → 프로젝트 B의 다음 세션 D1이 `newer docs-kit` 알림 → `kit.py update` → CHANGELOG에 형식 이전이 있으면 문서를 옮김 → `.docs-kit` 커밋.

## 11. 시험 (`bin/selftest.sh`)

`template/`로 임시 프로젝트 둘을 만들어 Docker로 빌드하고 하나라도 어긋나면 실패합니다.

1. `all` 프로젝트 + 고정 입력 `tests/fixtures/all/`(`docs/`에 그대로 복사, `README.append.md`는 README 끝에 덧붙임: 주간 보고 2개, 두 트랙이 합류하는 로드맵, Epic·WBS·질문이 있는 scope, 스프린트, 리스크, 없는 `ADR-0999`를 인용한 페이지, 검색 질문 1개, 2칸 하위 목록): `WARNING`/`ERROR` 0, 주요 산출물(index, docs-kit, adr 페이지·viewer·data.json·elk, r/home, weekly·threads, roadmap 페이지·항목·viewer data.js, graph viewer data.js, plan·sprints·board data.js, quality, vendor 스크립트) 존재, 업무별 흐름에 두 보고, 노선도 합류와 묶인 refs, 지도에 ADR 노드와 주제, PI 매트릭스 칸 20에 R01, 보드 카드 W1과 속도 그림, 근거 점검이 ADR-0999를 틀림으로, 2칸 목록이 중첩 목록으로, 외부 `src="http..."` 스크립트 없음, `docs_ask.check()`의 판정 순서 `supported unverified unsupported unsupported none`.
2. `minimal` 프로젝트: 경고 0, 탭에 ADR이 있고 현황판·문서 지도가 없음 → `kit.py enable plan roadmap weekly` + `disable glossary` → 시작 파일 복사됨, 경고 0, 탭 순서 현황판 → 주간 보고 → 로드맵 → ADR, 용어집 없음.

끝에 `selftest OK (<N> pages)`.

---

## 12. 다시 만드는 순서 (저장소를 가져갈 수 없을 때)

단계마다 확인 기준을 통과한 뒤 다음으로 갑니다. 화면 문구·예시는 이 문서와 `assets/` 설명을 따르고, 없는 것은 지어내지 말고 사용자에게 묻습니다.

| 단계 | 만들 것 | 확인 |
| --- | --- | --- |
| 1 | 저장소 뼈대, `VERSION`(0.15.0부터 이어감 또는 1.0 전 새 번호), `CHANGELOG.md`, `.gitignore`, `mkdocs.base.yml`(§4.1), `bin/docs.sh`, 테마 CSS, vendor(MathJax 3.2.2, Mermaid 11.4.1 — sha256은 §3 출처 표) | 빈 프로젝트(`docs/README.md` + `mkdocs.yml` INHERIT)가 빌드되고 수식·Mermaid가 오프라인으로 그려짐 |
| 2 | `hooks/kitconf.py`, `hooks/kit.py`, `hooks/kit_nav.py`, `bin/kit.py`, `template/base/`, `bin/init.sh` | `kit.py init --profile minimal`로 만든 프로젝트가 경고 0 |
| 3 | 공통 훅 `lists.py`, `section_links.py`, `links.py`, `rerun_embed.py` + JS | §7 동작 |
| 4 | ADR + C4(훅, 페이지 5개, 템플릿·가이드, 뷰어 + elkjs 0.9.3), 시작 파일 | ADR 목록·로그·카드, 뷰어 드릴다운·결정 필터 |
| 5 | records, experiments, arc42, publications(훅, 키트 페이지, 템플릿) | 카드·목록·역링크·검사 |
| 6 | weekly(+ `weekly_draft.py`), roadmap(훅, 뷰어, 항목 페이지, 시작 파일) | 업무별 흐름, 노선도 합류 |
| 7 | plan(훅, `plan.js`, `plan.css`, 보드, `plan_board.py`, `serve.sh board`, 시작 파일) | 진척 그림·예측, PI 매트릭스, 보드 저장(미리보기 포트에서만) |
| 8 | `docs_search.py`, `docs_check.py`, quality 훅·페이지, 시작 파일, `repro.sh` | 근거 점검 페이지, ADR-0999 틀림, 검색 평가 |
| 9 | graph(훅, 뷰어), `docs_ask.py`, `serve.sh ask` | 지도·점검·주제, 질문(생성 서버 없으면 근거만) |
| 10 | 일반 탭 시작 파일, `docs-standard.md`(§1~§13), `docs-kit.md`(§1~§8) | 묶음 다섯 개 모두 경고 0, 탭 순서 §4.4 |
| 11 | `selftest.sh`(§11), README, AGENTS-GUIDE, AGENTS 템플릿, 이 문서 | `selftest OK` |
| 12 | 실제 프로젝트 하나에 서브모듈로 넣어 README §1.1 지시문으로 세워 봄 | 제안 → 승인 → 경고 0, `kit.py check` 경고 0 |

---

## 13. 버전과 주의점

- 키트에는 회사·프로젝트 고유 내용을 넣지 않음. 프로젝트별 값(임베딩 지시문 `embed_instruct`, 분야, 포트 표)은 프로젝트 설정에.
- 버전: 형식·탭 추가 = 마이너, 고침 = 패치. 1.0 고정 조건과 그 뒤 규칙은 규격 §12(섹션 번호, 부록, 문서 종류, 머리말 필드 고정, 바꾸면 메이저 + 이전 안내).
- CHANGELOG 항목은 영어 한 문단, "무엇이 · 어떻게 · 경고"를 적음. 형식 이전이 필요하면 그 사실을 첫 줄에.
- YAML 함정: 흐름 맵 값에 `, `가 있으면 잘려서 모르는 키(경고), ` #` 뒤는 주석으로 사라짐(경고 없음) → 따옴표. `"#60"`처럼 이슈 번호는 따옴표.
- 링크될 제목에 ` / `, ` → `, ` - ` 금지(GitLab이 `--`를 `-`로 줄여 앵커가 어긋남).
- 목록 안의 `nav` 목록(`hooks`, `extra_css`, `extra_javascript`)은 프로젝트가 같은 키를 쓰면 통째로 바뀜 → 키트 항목을 함께 적음.
- 미리보기 서버(`mkdocs serve`)는 훅 코드를 시작할 때만 읽음 → 훅·`kitconf.py`를 고치면 stop/start. 근거 점검 모듈은 매 빌드 새로 읽음.
- 보드·질문 서버는 Origin이 미리보기 포트일 때만 받음. 공유 사이트는 읽기 전용.
- 꺼진 탭의 키트 페이지는 `NOT_IN_NAV`로 빌드되므로 문서 규격의 템플릿 링크가 끊기지 않음. 문서 지도는 그 페이지를 노드로 넣지 않음.
- 표시 줄(`<!-- plan-summary -->` 등)은 한 줄에 단독일 때만 바뀜. 설명 글에 쓸 때는 `` `코드` `` 안에.
