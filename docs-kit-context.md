# docs-kit 구축 컨텍스트

이 문서는 docs-kit **전체를 다른 세션·다른 환경에서 그대로 다시 만들거나 이어서 고칠 수 있도록** 구조, 동작, 형식, 도구, 시험, 에이전트 운영을 한곳에 적은 명세입니다. 에이전트가 처음 읽는 문서로 씁니다.

> **사이트 엔진은 Astro입니다**(0.16부터 `main`; MkDocs 판은 태그 `v0.15.4`). 이 문서는 Astro 판(0.21) 기준입니다. 엔진을 다시 만든 요구사항은 [prd.md](prd.md), 결정은 [decisions/0001](decisions/0001-astro-engine.md), 이전 검증 결과는 [site/README.md](site/README.md) "M7 verification"입니다. 탭 목록(§5.2~§5.3)의 원천은 `site/src/config/features.json`입니다.

> 기준: docs-kit 0.21.0, 2026-11-21. 키트 동작을 바꾸면 이 문서의 해당 절도 같은 커밋에서 고칩니다(AGENTS-GUIDE §7).

- **저장소가 있으면 저장소가 정본**입니다. 이 문서와 코드가 다르면 코드를 믿고 이 문서를 고칩니다.
- **저장소를 가져갈 수 있으면** 복제가 가장 확실합니다(`git clone`, 또는 `git bundle create docs-kit.bundle --all`로 파일 하나로 옮김). 이 명세는 가져갈 수 없을 때 다시 만드는 기준이고, 순서는 §12입니다.
- 키트를 Astro로 다시 만든 요구사항은 [prd.md](prd.md)입니다(상태: 구현됨). 이 문서는 지금 판의 동작 기준입니다.
- 사람용 안내와 에이전트 지시문: [README.md](README.md). 에이전트 절차: [AGENTS-GUIDE.md](AGENTS-GUIDE.md). 문서 규격 본문: `assets/docs-standard.md`.

---

## 1. 목적과 요구사항

| # | 요구사항 | 어떻게 충족하나 |
| --- | --- | --- |
| R1 | 여러 프로젝트가 같은 규격으로 문서를 쓰고 웹으로 봄 | 키트 = git 저장소 하나, 프로젝트에 서브모듈 `.docs-kit/`(`-b main`). 사이트 엔진(Astro)이 키트 안 `site/`에 있고 프로젝트는 `docs/`와 `docs-kit.yml`만 가짐 |
| R2 | 키트에는 구조·템플릿·예시만, 내용은 프로젝트가 채움 | 키트 페이지는 목록·안내·템플릿과 표시 줄(`<!-- ... -->`)뿐. 프로젝트 고유 이름·값·경로를 넣지 않음. 프로젝트 파일이 같은 경로 키트 파일을 덮어씀 |
| R3 | 모든 탭 기능을 갖되 프로젝트마다 켤 탭을 고름 | `docs-kit.yml`(묶음 `profile` + `features` 덮어쓰기), `site/src/config/features.json`(탭 목록·묶음, `kit.py`와 사이트가 같이 읽음), 꺼진 탭은 그 모듈이 아무것도 안 함, `bin/kit.py enable/disable/profile` |
| R4 | 새 탭이 필요하면 먼저 있는 템플릿을 켬 | 탭 목록·설명을 `kit.py status`, 사이트의 `<!-- kit-features -->` 표, 규격 §13, AGENTS-GUIDE §6에 둠. 켜면 시작 파일이 복사됨 |
| R5 | 새 프로젝트와 진행 중 프로젝트 모두 지원 | README §1.1/§1.2 지시문, AGENTS-GUIDE §2(묻기 → 제안 → 승인 → 실행)/§3(조사 → 이전 대응표 → 승인 → 이전) |
| R6 | 제안 먼저, 사용자 승인 뒤 작업 | AGENTS-GUIDE 원칙 1, 제안서 형식 §4 |
| R7 | 프로젝트에서 바꾼 형식이 키트에 반영되어 늘 최신 | AGENTS.md 템플릿 D6, AGENTS-GUIDE §7: 공통 형식은 키트에서 고치고 키트 먼저 push. `kit.py check --fetch`가 새 버전을 알리고 `kit.py update`로 받음 |
| R8 | 에이전트가 일관되게 키트를 씀 | `template/agents/AGENTS.docs-kit.md`(프로젝트 AGENTS.md에 넣는 절, 탭별 항목 `[탭: id]`) |
| R9 | (2026-11-20 해제) 원래는 사내망만, 외부 인터넷 없이 동작 | 지금은 외부 요청 허용(prd.md §0). 라이브러리는 고정 버전으로 사이트에 싣는 것이 기본 |
| R10 | 호스트에 설치 최소 | 사이트는 Docker 이미지(Node + 잠근 패키지) 또는 호스트 Node 22.18+(`DOCS_RUNNER=host`), 호스트 도구는 Python 3.8 표준 라이브러리만 |
| R11 | 할루시네이션을 줄이는 근거 체계 | 문서 검색(`docs_search.py`), 근거 점검(`docs_check.py` + 근거 점검 탭), 질문 답의 문장별 인용 점검(`docs_ask.py`) |
| R12 | 빌드 경고 0 = 문서 작업 끝 | 모든 탭 모듈이 형식 위반을 `WARNING <탭>: <파일>: <내용>`으로 내고 빌드 끝에 모아 보임, `docs.sh build --strict`는 경고가 있으면 실패 |

## 2. 설계 원칙

1. **사실은 정본에만**(arc42, ADR, EXP, VR, MC). 발행물·보고·가이드는 링크·인용. **할 일은 이슈 트래커**(문서에 체크리스트 없음, 예외: 로드맵·현황판은 큰 흐름과 상태 원천 링크).
2. **기록은 추가만**: ADR(승인 뒤), VR, EXP, 주간 보고(발행 뒤), 발행물 스냅숏. 바뀌면 새 문서 + `supersedes`.
3. **원천 하나**: 상태는 로드맵·이슈 스냅숏에서만, 리스크는 `risks.yml`에서만, 용어는 용어집 색인에서만.
4. **자동화는 머리말과 표시 줄로**: 목록·카드·메뉴는 머리말(front matter)에서, 표·그림은 페이지의 `<!-- 표시 -->` 한 줄에서 빌드 때 만듦. 손으로 쓰는 목록 없음.
5. **화면 문구 한국어, 코드·주석·CLI 출력 영어.** 문서 문체 "~합니다", 날짜 `YYYY-MM-DD`.
6. **덮어쓰기 가능**: 프로젝트 `docs/`의 같은 경로 파일이 키트 파일보다 우선.
7. **꺼진 탭은 완전히 빠짐**: 탭 모듈은 아무것도 안 하고(뷰어 데이터도 쓰지 않음), 키트 페이지는 메뉴 밖(링크는 살아 있음), 프로젝트 문서는 남음.

---

## 3. 실행 환경과 저장소 구조

| 항목 | 값 |
| --- | --- |
| 사이트 엔진 | Astro 7.4.13(정적 출력), Node 22.18+ (이미지는 `node:24-bookworm-slim` + python3, git). 패키지는 `site/package-lock.json`으로 고정 |
| 실행 방식 | `DOCS_RUNNER=docker`(데몬이 답하면 기본, 이미지 `docs-kit-site:<잠금 파일 해시>`를 처음 한 번 만듦) 또는 `host`(호스트 Node, 처음에 `npm ci`) |
| 호스트 도구 | Python 3.8+, 표준 라이브러리만(PyYAML이 있으면 `kitconf.parse`가 씀) |
| 실은 라이브러리 | npm에서 받아 사이트에 실음(외부 CDN 안 씀): KaTeX 0.19.1(빌드 때 그림), Mermaid 12.3.0(ESM, 필요할 때만 받음), elkjs 0.12.1(C4 뷰어), Shiki 4.6.0(빌드 때 색), Pagefind 1.6.0(검색 색인), Pretendard 1.3.9(본문), JetBrains Mono 5.3.0(코드) |
| 외부 서비스 | 선택: 호스팅 Rerun 뷰어(`rerun.viewer: hosted`, app.rerun.io). 없을 때는 같은 PC 뷰어로 안내 |
| 포트 기본값 | 미리보기 8000(`DOCS_PORT`), 개발 미리보기 8001(프로젝트가 정함), 보드 저장 8002, 질문 서버 8003, 임베딩 9298, 생성 9299(프로젝트 서버) |

```text
docs-kit/
  README.md  AGENTS-GUIDE.md  docs-kit-context.md  prd.md  CHANGELOG.md  VERSION  .gitignore
  decisions/                      # 키트 자체의 결정 (0001 Astro 엔진)
  site/                           # 사이트 엔진 (Astro 프로젝트, site/README.md)
    astro.config.mjs              # 정적 출력 → <프로젝트>/build/site, base = docs-kit.yml site.base, format "file"
    src/config/                   # paths.ts(키트·프로젝트·출력 경로), load.ts(docs-kit.yml + zod), features.json(탭·묶음)
    src/markdown/                 # pre.ts(원본 단계: admonition·details·탭·끼워 넣기·md_in_html·목록·표시 줄), pipeline.ts(unified)
    src/lib/                      # site.ts(읽기·겹치기·렌더·캐시), links.ts(§ 링크·검사), nav.ts(메뉴), markers.ts, warnings.ts,
                                  # records.ts(ADR·C4·VR·EXP·arc42·P), weekly.ts, roadmap.ts, plan.ts, graph.ts, quality.ts
    src/layouts/Page.astro        # 머리줄, 탭 줄, 옆 메뉴, 본문, 이 페이지, 앞뒤, 서랍 메뉴, 검색
    src/pages/                    # [...slug].astro(모든 쪽), r/[name].astro(짧은 주소), 404.astro, 뷰어 데이터:
                                  # adr/viewer/data.json.ts, roadmap/viewer/data.js.ts, plan/board/data.js.ts, graph/viewer/data.js.ts
    src/integration.ts            # 미리보기: 감시·정적 파일 / 빌드 뒤: README 쪽 이동, 정적 파일, 실은 라이브러리, 꺼진 탭 데이터 지움,
                                  # sitemap, Pagefind, 경고 요약과 --strict
    public/_kit/{kit.css,kit.js}  # 테마·배치, 테마 토글·서랍·이 페이지·복사·탭·Mermaid(확대 틀)·검색·Rerun 상자 (의존성 없음)
    tests/                        # node --test (npm test)
  assets/                         # 키트 페이지·파일. 사이트 경로 그대로 들어감 (프로젝트 docs/의 같은 경로가 우선)
    docs-standard.md  docs-kit.md
    _kit/stylesheets/{roadmap,plan}.css  _kit/javascripts/plan.js   # 현황판·로드맵 쪽 (md-typeset 호환 층으로 씀)
    adr/{README,log,c4,guide,template}.md  adr/viewer/{index.html,viewer.js,viewer.css}
    arc42/ publications/ experiments/ records/ weekly/ roadmap/ graph/ plan/ quality/   # 탭 페이지, 뷰어, 보드
  hooks/                          # MkDocs 판의 훅(참고용, 사이트는 쓰지 않음). kitconf.py만 bin/kit.py가 씀
  mkdocs.base.yml                 # MkDocs 판 설정(참고용, 쓰지 않음)
  docker/{Dockerfile,run.sh}      # Docker 실행 방식의 이미지
  template/
    base/{docs-kit.yml,docs/README.md}
    features/<id>/<프로젝트 경로>  # adr, roadmap, plan, quality, history, guides, reference, shared, background, glossary, models
    agents/AGENTS.docs-kit.md
  tests/fixtures/all/             # selftest 고정 입력 (docs/ 아래 그대로, README.append.md)
  tests/site-diff-allow.txt       # MkDocs 판과 비교할 때 받아들인 차이
  bin/
    kit.py init.sh docs.sh selftest.sh site_diff.py compare_editions.sh
    docs_search.py docs_check.py docs_ask.py serve.sh plan_board.py repro.sh weekly_draft.py
```

프로젝트 쪽 모양:

```text
<프로젝트>/
  .docs-kit/            # 서브모듈 (직접 고칠 때는 AGENTS-GUIDE §7)
  docs-kit.yml          # 켤 탭, 분야, 사이트(이름, base, 저장소·고치기 링크, 트래커), 짧은 주소, Rerun, nav(선택)
  AGENTS.md (+ CLAUDE.md: @AGENTS.md)
  docs/ ...             # 내용
  build/                # git 제외: site/, .kit/(경고 목록), quality/, rag/, plan/, serve/, repro/, weekly/
```

---

## 4. 사이트 조립 방식

### 4.1 읽기와 겹치기 (`site/src/lib/site.ts`)

- 페이지 = 프로젝트 `docs/`의 `.md` + 키트 `assets/`의 `.md`(같은 경로는 프로젝트가 이김) + 탭 모듈이 만드는 쪽(`roadmap/items/<id>.md`, 파일 없음, 메뉴·사이트맵 밖). 그 밖의 파일은 같은 경로로 복사. 탭이 읽는 원천(`roadmap.yml`, `plan/*.yml|json`, `graph/topics.yml`, `quality/*.json`)은 싣지 않음.
- 주소: `a/b.md` → `a/b.html`, 폴더의 `README.md`(또는 `index.md`) → `a/index.html`, 짧은 주소 `r/<name>/index.html`(MkDocs 판과 같음, MIG-2).
- 쪽마다 캐시(파일 내용 + 설정 지문). 표시 줄·끼워 넣기·기록 탭 쪽은 다른 파일에 기대므로 매번 다시 그림. 미리보기는 `docs/`, `docs-kit.yml`, 키트 `assets/`를 감시(한 문서 고친 뒤 0.3초 안팎).

### 4.2 Markdown 처리 순서

| 순서 | 단계 | 하는 일 |
| --- | --- | --- |
| 1 | 끼워 넣기 | `--8<-- "경로"`, `--8<-- "경로:이름"`(정본의 `[start:이름]`…`[end:이름]`), `;--8<--`는 그대로 보임 |
| 2 | 표시 줄 | 한 줄에 단독인 `<!-- 이름[: 인자] -->`를 탭 모듈이 Markdown·HTML로 바꿈(코드 펜스 안은 그대로). 꺼진 탭이면 "탭이 꺼져 있습니다" |
| 3 | 탭 쪽 덧붙임 | 주간 보고 번호 링크, 기록 카드(첫 제목 바로 아래) |
| 4 | 목록 바로잡기 | 2~3칸 하위 목록을 4칸 단위로, 글 바로 아래 목록 앞에 빈 줄 |
| 5 | HTML 안 Markdown | `<div markdown>` 등(md_in_html) |
| 6 | 블록 | `!!! 종류 "제목"`, `??? / ???+`(접힘), `=== "탭"` 묶음 |
| 7 | unified | remark-gfm(표, 할 일 목록), remark-math → KaTeX, attr_list(`{#id .class}`), Shiki(밝음·어두움 두 테마), 제목 앵커(GitHub 방식, 같은 제목은 `_1`, `_2` — Python-Markdown과 같음), `.md` 링크 → `.html`, 넓은 표는 혼자 가로 스크롤 |
| 8 | 전체 쪽 | `§` 참조 링크, 없는 쪽·앵커 경고, 서버 링크(`rerun:`, `catalog:`, `port:`)와 `kit-dev-only`(§7) |

### 4.3 탭 켜기·끄기와 메뉴 (`site/src/lib/nav.ts`)

- `features.json`의 탭마다 켬/끔(`docs-kit.yml`의 `profile` + `features`, `bin/kit.py`와 같은 판정). 꺼진 탭: 탭 모듈의 표시 줄은 안내 한 줄, 뷰어 데이터는 쓰지 않음, 키트 페이지는 빌드되지만 메뉴·사이트맵·문서 지도 밖(링크는 살아 있음), 프로젝트 문서는 남음.
- 메뉴: `docs-kit.yml`의 `nav`(없으면 개요 하나)에 켠 탭을 더함. 기록 탭은 그 폴더의 목록·템플릿·문서(번호순), 일반 탭은 `docs/<폴더>/*.md`(README 먼저, 번호 자연 정렬, 템플릿 제외). 프로젝트 nav가 그 폴더 파일을 적었으면 손대지 않음. 켰는데 쪽이 없으면 경고.
- 순서: 프로젝트가 직접 쓴 최상위 제목 밖의 탭을 순위(`features.json` `rank`)대로. 개요 0, 작업 내역 1, 현황판 2, 주간 보고 3, 로드맵 4, 문서 지도 5, 근거 점검 6, 문서함 7, 아키텍처 8, ADR 9, 실험 10, 검증 기록 11, 모델 12, 실행 가이드 13, 참고 14, 공용 파일 15, 배경 16, 용어집 17, 문서 규격 90, 문서 사이트 사용법 91.
- 메뉴에 없는 쪽(탭 폴더 밖)은 경고. `kit-features`, `kit-areas` 표시 줄은 탭 표·분야 표.

### 4.4 화면 (`Page.astro`, `kit.css`, `kit.js`)

- 머리줄(이름, 검색, 저장소 링크, 테마), 탭 줄(최상위 메뉴), 옆 메뉴, 본문(`kit-content md-typeset`), 이 페이지(제목 목차), 앞뒤 쪽, "이 페이지 고치기"(`site.edit_url`). 960px 아래에서는 옆 메뉴가 서랍 메뉴로.
- 테마: 밝음 `#fdfdf7`, 어두움 `#0d0c0a`, 강조 `#b9784c`/`#d4a27f`. 사용자가 고른 테마는 `localStorage` `kit-theme`, 없으면 시스템. 뷰어(C4, 로드맵, 보드)는 끼워 넣으면 쪽 테마를 따르고, 혼자 열면 저장한 선택 → 사이트의 선택 → 시스템 순. 문서 지도는 늘 어두움.
- MkDocs 판 CSS를 그대로 쓰는 쪽(현황판, 로드맵 삽입)을 위한 호환 층: `md-typeset` 클래스, `--md-*` 색 변수, `<html data-md-color-scheme>`.
- 검색: Pagefind(빌드 뒤 색인 `_kit/pagefind/`, 처음 검색할 때 받음). 템플릿·생성 쪽은 색인하지 않음.
- 링크 미리보기 태그(OG)는 늘, `docs-kit.yml site.url`이 있으면 canonical 주소와 `sitemap.xml`도.

## 5. 탭 설정

### 5.1 `docs-kit.yml` (프로젝트 루트)

```yaml
profile: dev              # minimal | app | dev | research | all
features:                 # 묶음 기본값에서 바꿀 탭만 (true/false). 없으면 features: {}
  weekly: false
areas:                    # ADR·VR·EXP 머리말 area 값 (id: 이름). 없으면 기본 분야
  dev-env: 개발 환경
```

- 사이트는 `yaml` 패키지와 zod 스키마로, `kit.py`는 PyYAML(없으면 이 모양만 읽는 작은 파서)로 읽음. 그 밖의 절: `site`(`name`, `logo_icon`, `issues_url`, `shared_port`, `base`, `url`, `repo_url`, `edit_url`, `extra_css`, `extra_js`), `links`(짧은 주소 `{name, to, title}` 목록), `rerun`(`viewer: local|hosted`, `hosted_url`, `version`, `web_port`, `file_port`, `start`), `nav`(선택).
- 켬 판정: `features`에 있으면 그 값 → 묶음 목록에 있으면 켬. 파일이 없으면 `auto`: ADR은 늘 켬, 나머지는 `docs/<data>`가 있으면 켬(0.15 이전 프로젝트 호환).
- 모르는 `profile`·탭 id는 빌드 경고 `WARNING kit: docs-kit.yml: ...`. `docs-kit.yml`이 없고 `mkdocs.yml`만 있으면 거기서 읽고 경고(`kit.py migrate`로 옮김).
- 기본 분야: `arch` 구조·설계, `dev-env` 개발 환경, `platform` 플랫폼·연동, `data` 데이터, `quality` 품질·시험, `safety` 안전·보안, `ops` 배포·운영, `docs` 문서.

### 5.2 탭 목록 (`site/src/config/features.json`)

| id | 탭 | 종류 | 폴더 (`data`: auto 판정) | 시작 파일 (`template/features/<id>/`) | 함께 |
| --- | --- | --- | --- | --- | --- |
| `history` | 작업 내역 | nav | `history.md` | `docs/history.md` | |
| `plan` | 현황판 | 탭 모듈 | `plan` (`plan/scope.yml`) | `docs/plan/{scope.yml,risks.yml,sprints.json}` | roadmap |
| `weekly` | 주간 보고 | 탭 모듈 | `weekly` | (없음: `weekly_draft.py --write`) | |
| `roadmap` | 로드맵 | 탭 모듈 | `roadmap` (`roadmap/roadmap.yml`) | `docs/roadmap/roadmap.yml` | |
| `graph` | 문서 지도 | 탭 모듈 | `graph` | (없음) | |
| `quality` | 근거 점검 | 탭 모듈 | `quality` | `docs/quality/{config,questions,incidents}.json` | |
| `publications` | 문서함 | 탭 모듈 | `publications` | (없음) | |
| `arc42` | 아키텍처 | 탭 모듈 | `arc42` | 12개 섹션을 `kit.py`가 생성(`aNN_<이름>.md`, `status: empty`) | adr |
| `adr` | ADR | 탭 모듈 | `adr` | `docs/adr/0001-record-architecture-decisions.md`, `docs/adr/c4-model.yml` | |
| `experiments` | 실험 | 탭 모듈 | `experiments` | (없음) | records |
| `records` | 검증 기록 | 탭 모듈 | `records` | (없음) | |
| `models` | 모델 | nav | `models` | `docs/models/README.md` | experiments, records |
| `guides` | 실행 가이드 | nav | `guides` | `docs/guides/g1_getting_started.md` | |
| `reference` | 참고 | nav | `reference` | `docs/reference/r1_ports.md` | |
| `shared` | 공용 파일 | nav | `shared` | `docs/shared/README.md` | |
| `background` | 배경 | nav | `background` | `docs/background/01_background.md` | |
| `glossary` | 용어집 | nav | `glossary` | `docs/glossary/README.md` | |

arc42 섹션 파일 이름: a01_goals, a02_constraints, a03_context, a04_solution_strategy, a05_building_blocks, a06_runtime, a07_deployment, a08_crosscutting, a09_decisions, a10_quality, a11_risks(`<!-- risk-register -->`), a12_glossary.

### 5.3 묶음 (`features.json` `profiles`)

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
| `update` | 문제 없을 때만 `git fetch` → 따라가는 브랜치(체크아웃한 브랜치, 없으면 `.gitmodules`의 branch, 없으면 main)로, 옛 버전 이후 CHANGELOG 제목을 보여 줌 |
| `migrate` | MkDocs 판 `mkdocs.yml`의 `site_name`, `theme.icon.logo`, `extra.issues_url`, `extra.links`(`shared_port`, `short`), `extra.rerun`, `nav`를 `docs-kit.yml`로. `mkdocs.yml`은 지우지 않음. 다시 돌려도 같음 |

`docs-kit.yml`은 줄 단위로 고쳐 주석을 보존합니다. `bin/init.sh "이름" [묶음]`은 `kit.py init`의 얇은 감싸기입니다.

---

## 6. 탭별 명세

공통: 파일 번호는 네 자리(`NNNN-영문-소문자-제목.md`), 제목 첫 줄은 `# <접두사>-NNNN. <제목>`이고 번호가 파일과 같아야 함. 카드는 제목 바로 아래 HTML. 표시 줄은 한 줄에 단독일 때만 바꿈(코드 펜스 안은 그대로). `site.issues_url`이 있으면 이슈 `#N`과 MR `!N`이 트래커로 링크됨.

### 6.1 ADR과 C4 (`adr`)

- 머리말(필수 `status`, `date`, `deciders`, `area`, `summary`; 선택 `c4`, `supersedes`, `superseded_by`, `related`). `status`: proposed 제안, accepted 승인, rejected 기각, deprecated 폐기, superseded 대체됨.
- 템플릿 순서: 배경 → 결정 요인 → 고려한 선택지(`### N. 이름`마다 **장점 / 단점 / 기각 사유**, 고른 것 `(채택)` + **채택 이유**) → 결정 → 선택지 비교 표 → 결과(좋아지는 점, 감수할 점, 후속 작업) → 재검토 조건 → 참고. 작성 가이드(`assets/adr/guide.md`)에 검토 체크리스트와 "승인 뒤 고치지 않음, 예외: 오타·링크, 후속 작업 체크, 형식 정리".
- 메뉴: nav의 "ADR" 절(없으면 더함)을 README, log, c4, guide, template + 모든 ADR(번호순)로 채움.
- 표시 줄: `<!-- adr-index -->`(번호, 제목, 상태, 분야, 날짜), `<!-- adr-log -->`(시간순 한 줄 요약), `<!-- c4-app -->`(뷰어 삽입), `<!-- c4-elements -->`(요소 표), 어느 페이지에서나 `<!-- c4-view: <뷰 id> [height=N] -->`.
- 카드: 상태 배지, 날짜, 결정한 사람, 분야, 아키텍처 요소(뷰어 링크), 대체 관계, (records·experiments 모듈이 더함) 검증 기록·실험.
- C4 모델 `docs/adr/c4-model.yml`: `elements`(`id` 바꾸지 않음, `name`, `kind`: person/system/container/component, `parent`, `technology`, `description`, `external: true` 상속), `relations`(`from`, `to`, `label`, `tech`, `kind`: flow 실선 기본 / alt 점선 택1 / call 짧은 점선 양방향), `views`(`id`, `title`, `description`, `scope`(없으면 최상위 컨텍스트), `include`, `direction: RIGHT|DOWN`, `outside: elements`). 하위 요소 관계는 상위 그림에서 상위 요소 관계로 합쳐짐.
- 뷰어 `adr/viewer/`(독립 페이지, 데이터 `adr/viewer/data.json`은 빌드가 씀): ELK layered + 직각 경로, 카드 HTML + 선 SVG를 한 무대에서 CSS transform으로 이동·확대. 카드 클릭 → 패널(설명, 기술, 결정 카드, 보내는·받는 관계, 검증 기록), 더블클릭 → 안으로(드릴다운), 마우스 올리면 연결만 강조(관계 종류별 색), 결정 필터, 결정 카드 탭, 밝음/어두움, 주소 `#view=<id>&el=<id>`, `#tab=decisions&adr=<n>`, `?embed=1`이면 페이지 테마를 따르고 자체 토글 숨김. 다른 팀·외부는 점선 테두리 채움 없음.
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

- 노드: 모든 페이지(템플릿, 로드맵 항목 페이지, 꺼진 탭의 키트 페이지 제외). 연결은 다 만들어진 쪽(§ 자동 링크 포함)에서 읽음. 종류(색+모양): 아키텍처, 결정, 검증, 실험, 발행물·보고, 가이드·참고, 배경·용어, 목록·안내(처음엔 숨김). 크기 = 연결 수.
- 선 세 종류: **본문 링크**(다 만들어진 HTML, 방향·백링크), **머리말 관계**(VR `adr`·`guide`·`supersedes`, ADR `related`·`supersedes`, EXP `adr`, 발행물 `based_on`), **비슷한 내용**(제안: 0.55 × TF-IDF 코사인(한국어 조사·어미·불용어 제거) + 0.30 × 서지 결합(같은 문서를 가리킴, 드문 대상 가중) + 0.15 × 같은 C4 요소(드문 요소 가중), 문서마다 상위 3개, 링크 없는 쌍만, 이유 보관).
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
- 사이트: 근거 점검 표시 줄이 있는 쪽이 있을 때 `python3 bin/docs_check.py --root <프로젝트> --json`을 실행(`DOCS_PYTHON`으로 바꿈), 결과를 `build/quality/report.json`에 캐시(문서·코드·설정이 바뀔 때까지). 표시 줄 `quality-summary`, `quality-trend`, `quality-tasks`(살아 있는 문서에서 고칠 것, 낡은 근거, 확인할 것, 고치지 않는 기록), `quality-docs`, `quality-kinds`(종류별 확인법·고치는 법), `quality-retrieval`, `quality-incidents`.
- `bin/docs_ask.py "<질문>"` / `--serve [--port 8003] [--from-ports 8001]`: 검색(하이브리드 또는 BM25, 문서당 최대 2절, 상위 K) → 없으면 모델을 부르지 않고 "문서에서 확인 못 함" → 생성(`DOCS_LLM_URL`, llama.cpp OpenAI API, 온도 0, 번호 붙은 절만 쓰고 문장마다 `[n]`, 모르면 "문서에서 확인 못 함") → 문장 점검(인용 없음·범위 밖 번호 → 근거 없음, 인용 절에 없는 문서 ID·이슈·경로·`코드`·단위 붙은 수·포트 → 확인 못 함(그 말을 표시), 그 밖 → 근거 있음). 생성 서버가 없으면 근거만. API `GET /api/health`, `GET /api/search?q=&k=`, `POST /api/ask {q, k}`, 미리보기 포트에서 온 요청만, 생성은 한 번에 하나.

### 6.11 일반 탭 (`history`, `guides`, `reference`, `shared`, `background`, `glossary`, `models`)

탭 모듈 없이 메뉴만 만듭니다(§4.3). 형식은 규격: 실행 가이드 `gN_*.md` `# G<N>.`, 맨 위 `> 기준: 날짜 + 마지막 검증 VR`, 단계마다 명령 → 기대 결과 → 안 될 때. 참고 `rN_*.md` `# R<N>.` 값의 표. 배경 `NN_*.md` `# NN.`(두 자리 번호는 배경에만). 작업 내역 `docs/history.md` 최신순 표(날짜, 업무, 내용, 결과, 재현·실행, 자세히). 공용 파일은 짧게(이름·버전·내용물·받기·경로). 모델 카드 형식은 첫 승격 때 정함.

---

## 7. 공통 기능

| 기능 | 파일 | 동작 |
| --- | --- | --- |
| 절 참조 링크 | `site/src/lib/links.ts` | 다 만든 HTML에서 `§4.3`(같은 쪽 제목 "4.3 …" 또는 첫 칸이 번호인 표 행), `11 §4`(파일 이름이 `11_`로 시작하는 쪽), `A5 §2`·`G1 §6`·`R2 §1`, 쪽만 가리키는 링크 텍스트 "08 §3.1"에 앵커를 붙임. 코드·제목·기존 링크는 그대로, 없는 번호는 텍스트 |
| 링크 검사 | `site/src/lib/links.ts` | 없는 쪽, 없는 앵커(제목·`id`)는 경고 |
| 목록 바로잡기 | `site/src/markdown/pre.ts` | 렌더 전: 2~3칸 하위 목록을 4칸 단위로(이어지는 줄·코드 펜스 함께), 글 바로 아래 목록 앞에 빈 줄. 코드·표·제목·HTML·인용 그대로 |
| 짧은 주소 | `src/pages/r/[name].astro`, `kit.js` | `docs-kit.yml links: [{name, to, title}]` → `r/<name>/index.html`(이동 쪽). `to`: `.md`, `rerun:<경로>`(Rerun 뷰어 + 파일 서버), `catalog:<port>[@<viewer port>]`, `port:<port>/<경로>`. 호스트는 언제나 읽는 사람이 연 호스트. `<!-- short-links -->` 표. 본문 링크 `[글](rerun:...)`도 같음. `<div class="kit-dev-only" markdown>`은 `site.shared_port`가 아닌 포트에서만 보임. 이름 규칙 `^[a-z0-9][a-z0-9._-]*$`, 없는 쪽은 경고 |
| Rerun 기록 상자 | `markers.ts`, `kit.js` | `<!-- rerun: <경로> [height=N] -->` → "뷰어 불러오기" 버튼 상자(누르기 전 아무것도 받지 않음). `rerun.viewer: local`이면 같은 PC 뷰어(파일 서버가 안 답하면 `rerun.start` 안내), `hosted`면 app.rerun.io가 사이트의 `.rrd`를 엶(`rerun.version`으로 SDK와 맞춤) |
| Mermaid | `kit.js` | ` ```mermaid ` 펜스가 있는 쪽에서만 Mermaid(ESM)를 받아 그림, 색은 키트 테마, 확대 틀(−/+/맞춤/전체 화면, 끌어 이동, Ctrl/⌘+휠) |
| 수식 | `pipeline.ts` | `$...$`, `$$...$$`를 빌드 때 KaTeX로(읽는 쪽에 스크립트 없음) |
| 코드 | `pipeline.ts`, `kit.js` | Shiki 밝음·어두움 색, 복사 단추 |
| 경고 | `site/src/lib/warnings.ts` | `WARNING <탭>: <파일>: <내용>`을 모아 빌드 끝에 `docs-kit: N pages, M warning(s)`, 목록 `build/.kit/warnings.txt`, `--strict`(`DOCS_STRICT=1`)면 실패 |

---

## 8. 도구 (`bin/`)

| 도구 | 실행 | 계약 |
| --- | --- | --- |
| `docs.sh start\|stop\|status\|logs\|serve\|build [--strict]` | Docker 또는 호스트 Node | `DOCS_RUNNER=docker\|host`, `DOCS_PORT`(8000), `DOCS_ROOT`, `DOCS_IMAGE`. Docker: 컨테이너 `docs-<프로젝트 폴더>`, 호스트 사용자, `--restart unless-stopped`. 호스트: Astro 배경 서버. 키트 `site/` 코드를 고치면 stop/start |
| `kit.py` | 호스트 | §5.4 |
| `init.sh "이름" [묶음]` | 호스트 | `kit.py init` |
| `selftest.sh` | Docker 또는 호스트 Node | §11 |
| `site_diff.py OLD NEW [--allow F] [--json]` | 호스트 | 빌드한 두 사이트의 쪽 목록·제목·절 앵커·링크 대상 비교(MIG-4) |
| `compare_editions.sh [프로젝트]` | 호스트 | 같은 문서를 MkDocs 판(v0.15.4)과 지금 판으로 빌드해 비교(§11) |
| `docs_search.py`, `docs_check.py`, `docs_ask.py` | 호스트 | §6.10. 모델 서버는 127.0.0.1만 부름 |
| `serve.sh board\|ask start\|stop\|status\|logs` | 호스트 | 배경 서버, `build/serve/<이름>.{pid,log}`, `DOCS_DEV_PORT`(8001), `BOARD_PORT`(8002), `DOCS_ASK_PORT`(8003), `DOCS_ASK_PRESTART`(모델 서버 시작 명령) |
| `plan_board.py --root R [--port 8002] [--from-ports 8001]` | 호스트 | `POST /api/sprints` → 검사 → 백업 → `docs/plan/sprints.json` |
| `repro.sh VR-NNNN [args]` | 호스트 | §6.5 |
| `weekly_draft.py` | 호스트 | §6.6 |

**프로젝트가 맡는 것**(키트 밖): 이슈 트래커 스냅숏 내보내기(`issues.json` 형식만 맞춤), 임베딩·생성 모델 서버(예: TEI CPU 이미지, llama.cpp 서버를 127.0.0.1에, 모델은 내부 보관소에서 오프라인), 공유 배포(예: 기본 브랜치 병합 뒤 자동 빌드·검증·교체), Rerun 뷰어·파일 서버, 프로젝트 환경 점검 스크립트(키트 상태는 `kit.py check`로 위임 가능).

---

## 9. 템플릿

- `template/base/docs-kit.yml`: `profile: {{PROFILE}}`, `features: {}`, 기본 분야, `site`(`name: "{{PROJECT}}"`, 로고, 주석 처리한 `issues_url`·`base`·`url`·`repo_url`·`edit_url`·`extra_css`), 주석 처리한 `rerun`, `links`에 home. 프로젝트 설정 파일은 이것 하나.
- `template/base/docs/README.md`: 목적 자리, 사이트 여는 법, "어디서 무엇을 보나" 표.
- `template/features/<id>/`: §5.2. 예시 값은 일반적인 것(트랙 env/core/ui, Epic E0·M1, 리스크 R01 `<예시>`)이고 프로젝트가 바꿈. JSON에는 `about` 설명 줄.
- `template/agents/AGENTS.docs-kit.md`: §10.

## 10. 에이전트 운영

- 사람은 README §1의 지시문을 붙여 넣고, 에이전트는 AGENTS-GUIDE를 따릅니다: 새 프로젝트(§2: 묻기 9가지 → 제안서 → 승인 → `kit.py init` + 예시 바꾸기 + AGENTS.md → 경고 0), 진행 중 프로젝트(§3: 읽기만 조사 → 이전 대응표 → 승인 → 형식만 이전), 운영 요청(§6), 키트 고치기(§7).
- 프로젝트 AGENTS.md의 "문서 관리 (docs-kit)" 절(템플릿 D1~D7): D1 세션 시작 `kit.py check --fetch`와 경고별 조치, 동시 세션 주의 / D2 어디에 쓰나(층 표, 정본·이슈·용어·번호·링크·큰 파일·ADR·VR 규칙) / D3 근거 먼저(`docs_search` → 읽기 → 근거 붙이기 → 못 찾으면 그렇게 말하기 → 사례 기록) / D4 쓰고 나서 확인(빌드 경고 0, `docs_check --changed`) / D5 탭별 흐름(`[탭: id]` 항목: roadmap, plan, weekly, graph, quality, history; 끈 탭은 지움) / D6 키트 고치기(있는 탭 먼저, main 확인, VERSION·CHANGELOG·context, selftest, 키트 먼저 push, `--recurse-submodules=no`) / D7 git(요청 시만, 내 파일만 경로로, 주제별 커밋).
- 최신 유지 고리: 프로젝트 A에서 공통 형식을 고침 → 키트 저장소 push → 프로젝트 B의 다음 세션 D1이 `newer docs-kit` 알림 → `kit.py update` → CHANGELOG에 형식 이전이 있으면 문서를 옮김 → `.docs-kit` 커밋.

## 11. 시험

`bin/selftest.sh`(실행 방식은 `docs.sh`와 같음)가 `template/`로 임시 프로젝트를 만들어 빌드하고 하나라도 어긋나면 실패합니다. 끝에 `selftest OK (<N> pages)`.

1. 단위 시험 `npm test`(`site/tests/`: 블록, 목록, 끼워 넣기, 표시 줄, 머리말, 제목 앵커, 주소).
2. 묶음 다섯 개 빈 프로젝트: 경고 0, 탭 순서. `minimal`에서 `kit.py enable plan roadmap weekly` + `disable glossary` → 시작 파일 복사, 경고 0, 순서.
3. `all` 프로젝트 + 고정 입력 `tests/fixtures/all/`(주간 보고 2개, 합류하는 로드맵, Epic·WBS·질문이 있는 scope, 스프린트, 리스크, 없는 `ADR-0999`를 인용한 쪽, 검색 질문, 2칸 하위 목록, Markdown 문법 쪽 `guides/g2_markdown.md`, ADR·VR·EXP·P 하나씩): 경고 0, 주요 산출물, Markdown 문법별 결과, 기록 탭(목록·카드·역링크·C4 데이터), 진행 탭(업무별 흐름, 노선도 합류와 묶인 refs, PI 매트릭스 칸 20에 R01, 보드 카드 W1, 속도 그림, 원천 파일 싣지 않음), 지도(주제·관계·번호)와 근거 점검(ADR-0999 틀림, 검색 평가), `kit.py migrate`, 일부러 깨뜨린 ADR이 경고를 내는지, `docs_ask.check()` 판정 순서.

MkDocs 판과의 비교(엔진을 크게 바꿨을 때): `bin/compare_editions.sh`(고정 입력)와 `bin/compare_editions.sh <실제 프로젝트>`가 `tests/site-diff-allow.txt` 밖의 차이 0. 2026-11-21 결과와 성능·크기·재현성·모바일 측정은 `site/README.md` "M7 verification".

---

## 12. 다시 만드는 순서 (저장소를 가져갈 수 없을 때)

단계마다 확인 기준을 통과한 뒤 다음으로 갑니다. 엔진 요구사항은 [prd.md](prd.md), 화면 문구·예시는 이 문서와 `assets/` 설명을 따르고, 없는 것은 지어내지 말고 사용자에게 묻습니다.

| 단계 | 만들 것 | 확인 |
| --- | --- | --- |
| 1 | 저장소 뼈대, `VERSION`, `CHANGELOG.md`, `.gitignore`, `site/`(Astro, `paths.ts`, `load.ts`, `features.json`), `bin/docs.sh`(docker·host), `docker/` | 빈 프로젝트(`docs/README.md` + `docs-kit.yml`)가 빌드·미리보기 |
| 2 | Markdown(§4.2), 화면(§4.4), 검색, 경고 모음 | 문법 쪽이 그려지고 경고 0, 휴대폰 폭에서 가로 넘침 0 |
| 3 | `bin/kit.py`(init, status, enable/disable/profile, check, update, migrate), 메뉴(§4.3), `template/base/`, 일반 탭 | 묶음 다섯 개 경고 0, 탭 순서 |
| 4 | 공통 기능(§7) | § 링크, 짧은 주소, Rerun 상자, 링크 검사 |
| 5 | ADR + C4(모듈, 쪽 5개, 뷰어 + elkjs), records, experiments, arc42, publications | 목록·카드·역링크·검사, 뷰어 드릴다운 |
| 6 | weekly(+ `weekly_draft.py`), roadmap(모듈, 뷰어, 항목 쪽), plan(모듈, `plan.js`, `plan.css`, 보드, `plan_board.py`, `serve.sh board`) | 업무별 흐름, 노선도 합류, 진척 그림·예측, PI 매트릭스, 보드 저장(미리보기 포트에서만) |
| 7 | `docs_search.py`, `docs_check.py`, quality 모듈, `repro.sh`, graph(모듈, 뷰어), `docs_ask.py`, `serve.sh ask` | ADR-0999 틀림, 검색 평가, 지도·점검·주제, 질문(생성 서버 없으면 근거만) |
| 8 | `docs-standard.md`, `docs-kit.md`, `selftest.sh`(§11), README, AGENTS-GUIDE, AGENTS 템플릿, 이 문서 | `selftest OK` |
| 9 | 실제 프로젝트 하나에 서브모듈로 넣어 README §1.1 지시문으로 세워 봄 | 제안 → 승인 → 경고 0, `kit.py check` 경고 0 |

---

## 13. 버전과 주의점

- 키트에는 회사·프로젝트 고유 내용을 넣지 않음. 프로젝트별 값(임베딩 지시문 `embed_instruct`, 분야, 포트 표)은 프로젝트 설정에.
- 버전: 형식·탭 추가 = 마이너, 고침 = 패치. 1.0 고정 조건과 그 뒤 규칙은 규격 §12(섹션 번호, 부록, 문서 종류, 머리말 필드 고정, 바꾸면 메이저 + 이전 안내).
- CHANGELOG 항목은 영어 한 문단, "무엇이 · 어떻게 · 경고"를 적음. 형식 이전이 필요하면 그 사실을 첫 줄에.
- YAML 함정: 흐름 맵 값에 `, `가 있으면 잘려서 모르는 키(경고), ` #` 뒤는 주석으로 사라짐(경고 없음) → 따옴표. `"#60"`처럼 이슈 번호는 따옴표.
- 링크될 제목에 ` / `, ` → `, ` - ` 금지(GitLab이 `--`를 `-`로 줄여 앵커가 어긋남).
- 미리보기 서버는 키트 `site/` 코드를 시작할 때만 읽음 → 고치면 `docs.sh stop` / `start`. `docs/`, `docs-kit.yml`, `assets/`는 바로 반영.
- MkDocs는 머리말 키 `template:`를 쪽 템플릿으로 씀. Astro 판은 그 키를 쓰지 않으므로 프로젝트가 자유롭게 쓸 수 있지만, MkDocs 판과 비교할 때는 `compare_editions.sh`가 복사본에서 이름을 바꿈.
- 보드·질문 서버는 Origin이 미리보기 포트일 때만 받음. 공유 사이트는 읽기 전용.
- 꺼진 탭의 키트 쪽은 메뉴 밖으로 빌드되므로 문서 규격의 템플릿 링크가 끊기지 않음. 문서 지도와 사이트맵은 그 쪽을 넣지 않음.
- 표시 줄(`<!-- plan-summary -->` 등)은 한 줄에 단독일 때만 바뀜. 설명 글에 쓸 때는 `` `코드` `` 안에.
