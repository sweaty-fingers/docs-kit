# PRD: docs-kit (Astro 판)

에이전트가 **빈 저장소에서 시작해 docs-kit을 처음부터 구현**할 수 있도록 무엇을, 왜, 어떤 기준으로 만드는지 정한 제품 요구사항 문서입니다. 사이트 엔진은 **Astro**로 새로 만들고, 문서 형식·규칙·호스트 도구·에이전트 운영 방식은 현재 docs-kit(0.15, MkDocs 판)과 같게 유지합니다.

| 항목 | 값 |
| --- | --- |
| 문서 상태 | 초안 (2026-11-20) |
| 기준 구현 | docs-kit 0.15.3 (MkDocs Material 9.5.49 + Python 훅). 동작의 세부 기준은 같은 저장소의 `docs-kit-context.md`와 코드 |
| 독자 | 구현하는 에이전트, 검토하는 사람 |
| 바꾸는 것 | 사이트 생성기(MkDocs + 훅 → Astro + remark/rehype 플러그인 + 빌드 모듈 + 클라이언트 아일랜드) |
| 그대로 두는 것 | `docs/` 문서 형식과 머리말, 데이터 파일(`roadmap.yml`, `scope.yml` 등), 문서 규격, 템플릿, 탭 설정 `docs-kit.yml`, Python 호스트 도구, 에이전트 문서, 사이트 주소(경로) |

읽는 순서: §1~§3(왜, 무엇을) → §4~§6(구조와 설정) → §7(기능 요구사항, 구현의 대부분) → §8~§10(품질, 호환, 시험) → §11(구현 순서) → §12(열린 질문).

---

## 1. 배경과 문제

docs-kit은 여러 프로젝트가 같은 규격으로 문서를 쓰고 웹으로 보게 하는 공통 키트입니다. 각 프로젝트에 git 서브모듈(`.docs-kit/`)로 들어가고, 에이전트가 키트의 규칙대로 문서를 쓰고 관리합니다. 현재 판은 MkDocs Material 위에 Python 훅 약 15개로 목록·카드·메뉴·검사와 대화형 뷰어(아키텍처, 로드맵, 문서 지도, 스프린트 보드)를 얹었습니다.

현재 판의 한계(새 판을 만드는 이유):

| # | 한계 | 영향 |
| --- | --- | --- |
| P1 | 페이지 모양을 MkDocs Material 테마 안에서만 바꿀 수 있음. 현황판·로드맵 같은 대시보드 페이지는 문자열로 HTML을 조립 | 화면을 고치기 어렵고, 훅 코드가 크고 시험하기 어려움 |
| P2 | 뷰어 4개가 각자 독립 HTML + 전역 스크립트, 빌드 데이터는 `window.X = {...}` 파일 | 공통 부품(패널, 거르기, 테마)을 나눠 쓰지 못함 |
| P3 | 훅 사이 순서·전역 상태 의존(ADR → VR → 지도 …) | 탭을 끄고 켤 때 예외가 생기기 쉬움 |
| P4 | 타입 없는 머리말 검사(훅마다 따로) | 형식 검사가 흩어짐 |

Astro를 고른 이유: 문서 콘텐츠(Markdown) 중심의 정적 사이트, 콘텐츠 컬렉션 + 스키마 검사, 페이지는 HTML로 내보내고 필요한 곳만 클라이언트 아일랜드, remark/rehype 생태계로 Markdown 확장, 결과물이 정적 파일이라 사내망 서버에 그대로 올림.

## 2. 목표와 비목표

### 2.1 목표

| ID | 목표 | 성공 기준 |
| --- | --- | --- |
| G1 | 현재 판의 모든 탭·기능을 Astro로 같은 동작으로 제공 | §7의 모든 FR 수용 기준 통과 |
| G2 | 기존 프로젝트의 `docs/`를 고치지 않고 그대로 빌드 | 현재 판을 쓰는 실제 프로젝트(문서 ~100개)가 새 판으로 빌드되고 경고 0, 주소(경로)가 같음(§9) |
| G3 | 탭을 프로젝트마다 켜고 끔 | 묶음 5개(minimal, app, dev, research, all) 모두 경고 0, 꺼진 탭은 메뉴·검사·데이터 모두 없음 |
| G4 | 사내망만으로 빌드·열람 | 빌드와 열람 중 외부 요청 0 (시험으로 확인) |
| G5 | 에이전트가 같은 방식으로 운영 | AGENTS-GUIDE, AGENTS 템플릿, README 지시문이 새 판 명령으로 맞춰짐 |
| G6 | 화면을 고치기 쉬움 | 페이지·부품이 Astro 컴포넌트로 나뉘고, 빌드 데이터 계산은 타입 있는 모듈로 단위 시험 가능 |

### 2.2 비목표

- 문서 형식·머리말·데이터 파일 형식을 바꾸는 것(바꾸면 별도 버전과 이전 안내).
- 서버 측 기능(로그인, DB). 사이트는 정적 파일. 쓰기가 필요한 곳(스프린트 보드 저장, 문서 질문)은 지금처럼 로컬 보조 서버.
- 위키처럼 브라우저에서 문서 편집.
- 호스트 Python 도구(`kit.py`, `docs_search.py`, `docs_check.py`, `docs_ask.py`, `plan_board.py`, `repro.sh`, `weekly_draft.py`)를 Node로 다시 쓰는 것. 그대로 씁니다(§6.4).

## 3. 사용자와 시나리오

| 사용자 | 하는 일 |
| --- | --- |
| 문서 작성자(사람) | Markdown·YAML을 고치고 미리보기에서 바로 확인 |
| 에이전트 | 규칙(AGENTS.md)대로 문서를 쓰고, 탭을 켜고, 검사(빌드 경고 0, 근거 점검)를 통과시킴 |
| 팀 리더·검토자 | 공유 사이트에서 현황판·주간 보고·로드맵·결정을 봄 |
| 새로 합류한 사람 | 문서 지도·ADR·가이드로 프로젝트를 파악, 문서에 질문 |

핵심 시나리오:

1. **새 프로젝트**: 사람이 README의 지시문을 에이전트에게 줌 → 에이전트가 목적·성격을 묻고 탭 묶음을 제안 → 승인 → `kit.py init` → 빌드 경고 0 → 사이트가 뜸.
2. **진행 중 프로젝트에 도입**: 에이전트가 기존 문서를 읽고 이전 대응표를 제안 → 승인 → 형식만 옮김.
3. **일상 작성**: 작성자가 ADR을 추가 → 미리보기가 1~2초 안에 다시 그림 → 목록·로그·카드·지도가 저절로 갱신.
4. **주간 회의**: 에이전트가 주간 보고 초안 → 사람이 고침 → 현황판·스프린트 보드로 회의.
5. **탭 추가**: "로드맵이 필요해" → `kit.py enable roadmap` → 시작 파일 복사, 메뉴에 나타남.
6. **키트 갱신**: 프로젝트 A에서 형식 개선 → 키트 저장소 push → 프로젝트 B 세션 시작 점검이 새 버전을 알림 → `kit.py update`.

---

## 4. 제품 구성

```text
docs-kit/                         # 키트 저장소 (프로젝트에 .docs-kit/ 서브모듈)
  README.md AGENTS-GUIDE.md prd.md docs-kit-context.md CHANGELOG.md VERSION
  site/                           # Astro 프로젝트 (사이트 엔진)
    package.json package-lock.json astro.config.mjs tsconfig.json
    src/
      config/                     # docs-kit.yml 읽기, 탭 목록·묶음, 프로젝트 경로
      content/                    # 콘텐츠 컬렉션 정의 (프로젝트 docs/를 읽음)
      lib/                        # 탭별 빌드 모듈 (adr, records, plan, roadmap, graph, quality, ...) — 순수 TS, 단위 시험
      markdown/                   # remark/rehype 플러그인 (호환 문법, 표시 줄, 절 참조, 목록 바로잡기, ...)
      components/                 # Astro 컴포넌트 (레이아웃, 메뉴, 카드, 표, 그림)
      islands/                    # 클라이언트 아일랜드 (C4 뷰어, 로드맵, 문서 지도, 스프린트 보드, 현황판 상호작용)
      pages/                      # 라우트: [...slug].astro, 뷰어 페이지, 데이터 엔드포인트, r/[name]
      styles/                     # 테마 토큰, 밝음/어두움
    public/_kit/vendor/           # 내장 라이브러리 (Mermaid, ELK, KaTeX 글꼴 등)
    tests/                        # 단위 시험, 고정 입력(fixtures)
  assets/                         # 키트가 제공하는 페이지의 Markdown (문서 규격, 사용법, 탭별 README·가이드·템플릿)
  template/base/ template/features/<id>/ template/agents/
  bin/                            # 호스트 도구 (Python 3.8 표준 라이브러리 + 셸)
    kit.py docs.sh init.sh selftest.sh docs_search.py docs_check.py docs_ask.py serve.sh plan_board.py repro.sh weekly_draft.py
  docker/Dockerfile               # 사이트 빌드·미리보기 이미지 (Node 고정 + 의존성 설치 완료)
```

프로젝트 쪽:

```text
<프로젝트>/
  .docs-kit/                      # 서브모듈
  docs-kit.yml                    # 탭, 분야, 사이트 설정 (§5)
  docs/ ...                       # 내용 (형식은 현재 판과 같음)
  AGENTS.md (+ CLAUDE.md)
  build/site/                     # 빌드 결과 (git 제외)
```

원칙(현재 판과 같음):

- 키트에는 구조·템플릿·예시·자동화만. 회사·프로젝트 고유 이름·값을 넣지 않습니다.
- 프로젝트 `docs/`에 키트 페이지와 같은 경로의 파일이 있으면 프로젝트 파일이 우선합니다.
- 화면 문구는 한국어, 코드·주석·CLI 출력은 영어. 문서 문체 "~합니다".
- 사실은 정본에만, 할 일은 이슈 트래커, 기록(ADR·VR·EXP·발행 보고)은 추가만.

## 5. 설정: `docs-kit.yml`

현재 판의 `docs-kit.yml`(탭·분야)에 MkDocs `mkdocs.yml`이 맡던 사이트 설정을 합칩니다. 프로젝트 설정 파일은 이것 하나입니다.

```yaml
profile: dev                       # minimal | app | dev | research | all  (auto: 파일 없을 때)
features: {weekly: false}          # 묶음에서 바꿀 탭만
areas:                             # ADR·VR·EXP 머리말 area 값
  arch: 구조·설계
  dev-env: 개발 환경
site:
  name: "프로젝트 이름"
  logo_icon: book-open-page-variant   # 아이콘 이름 (내장 아이콘 세트)
  issues_url: https://tracker.example/group/project/-/issues/   # #12, !27 링크 (MR은 issues → merge_requests)
  shared_port: 8000                # 이 포트가 아니면 dev-only 블록이 보임
nav:                               # 선택. 없으면 켠 탭이 표준 순서로 (§7.1)
  - 개요: [README.md, history.md]
  - 실행 가이드: [guides/g1_setup.md, guides/g2_build.md]
links:                             # 짧은 주소 /r/<name>/
  - {name: c4, to: adr/c4.md, title: 아키텍처 뷰어}
  - {name: rec, to: "rerun:nas/records/VR-0002/demo.rrd", title: 기록}
rerun: {web_port: 9090, file_port: 9091, start: "tools/rerun_server.sh start"}
```

- **FR-CFG-1** 설정 읽기는 `site/src/config/`의 한 모듈이 하고, 스키마(zod)로 검사합니다. 모르는 키·값은 빌드 경고 `WARNING config: ...`.
- **FR-CFG-2** `profile`·`features`·`areas`의 뜻과 기본값은 현재 판과 같습니다(`docs-kit-context.md` §5). 탭 목록·묶음·기본 분야·탭 순위는 Python(`bin/kit.py`)과 TS(사이트)가 같은 원천을 쓰도록 **`site/src/config/features.json` 한 파일**에 두고 둘 다 읽습니다.
- **FR-CFG-3** 이전 호환: 프로젝트에 `docs-kit.yml`의 `site`가 없고 `mkdocs.yml`이 있으면 `site_name`, `extra.issues_url`, `extra.links`, `extra.rerun`, `nav`를 읽어 씁니다(경고 `WARNING config: settings read from mkdocs.yml; run kit.py migrate`). `kit.py migrate`가 옮겨 적습니다(§9).

## 6. 기술 결정과 아키텍처

### 6.1 스택

| 영역 | 결정 | 이유·조건 |
| --- | --- | --- |
| 사이트 생성 | Astro, 정적 출력(`output: 'static'`) | §1. 버전은 구현 시 확인한 최신 안정 메이저를 `package-lock.json`으로 고정하고 ADR에 근거(릴리스 날짜·태그)를 적음 |
| 실행 환경 | Node LTS를 고정한 Docker 이미지(`docker/Dockerfile`, 이미지 안에 `npm ci` 완료) | 호스트에 Node를 설치하지 않음. 이미지는 사내 레지스트리 미러로 한 번 빌드, 그 뒤 오프라인 |
| UI 아일랜드 | 의존성 없는 TypeScript(바닐라) 기본. 큰 상태가 있는 보드·지도에 한해 Preact 허용 | 번들 크기, 오프라인. 결정은 ADR(§12) |
| 코드 강조 | Astro 내장 Shiki(빌드 때) | 런타임 JS 없음 |
| 수식 | `remark-math` + `rehype-katex`(빌드 때 렌더), KaTeX CSS·글꼴은 `public/_kit/vendor/` | 오프라인, `$...$`, `$$...$$` |
| Mermaid | 클라이언트에서 내장 Mermaid(버전 고정, `public/_kit/vendor/mermaid/`) | 빌드 때 렌더(헤드리스 브라우저)는 이미지가 커짐 |
| C4 배치 | elkjs(내장) | 현재 판과 같음 |
| 검색 | Pagefind(빌드 뒤 색인, 정적, 오프라인) | 사이트 안 검색 상자. 문서 검색 도구(`docs_search.py`)와 별개 |
| 스키마 | zod(Astro 콘텐츠 컬렉션) | 머리말 검사를 한곳에 |
| 원격 측정 | 끔: 이미지에 `ASTRO_TELEMETRY_DISABLED=1`, 의존 도구도 같은 설정 | 사내망 밖으로 보내지 않음 |

### 6.2 빌드 흐름

```text
docs-kit.yml ─┐
              ├─ config 모듈 ── 켠 탭, 분야, 사이트 설정
docs/**/*.md ─┤
assets/**/*.md┴─ 콘텐츠 컬렉션 (프로젝트 파일 우선 겹치기) ── 머리말 스키마 검사
docs/**/*.yml|json (roadmap, plan, quality, graph topics)
        │
        ▼
   lib/ 빌드 모듈 (탭별, 순수 함수): 문서 색인 → ADR·VR·EXP 관계 → 로드맵 → 현황판 → 지도 → 근거 점검 결과
        │                                       └─ 경고 수집기 (WARNING 목록)
        ▼
   markdown/ 플러그인: 호환 문법 → 표시 줄을 컴포넌트로 → 절 참조·자동 링크
        │
        ▼
   pages/: [...slug].astro (문서), 뷰어 페이지, 데이터 엔드포인트(*.json), r/[name] 리다이렉트
        │
        ▼
   build/site/ (+ Pagefind 색인) ── 경고 요약 출력, --strict면 경고가 있을 때 실패
```

- **FR-ARC-1 문서 읽기**: Astro 프로젝트(`.docs-kit/site/`)는 프로젝트의 `docs/`를 밖에서 읽습니다(`DOCS_ROOT` 환경 변수, 기본 = 키트의 부모 폴더). 콘텐츠 컬렉션 로더는 프로젝트 `docs/`와 키트 `assets/`를 합쳐 같은 상대 경로면 프로젝트 것을 씁니다. 꺼진 탭의 키트 페이지는 빌드하되 메뉴에 넣지 않습니다.
- **FR-ARC-2 탭 모듈 계약**: 탭마다 `lib/<id>/index.ts`가 `{ id, collect(ctx): Data, warnings(ctx): Warning[], navSection(ctx), markers: Record<string, Component> }`를 내보냅니다. 꺼진 탭의 모듈은 불리지 않습니다(현재 판의 `gate()`와 같은 효과). 탭 사이 의존(예: VR → ADR 카드 역링크)은 공용 문서 색인을 통해서만 하고, 상대 탭이 꺼져 있으면 그 부분만 생략합니다.
- **FR-ARC-3 경고**: 모든 형식 위반은 `WARNING <탭>: <파일>: <내용>` 한 줄로 모읍니다. 빌드 끝에 개수와 목록을 출력하고, `bin/docs.sh build`는 경고를 표준 출력에 내보내 `grep -iE "warn|error"`로 0을 확인할 수 있게 합니다. `--strict`면 경고 1개 이상에서 종료 코드 1.
- **FR-ARC-4 주소**: 문서 `docs/a/b.md` → `/a/b.html`, `docs/a/README.md` → `/a/index.html`(현재 판의 `use_directory_urls: false`와 같은 경로). Astro `build.format: 'file'` + README 매핑. 본문의 `.md` 상대 링크는 빌드 때 `.html`로 바꾸고, 없는 문서·앵커는 경고.
- **FR-ARC-5 미리보기**: `bin/docs.sh start|stop|status|logs|serve|build`의 명령과 환경 변수(`DOCS_PORT` 기본 8000, `DOCS_IMAGE`, `DOCS_ROOT`)는 현재 판과 같습니다. 미리보기는 `astro dev --host`. `docs/`, `docs-kit.yml`, 키트 `assets/`를 고치면 1~2초 안에 열린 페이지가 다시 그려집니다. 컨테이너 이름 `docs-<프로젝트 폴더>`, 호스트 사용자로 실행, `--restart unless-stopped`.

### 6.3 화면 공통

- **FR-UI-1 레이아웃**: 위쪽 머리줄(로고, 사이트 이름, 검색, 밝음/어두움 전환), 그 아래 **최상위 탭 줄**(고정, 현재 판의 navigation.tabs), 왼쪽 탭 안 절 메뉴(그룹 제목 있음), 가운데 본문, 오른쪽 "이 페이지" 목차(스크롤 따라 표시), 아래 이전/다음, 맨 위로 버튼. 머리말 `hide: [navigation]`, `hide: [navigation, toc]`이면 해당 칸을 숨겨 넓게(현황판·로드맵·지도 페이지).
- **FR-UI-2 테마**: 밝음/어두움 두 벌, 시스템 설정을 따르고 전환은 기억. 시스템 글꼴(외부 글꼴 없음), 따뜻한 바탕(밝음 `#fdfdf7`, 어두움 `#0d0c0a` 근처), 강조색 토큰 하나. 본문 대비 4.5:1 이상. 탭·카드·배지·표의 스타일 토큰은 `styles/`에 한 벌.
- **FR-UI-3 본문 요소**: 제목 고유 링크(¶), 코드 복사 버튼, 표는 넓으면 가로 스크롤, 이미지 최대 너비, 알림 상자(note, tip, warning, info, …), 접는 상자, 작업 목록 체크 표시.
- **FR-UI-4 한국어 앵커**: 제목 → 앵커는 GitHub 방식(소문자, 공백 `-`, 기호 제거, 한글 유지). GitLab·GitHub 화면과 같은 앵커여야 문서 사이 링크가 두 곳에서 모두 동작.
- **FR-UI-5 반응형과 모바일**: 휴대폰(폭 360~430px, 세로·가로)에서 모든 쪽을 읽고 쓸 수 있어야 합니다. `viewport` 메타, 본문 글자 16px 이상, 눌리는 곳 44×44px 이상.
    - 폭 960px 미만: 최상위 탭 줄과 탭 안 메뉴를 한 서랍 메뉴로 합침(탭 → 펼치면 그 탭의 절). 서랍은 햄버거 단추로 열고, 바깥 누르기·뒤로 가기·Esc로 닫힘.
    - 오른쪽 "이 페이지" 목차는 본문 위의 접는 상자로.
    - 표, 코드, Mermaid 그림만 각자 가로 스크롤. 본문은 가로로 밀리지 않음.
    - 머리말 `hide`로 넓힌 쪽(현황판, 로드맵, 지도)도 카드·칸이 한 줄로 쌓임.
    - 화면 위·아래 안전 여백(`env(safe-area-inset-*)`)을 고정 머리줄에 반영.
- **FR-UI-7 터치 조작 공통**: 마우스로만 되는 동작을 두지 않습니다.
    - 마우스 올리기(hover)로 보이는 것(툴팁, 이웃 강조, 진척 그림 값 읽기)은 누르기로도 보임. 다시 누르거나 바깥을 누르면 사라짐.
    - 끌어 이동·두 손가락 확대·두 번 눌러 맞춤을 모든 그림 무대(C4, 로드맵, 문서 지도, Mermaid 확대 틀)에서 지원. 무대 안 손가락 조작이 페이지 스크롤·브라우저 확대와 다투지 않도록(`touch-action`) 하고, 무대 밖에서는 평소처럼 스크롤.
    - 오른쪽 상세 패널은 좁은 화면에서 아래쪽 시트(반쯤 열림 ↔ 전체, 끌어 내려 닫기)로.
    - 휠·Ctrl+휠 확대 대신 화면의 +/−/맞춤 단추가 늘 보임.
    - Pointer Events로 마우스·터치·펜을 한 코드로 처리.
- **FR-UI-6 접근성**: 키보드로 메뉴·탭·패널 이동, 아일랜드의 주요 동작(카드 옮기기, 노드 선택)도 키보드 대안, `prefers-reduced-motion`이면 움직임 멈춤.

### 6.4 그대로 쓰는 호스트 도구

다음은 사이트 엔진과 무관하므로 현재 판의 동작·명령을 그대로 유지합니다(필요하면 내용만 옮김). 상세는 `docs-kit-context.md` §5.4, §6.5, §6.6, §6.9, §6.10, §8.

| 도구 | 바뀌는 점 |
| --- | --- |
| `kit.py` (init, status, enable, disable, profile, profiles, check, update) | 탭 목록을 `site/src/config/features.json`에서 읽음. `init`은 `mkdocs.yml` 대신 `docs-kit.yml`에 `site` 절을 씀. `migrate` 추가(§9) |
| `docs_search.py`, `docs_check.py`, `docs_ask.py` | 없음. 근거 점검 탭은 빌드 때 `docs_check.py --json`을 Python으로 실행해 결과를 읽음(§7.11). 이미지에 Python 3 포함 |
| `serve.sh`, `plan_board.py` | 없음 (보드 저장, 문서 질문) |
| `repro.sh`, `weekly_draft.py` | 없음 |
| `selftest.sh` | 새 판의 시험(§10)을 돌림 |

---

## 7. 기능 요구사항

각 FR은 **입력(파일·머리말) → 출력(페이지·부품) → 검사(경고) → 수용 기준**입니다. 데이터 형식은 현재 판과 같고, 자세한 필드 값은 `docs-kit-context.md` §6의 해당 절이 기준입니다(이 PRD와 다르면 PRD를 고침).

### 7.1 메뉴와 탭 설정 (FR-NAV)

- **FR-NAV-1** 탭 목록(17개)과 묶음(5개)은 현재 판과 같습니다.

    | id | 탭 | 종류 | 폴더 | 순위 |
    | --- | --- | --- | --- | --- |
    | history | 작업 내역 (개요 안) | 일반 | `history.md` | 1 |
    | plan | 현황판 | 기능 | `plan/` | 2 |
    | weekly | 주간 보고 | 기능 | `weekly/` | 3 |
    | roadmap | 로드맵 | 기능 | `roadmap/` | 4 |
    | graph | 문서 지도 | 기능 | `graph/` | 5 |
    | quality | 근거 점검 | 기능 | `quality/` | 6 |
    | publications | 문서함 | 기능 | `publications/` | 7 |
    | arc42 | 아키텍처 | 기능 | `arc42/` | 8 |
    | adr | ADR | 기능 | `adr/` | 9 |
    | experiments | 실험 | 기능 | `experiments/` | 10 |
    | records | 검증 기록 | 기능 | `records/` | 11 |
    | models | 모델 | 일반 | `models/` | 12 |
    | guides | 실행 가이드 | 일반 | `guides/` | 13 |
    | reference | 참고 | 일반 | `reference/` | 14 |
    | shared | 공용 파일 | 일반 | `shared/` | 15 |
    | background | 배경 | 일반 | `background/` | 16 |
    | glossary | 용어집 | 일반 | `glossary/` | 17 |

    "개요"(0), "문서 규격"(90), "문서 사이트 사용법"(91)은 늘 있습니다.
- **FR-NAV-2** `nav`가 없으면 메뉴 = 개요(README + 작업 내역) + 켠 탭(순위 순) + 문서 규격 + 사용법. 기능 탭은 그 탭 모듈이 절 내용을 정하고(예: ADR = 목록, 로그, C4, 가이드, 템플릿, ADR들 번호순), 일반 탭은 폴더의 `.md`를 README 먼저·번호 자연 정렬(g2 < g10)로.
- **FR-NAV-3** `nav`가 있으면 적힌 순서와 그룹을 따르고, 적히지 않은 켠 탭은 순위표에 맞는 자리에 끼워 넣습니다(현재 판의 `kit_nav`). 기능 탭 이름만 적고 하위를 비우면 탭 모듈이 채웁니다.
- **FR-NAV-4** 꺼진 탭: 메뉴 없음, 탭 모듈 실행 안 함, 그 탭의 키트 페이지와 프로젝트 문서는 빌드하되 메뉴 밖(링크 가능), 문서 지도에서 키트 페이지 제외. 켰는데 일반 탭 폴더에 페이지가 없으면 경고.
- **FR-NAV-5** 표시 줄 `<!-- kit-features -->`(탭 표: id, 탭, 켬/끔, 담는 것, 함께 쓰면 좋은 탭 + 묶음 표), `<!-- kit-areas -->`(분야 표).
- **수용**: 묶음 5개로 만든 빈 프로젝트가 모두 경고 0이고 탭 순서가 순위표와 같음. `kit.py enable plan roadmap weekly` + `disable glossary` 뒤 다시 경고 0, 탭이 현황판 → 주간 보고 → 로드맵 → ADR 순, 용어집 없음.

### 7.2 Markdown 호환 (FR-MD)

기존 문서를 고치지 않고 빌드하려면 현재 판(Python-Markdown + pymdownx)의 문법을 그대로 받아야 합니다. remark/rehype 플러그인으로 구현합니다.

| ID | 문법 | 예 | 결과 |
| --- | --- | --- | --- |
| FR-MD-1 | 머리말 YAML | `---\nstatus: accepted\n---` | 컬렉션 스키마로 검사 |
| FR-MD-2 | 알림 상자 | `!!! tip "제목"` + 4칸 들여쓴 본문 | `<aside class="admonition tip">` |
| FR-MD-3 | 접는 상자 | `??? info "제목"`, `???+ note` (열림) | `<details>` |
| FR-MD-4 | 내용 탭 | `=== "탭 이름"` + 4칸 본문 | 탭 부품 |
| FR-MD-5 | 끼워 넣기 | `--8<-- "arc42/a01_goals.md:rq"` (정본에 `<!-- --8<-- [start:rq] -->`…`[end:rq]`), 파일 전체 `--8<-- "path.md"`, 예시 표시 `;--8<--` | 그 부분을 끼워 넣음. 없는 파일·이름은 경고 |
| FR-MD-6 | HTML 안 Markdown | `<div class="kit-dev-only" markdown>` … `</div>` | 안쪽을 Markdown으로 |
| FR-MD-7 | 속성 | `{: .class #id}` (attr_list) | 요소에 속성 |
| FR-MD-8 | 작업 목록 | `- [ ]`, `- [x]` | 체크 표시 |
| FR-MD-9 | 수식 | `$...$`, `$$...$$` | KaTeX |
| FR-MD-10 | Mermaid | ```` ```mermaid ```` | 클라이언트 렌더 + 확대 틀(FR-CORE-4) |
| FR-MD-11 | 목록 바로잡기 | 2~3칸 하위 목록, 글 바로 아래 목록 | 현재 판 `lists.py`와 같이 4칸 단위·빈 줄로 보고 렌더(원본은 그대로). CommonMark는 2칸 중첩을 받으므로 "글 바로 아래 목록"과 "4칸 미만 코드 블록 오인"만 확인해 맞춤 |
| FR-MD-12 | 들여쓴 코드 | 4칸 들여쓴 코드 블록 | 코드 |
| FR-MD-13 | 표시 줄 | 한 줄에 단독인 `<!-- 이름 -->` 또는 `<!-- 이름: 인자 k=v -->` | 탭 모듈의 컴포넌트로 바꿈. 코드 펜스 안·문장 안은 그대로 |

- **수용**: 위 문법마다 고정 입력 → 기대 HTML 조각 시험. 현재 판을 쓰는 실제 프로젝트의 문서 전체가 경고 0으로 빌드되고, 무작위로 고른 10쪽의 본문 텍스트가 현재 판 결과와 같음(공백·태그 차이 무시).

### 7.3 공통 기능 (FR-CORE)

- **FR-CORE-1 절 참조 자동 링크**: 렌더된 본문의 `§4.3`(같은 쪽 "4.3 …" 제목 또는 첫 칸이 번호인 표 행), `11 §4`(파일 이름이 `11_`로 시작), `A5 §2`(arc42/a05_*), `G1 §6`(guides/g1_*), `R2 §1`(reference/r2_*), 페이지만 가리키는 링크 글 "08 §3.1"에 앵커를 붙임. 코드·제목·기존 링크 제외, 없는 번호는 글자 그대로.
- **FR-CORE-2 짧은 주소**: `links`의 항목마다 `/r/<name>/index.html`(리다이렉트). `to`: 문서 `.md`, `rerun:<경로>`(Rerun 뷰어 `?url=` 파일 서버 주소), `catalog:<port>[@<viewer port>]`, `port:<port>/<경로>`. 주소의 호스트는 언제나 읽는 사람이 연 호스트(클라이언트에서 채움). `<!-- short-links -->` 표(전체 주소 포함). 본문 링크 `[글](rerun:...)`, `(port:...)`, `(catalog:...)`도 같음. 이름 규칙 `^[a-z0-9][a-z0-9._-]*$`, 없는 문서는 경고.
- **FR-CORE-3 dev-only 블록**: `class="kit-dev-only"` 요소는 `site.shared_port`가 아닌 포트로 연 페이지에서만 보임.
- **FR-CORE-4 그림 확대**: Mermaid 그림마다 −/+/맞춤/100%/전체 화면, 끌어 이동, Ctrl/⌘+휠 확대(일반 휠은 페이지 스크롤).
- **FR-CORE-5 Rerun 기록 상자**: `<!-- rerun: <경로> [height=N] -->` → "뷰어 불러오기" 버튼 상자. 누르기 전 아무것도 받지 않음. 파일 서버가 답하지 않으면 `rerun.start` 명령 안내. 기본 포트 9090/9091.
- **FR-CORE-6 C4 그림 넣기**: 어느 문서에서나 `<!-- c4-view: <뷰 id> [height=N] -->` → C4 뷰어(삽입 모드). 없는 뷰는 경고.
- **FR-CORE-7 사이트 검색**: 머리줄 검색(Pagefind). 한국어 낱말 검색, 결과에 절 제목. 템플릿·생성 항목 페이지는 색인 제외.
- **FR-CORE-8 문서 규격·사용법 페이지**: 키트 `assets/docs-standard.md`, `assets/docs-kit.md`를 늘 메뉴 끝에. 사용법 페이지 내용은 새 명령(§6)에 맞게 고침.

### 7.4 ADR과 C4 (FR-ADR) — 탭 `adr`

- 입력: `docs/adr/NNNN-<영문-소문자>.md`, 제목 `# ADR-NNNN. <결정 문장>`, 머리말 필수 `status`(proposed, accepted, rejected, deprecated, superseded), `date`, `deciders`, `area`(분야 목록), `summary`; 선택 `c4`, `supersedes`, `superseded_by`, `related`. `docs/adr/c4-model.yml`(elements, relations, views; 형식은 context §6.1).
- 출력:
    - 메뉴: README(목록), log(의사결정 로그), c4(아키텍처), guide(작성 가이드), template, ADR 번호순.
    - `<!-- adr-index -->` 표(번호, 제목, 상태 배지, 분야, 날짜), `<!-- adr-log -->` 시간순 한 줄 요약, `<!-- c4-app -->` 뷰어 삽입 + "전체 화면" 단추, `<!-- c4-elements -->` 요소 표.
    - ADR 쪽마다 제목 아래 카드: 상태 배지, 날짜, 결정한 사람, 분야, 아키텍처 요소(뷰어 링크), 대체·대체됨, 관련 ADR, 검증 기록(VR이 `adr:`로 가리킴), 실험(EXP가 `adr:`로 가리킴).
    - 뷰어 페이지 `/adr/viewer/index.html` + 데이터 `/adr/viewer/data.json`(뷰마다 노드·선, 요소 상세, 관계, ADR 요약, VR).
- 뷰어 요구(아일랜드): ELK layered + 직각 선, 카드(HTML)와 선(SVG)을 한 무대에서 이동·확대; 카드 클릭 → 오른쪽 패널(설명, 기술, 관련 결정 카드, 보내는/받는 관계, 검증 기록); 더블클릭 → 하위 그림(드릴다운); 마우스 올리면 연결된 것만 강조(관계 종류 flow 실선·alt 점선·call 짧은 점선 양방향, 종류별 강조색); 결정 필터; 결정 카드 탭; 범례; 밝음/어두움; 주소 `#view=<id>&el=<id>`, `#tab=decisions&adr=<n>`; `?embed=1`이면 페이지 테마를 따르고 자체 전환 단추 숨김; 다른 팀·외부 요소는 점선 테두리·채움 없음; 상위 그림에서는 하위 요소 관계를 상위 요소 관계로 합침; `include`에서 빠진 형제 중 관계 있는 것은 흰 점선 상자; `outside: elements`면 바깥 요소를 합치지 않음.
- 모바일(FR-UI-7): 누르기 = 선택(패널), 두 번 누르기 = 안으로 들어가기, 길게 누르기 = 연결 강조. 결정 필터·그림 탭은 좁은 화면에서 위쪽 접는 줄로.
- 검사(경고): 머리말 누락·모르는 값, 번호 중복, 파일·제목 번호 불일치, 없는 C4 요소·뷰, 모르는 관계 종류, `superseded`인데 `superseded_by` 없음.
- **수용**: 고정 입력 ADR 3개 + C4 모델로 목록·로그·카드·뷰어 데이터가 기대값과 같음. 뷰어에서 컨텍스트 → 컨테이너 드릴다운, 결정 필터, 주소 공유가 동작(브라우저 시험).

### 7.5 arc42 (FR-A42) — 탭 `arc42`

- 입력: `docs/arc42/aNN_<이름>.md` 12개, 제목 `# A<N>. <제목>`, 머리말 `arc42`, `status`(empty, partial, stable, n/a), `owner`, `reviewed`, 선택 `c4_views`, `summary`.
- 출력: 메뉴(README, template, 섹션 순, 그 밖의 `docs/arc42/*.md`), `<!-- arc42-index -->`(섹션, 제목, 담는 것(규격 요약), 지금 들어 있는 것(`summary`), 상태, 담당, 확인일, C4 뷰), 섹션 카드(상태, 담당, 확인일, 담는 것).
- 검사: 빠진 섹션, 번호 불일치, 상태 값, owner·reviewed 누락, 없는 C4 뷰.

### 7.6 발행물 (FR-PUB) — 탭 `publications`

- 입력: `docs/publications/NNNN-*.md`, `# P-NNNN.`, 머리말 `kind`(overview, report, release, note, slides), `audience`, `date`, `status`(draft, published, archived), `based_on`(`A1`, `ADR-0004`, `VR-0002`, `EXP-0001`, `MC-0001`, `G2`, `R1`), 스냅숏이면 `commit`.
- 출력: 메뉴, `<!-- pub-index -->`, 카드(종류, 독자, 날짜, 상태, 근거 링크, overview가 아니면 "이 날짜·커밋의 스냅숏" 안내).
- 검사: 머리말, 번호, 없는 `based_on`, 커밋 없는 발행 스냅숏.

### 7.7 실험 (FR-EXP) — 탭 `experiments`

- 입력: `docs/experiments/NNNN-*.md`, `# EXP-NNNN.`, 머리말 `status`(planned, running, done, stopped), `started`, `by`, `area`, `question`, 선택 `adr`, `issues`.
- 출력: 메뉴(실험 목록 `list.md` `<!-- exp-index -->`, README = 프로젝트의 실험 계획, template, EXP들), 카드, ADR 카드의 "실험" 줄. 이슈 번호는 `issues_url`로 링크.
- 검사: 머리말, 번호, 없는 ADR.

### 7.8 검증 기록 (FR-VR) — 탭 `records`

- 입력: `docs/records/NNNN-*.md`, `# VR-NNNN.`, 머리말 필수 `result`(pass, partial, fail), `date`, `by`, `area`, `subject`; 선택 `host`, `commit`, `adr`, `guide`, `c4`, `supersedes`. 증거 `docs/records/assets/VR-NNNN/`(재현 `repro.sh` + `expected.txt`).
- 출력: 메뉴(README, template, VR들), `<!-- vr-index -->`, 결과 카드(배지, 날짜, 장비, 커밋, 절차, ADR, C4 요소, 재현 파일 링크, 대체/대체됨 — 대체됨은 다른 VR의 `supersedes`에서 계산), ADR 카드의 "검증 기록", C4 뷰어 데이터의 요소·ADR별 VR. 증거 파일은 사이트에 정적 파일로 실음.
- 검사: 머리말·값, 번호, 없는 ADR·VR, 재현 파일 누락.

### 7.9 주간 보고 (FR-WK) — 탭 `weekly`

- 입력: `docs/weekly/YYYY-MM-DD.md`, `# YYYY-MM-DD 주간 보고`, 머리말 `date`, `from`, `status`(draft, published), `by`, 선택 `meeting`, 발행이면 `commit`. 본문 `## 3. 업무별 진행` 아래 `### 3.N <업무 이름>`마다 `- **배경**:`, `- **한 일**:`, `- **결과**:`, `- **다음**:`, 선택 `- **막힌 것**:`.
- 출력: 메뉴(README `<!-- weekly-index -->`, threads `<!-- weekly-threads -->`, template, 보고 최신순), 탭을 켜면 보고가 없어도 탭이 보임. 업무별 흐름: 업무 이름마다 모든 보고의 한 일·결과·막힌 것을 최신순으로, 보고의 해당 절 링크. 카드(기간, 상태, 작성, 회의, 커밋, 앞뒤 보고). 보고 쪽 안의 `#12`, `!27`, `VR-0004`·`ADR-0011`·`EXP-0001`·`P-0001` 자동 링크(코드·제목·기존 링크 제외).
- 검사: 머리말, 파일 이름 = 날짜, 제목, `from` = 지난 보고 날짜, 발행인데 commit 없음, 업무 절의 빠진 항목.

### 7.10 로드맵 (FR-RM) — 탭 `roadmap`

- 입력: `docs/roadmap/roadmap.yml`(`title`, `tracks`, `units`, `items`; 형식 context §6.7).
- 출력: 메뉴(README, guide). `<!-- roadmap-map -->` 노선도 뷰어 삽입 + 전체 화면, `<!-- roadmap-units -->` 업무별 흐름, `<!-- roadmap-table -->` 모든 항목. 항목마다 `/roadmap/items/<id>.html`(메뉴 밖: 카드, 요약, 앞뒤, 관련 문서 제목과 링크, 같은 업무의 다른 항목). 뷰어 데이터 `/roadmap/viewer/data.json`.
- 노선도 규칙: 열 = 완료 항목이 있는 주(월요일)마다 한 칸, 그다음 지금(doing)·다음(next)·그다음(later)·나중(future). 세로 = 트랙(위→아래). 같은 트랙 앞뒤 굵은 실선, 다른 트랙에서 이어짐 점선, 여러 트랙에서 들어오거나 여러 트랙에 걸친 항목은 합류(고리). 상태별 모양: done 채운 상자 ✓, doing 굵은 테두리, next 점선, later·future 점선 흐리게, dropped 회색 취소선.
- 뷰어(아일랜드): 역 클릭 → 패널(상태, 요약, 앞뒤, 관련 문서를 종류별 묶음: 결정, 검증 기록, 실험, 실행 가이드·참고, 아키텍처·배경, 문서함, 이슈·MR, 그 밖), 마우스 → 앞뒤 사슬 강조, 업무·상태·글자 거르기, `#item=<id>`, 페이지 테마 따름.
- 모바일: 노선도는 가로 스크롤 + 두 손가락 확대, 처음 열 때 "지금" 칸이 보이게 위치. 역 누르기 → 아래쪽 시트. 거르기는 접는 줄로.
- `refs` 풀이: `ADR-/VR-/EXP-/P-NNNN`, `G<N>`, `R<N>`, `A<N>`(+ ` §x.y`), `배경 NN`, `"#N"`, `"!N"`, docs 경로(`#앵커` 포함), URL.
- 검사: 없는 트랙·업무·앞 항목, 이웃하지 않은 트랙, 순환, 날짜 없는 완료, 모르는 상태, 중복 id, 풀리지 않는 참조.

### 7.11 근거 점검 (FR-QA) — 탭 `quality`

- 입력: `docs/quality/config.json`, `questions.json`, `history.json`, `incidents.json`(형식 context §6.10). 계산은 `bin/docs_check.py --json`(Python, 표준 라이브러리)이 하고, 빌드 모듈은 결과를 읽어 그립니다. 결과는 `build/quality/report.json`에 캐시(문서·코드·설정의 변경 표식이 같으면 다시 계산하지 않음, 미리보기에서 오래 살아도 매번 새 결과).
- 출력: 메뉴(근거 점검, 문서 지도 뒤). 표시 줄 `quality-summary`(근거 있음 비율, 틀림·확인 못 함·낡음 수, 검색 평가 요약 카드), `quality-trend`(날짜별 추이 그림), `quality-tasks`(살아 있는 문서에서 고칠 것, 낡은 근거, 확인할 것, 고치지 않는 기록으로 묶음), `quality-docs`(문서별, 문제 많은 순), `quality-kinds`(주장 종류별: 무엇을 재나, 고치는 법), `quality-retrieval`(BM25·하이브리드별 hit@1, recall@5, MRR, 질문별 순위, 임베딩 서버가 없으면 안내 `embed_start`), `quality-incidents`(사례 표).
- 수용: 고정 입력에서 없는 `ADR-0999` 인용이 "틀림"으로, 검색 평가 표가 나옴.

### 7.12 문서 지도 (FR-MAP) — 탭 `graph`

- 입력: 빌드된 모든 페이지(템플릿, 로드맵 항목 페이지, 꺼진 탭의 키트 페이지 제외), 머리말 관계, `docs/graph/topics.yml`, 로드맵 `tracks`·`refs`, `docs/quality/config.json`의 `ask`.
- 계산(빌드 모듈, 단위 시험):
    - 선: 본문 링크(렌더된 HTML 기준, 자동 링크 포함, 방향), 머리말 관계(VR `adr`·`guide`·`supersedes`, ADR `related`·`supersedes`, EXP `adr`, 발행물 `based_on`), 비슷한 내용(0.55 × TF-IDF 코사인(한국어 조사·어미·불용어 제거) + 0.30 × 서지 결합(드문 대상 가중) + 0.15 × 같은 C4 요소(드문 요소 가중), 문서마다 상위 3개, 링크·관계 없는 쌍만, 이유 목록 보관).
    - 주제: 로드맵 트랙 + `common`, 문서마다 최대 2개. 머리말 `topics` → `topics.yml` → 로드맵 `refs`의 트랙 → 이웃에서 추정(추정 표시, 엇갈리면 common).
    - 종류: 아키텍처, 결정, 검증, 실험, 발행물·보고, 가이드·참고, 배경·용어, 목록·안내.
- 출력: `/graph/index.html`(`<!-- graph-map -->` 삽입) + 전체 화면 뷰어 + 데이터 `/graph/viewer/data.json`.
- 뷰어(아일랜드, 캔버스, 힘 배치): 밤하늘 모양(점 + 은은한 빛, 선은 빛줄기, 별 배경), 종류 색, 연결 수에 따른 크기, 목록·안내 처음 숨김; 끌기·이동·확대, 마우스 이웃 강조, 겹치지 않는 이름표; 클릭 → 패널(요약, 관계, 양방향 링크, 비슷한 문서와 이유, 문서 열기); 주변만 1~3단계; 모으기(주제/링크만/종류), 색(주제/종류/분야), 주제 칩 켜고 끄기, 찾기, `#doc=<경로>`; 주제마다 고리 위 자리(서로 링크 많은 주제끼리 이웃), 주제 색 성운과 이름; 선택 없을 때 **점검**(연결 없는 문서, 추정 주제, 링크가 주로 다른 주제로 가는 문서, 링크할 쌍); 처음 열 때 가운데서 퍼지는 움직임, 숨은 탭·움직임 줄이기에서 멈춤.
- 모바일: 손가락 끌기는 지도 이동, 문서 점은 누르기로 선택(누르는 범위는 점보다 넓게 24px 이상), 길게 누르고 끌면 그 점 옮기기. 이름표는 확대 정도에 따라 줄임. 별 배경·빛 효과는 낮은 성능 기기에서 줄임(프레임이 30fps 아래로 떨어지면 끔).
- **질문 칸**: 개발 미리보기 포트(`ask.from_ports`)에서 열었을 때만 켜짐. `POST http://<같은 호스트>:<ask.port>/api/ask {q, k}`(질문 서버 `bin/serve.sh ask`), 응답의 답(문장별 판정 ✓ 근거 있음 / ? 확인 못 함 / ✗ 근거 없음)과 근거(경로·줄)를 패널에, 인용 문서를 가운데로 모으고 순위 배지, `[n]` 클릭 → 근거, "에이전트에게 묻기"(질문 + 근거 목록 복사), `#ask=<질문>`. 서버가 꺼져 있으면 `ask.start` 안내.

### 7.13 현황판과 스프린트 (FR-PLAN) — 탭 `plan`

- 입력: `docs/plan/scope.yml`, `risks.yml`, `sprints.json`, 선택 `issues.json`, 로드맵(상태·날짜). 형식 context §6.9. 원천 파일은 사이트에 싣지 않음.
- 계산(빌드 모듈, 단위 시험): 항목 트리(평평한 목록 + `parent`), 상태(로드맵 → 이슈 스냅숏 → `status`), 날짜별 작업량 띠(최소~최대, `added`/`removed`), 끝낸 양(폭은 가운데 값), 주별 처리량, 예측(낙관·기준·비관 = 처리량 높음·평균·낮음, 비관은 남은 양 +50%, 6주 미만 신뢰 낮음), 지금 시기 / 전체, 단계별 통과 기준 집계, 연구 질문 상태, 계획 변경 기록(기준선별), 리스크 점수(p×i)·등급(bands)·추이, 스프린트 약속·끝냄·이월·속도, 카드별 근거 일치("근거 필요", "완료됨 MM-DD").
- 출력(표시 줄): `plan-summary`, `plan-burnup`(두 탭, 마우스 읽기), `plan-sprint-now`, `plan-stages`(단계 칸 띠, "ID 읽는 법"(`legend`), 단계별 접는 상자: 통과 기준 + Feature > Story > Backlog > WBS 트리, 완료 정의·크기·상태·추가/뺌; 찾기·상태·시기 거르기, 모두 펼치기), `plan-questions`(관련 항목 → 트리에서 펼침), `plan-changes`, `risk-summary`(등급 카드 → 대장 거름), `risk-matrix`(5×5 PI, 등급 색, 칸 → 대장 거름), `risk-top`, `risk-trend`, `risk-register`(어느 쪽에서나: 찾기, 분류·상태·등급 거르기, 열 정렬, ID 툴팁 원인 → 영향·대응·점수, ▲▼ 점수 이력), `plan-sprints`(기록 표, 속도 그림). `#ep-<id>`, `#r01` 링크는 대상을 열어 보여 줌. 상호작용이 없어도 내용은 다 읽힘(점진 향상).
- 스프린트 보드(`/plan/board/index.html`, 아일랜드): 카드 = Backlog + Backlog 밖 WBS(아래 WBS는 하위 작업); 왼쪽 백로그(찾기, 단계·시기 거르기, 단계 색), 칸 할 일·진행 중·검토·완료; 끌어 놓기와 카드 패널(키보드 Enter); WIP 한도 초과 칸 빨강; 막힘 이유; 목표; 다음 스프린트 만들기·시작·마감(끝나지 않은 카드는 같은 칸·막힘 그대로 다음 스프린트로 이월, `carried` 기록, 계획 스프린트가 있으면 합침); 회고 세 줄; ◀▶와 약속·끝냄 막대로 지난 스프린트; 단계별 가로줄(접기) / 하나로; 저장 = 미리보기 포트에서 연 보드만 `POST /api/sprints`(`bin/plan_board.py`, `save.port`), 그 밖은 보기 전용 안내 + 내보내기(JSON 복사).
- 모바일: 진척 그림은 누르고 끌면 그날 값. 단계 트리·리스크 대장 거르기는 접는 줄, 리스크 대장은 좁은 화면에서 표 대신 카드 목록(ID, 제목, 점수 배지, 상태)으로. PI 매트릭스 칸은 누르면 거름. 스프린트 보드는 좁은 화면에서 칸 하나씩 넘겨 보기(칸 이름 탭 + 손가락으로 옆으로 넘김), 백로그는 별도 탭. 카드 옮기기는 끌기 대신 카드 누르기 → 패널의 칸 단추(끌기는 길게 누른 뒤에만 시작해 스크롤과 구분). WIP 초과·막힘 표시는 칸 이름 탭에도.
- 검사: 모르는 키(따옴표 없는 쉼표), 없는 부모·로드맵 항목·이슈, 순환, 크기 위 크기, 크기 없는 잎, 완료 정의 없는 백로그·WBS, 날짜 없는 완료, 점수 범위 밖, 모르는 리스크 상태, 스프린트의 모르는 카드·칸, 겹친 기간, 진행 중 둘 이상.
- **수용**: 고정 입력(Epic 1, WBS 2, 질문 1, 리스크 R01 p4·i5, 스프린트 1)에서 R01이 PI 매트릭스 점수 20 칸, 진척 그림과 속도 그림, 보드 데이터에 카드 W1.

### 7.14 일반 탭 (FR-PAGE) — `history`, `guides`, `reference`, `shared`, `background`, `glossary`, `models`

- 메뉴만 만듭니다(FR-NAV-2). 형식은 문서 규격(가이드 `gN_*` `# G<N>.`, 참고 `rN_*` `# R<N>.`, 배경 `NN_*` `# NN.`, 작업 내역 표, 공용 파일 표). 시작 파일은 `template/features/<id>/`.

---

## 8. 비기능 요구사항

| ID | 요구 | 기준 |
| --- | --- | --- |
| NFR-1 오프라인 | 빌드·미리보기·열람에 외부 네트워크가 필요 없음 | 빌드 결과 HTML·JS·CSS에 `http(s)://`로 시작하는 스크립트·스타일·글꼴 0. 이미지 빌드 뒤 네트워크를 끊고 빌드·열람 성공 |
| NFR-2 원격 측정 없음 | Astro·도구의 사용 통계 끔 | 이미지 환경 변수와 설정으로 고정, 시험에서 바깥 요청 0 |
| NFR-3 빌드 시간 | 문서 300개 기준 | 전체 빌드 60초 이내, 미리보기 다시 그림 2초 이내(문서 하나 수정) |
| NFR-4 크기 | 일반 문서 쪽의 JS | 아일랜드 없는 쪽은 Mermaid·검색 제외 30 KB 이하(gzip). 뷰어는 열 때만 받음 |
| NFR-5 재현성 | 같은 입력 → 같은 출력 | 의존성 잠금 파일, 고정 이미지 태그·다이제스트, 빌드 시각 외 출력 동일 |
| NFR-6 보안 | 보조 서버 | 보드·질문 서버는 미리보기 포트 Origin만 받음, 127.0.0.1 모델 서버만 호출. 사이트는 정적 |
| NFR-7 호스트 | 호스트 설치 최소 | Docker, git, Python 3.8+만. Node는 이미지 안 |
| NFR-8 언어 | 화면 한국어 | 날짜 `YYYY-MM-DD`, 화면 낱말은 현재 판과 같게(작업량, 폭, 시기, 근거 필요 등) |
| NFR-9 모바일 성능 | 중급 휴대폰 | 문서 쪽 첫 화면 2초 이내(사내 Wi-Fi), 뷰어 조작 중 50fps 이상 목표, 문서 지도 노드 300개에서 30fps 이상 |

## 9. 호환과 이전

| ID | 요구 |
| --- | --- |
| MIG-1 | 프로젝트 `docs/` 형식(파일 이름, 머리말, 데이터 파일, 표시 줄)은 바뀌지 않음 |
| MIG-2 | 주소 유지: 같은 문서는 같은 `/경로.html`, 폴더 README는 `/폴더/index.html`, 뷰어는 같은 경로(`adr/viewer/`, `roadmap/viewer/`, `graph/viewer/`, `plan/board/`), 짧은 주소 `/r/<name>/`. 뷰어 데이터 파일 이름만 바뀌면(`data.js` → `data.json`) 내부 경로라 무방 |
| MIG-3 | `kit.py migrate`: `mkdocs.yml`의 `site_name`, `theme.icon.logo`, `extra.issues_url`, `extra.links`(`shared_port`, `short`), `extra.rerun`, `nav`를 `docs-kit.yml`의 `site`, `links`, `rerun`, `nav`로 옮기고 `mkdocs.yml`은 지우지 않고 사용자에게 알림. 다시 실행해도 같은 결과 |
| MIG-4 | 빌드 결과 비교 도구(시험용): 현재 판과 새 판의 사이트에서 페이지 목록, 각 쪽의 제목·절 앵커·링크 대상을 비교해 차이를 보고 |
| MIG-5 | 프로젝트 쪽 배포 스크립트가 쓰는 결과 위치 `build/site/`와 명령 `docs.sh build`가 그대로 |

## 10. 시험과 수용

| 층 | 무엇을 | 도구 |
| --- | --- | --- |
| 단위 | 탭 빌드 모듈(관계, 예측, 노선도 배치, 지도 유사도·주제, 리스크 점수), 설정 읽기, remark/rehype 플러그인(문법별 고정 입력 → 기대 출력) | Node 시험 러너(이미지 안) |
| 통합 | 고정 프로젝트(현재 판 selftest와 같은 내용: 주간 보고 2개, 합류하는 로드맵, scope·질문·스프린트·리스크, 없는 ADR-0999 인용, 2칸 목록)를 `all` 묶음으로 빌드 → 경고 0, 산출물 목록, 내용 검사 | `bin/selftest.sh` |
| 묶음 | 묶음 5개 빈 프로젝트 경고 0, 탭 순서; minimal에서 enable/disable 뒤 경고 0 | `bin/selftest.sh` |
| 브라우저 | 뷰어 4개와 현황판 상호작용(드릴다운, 필터, 노드 선택, 카드 이동, 보드 저장 요청 모의), 밝음/어두움 |
| 모바일 | 휴대폰 화면 흉내(390×844, 터치, 세로·가로)로 모든 쪽 가로 넘침 0, 서랍 메뉴 열고 닫기, 각 뷰어의 누르기·끌기·두 손가락 확대·아래쪽 시트, 보드의 칸 넘기기와 패널로 카드 옮기기, 진척 그림 누르기 값, 눌리는 곳 크기 44px 검사. M7에서 실제 휴대폰(안드로이드 크롬, iOS 사파리) 각 1대로 손 확인 | 이미지 안 헤드리스 브라우저 (시험 전용 이미지 단계에 두어 기본 이미지를 가볍게) |
| 오프라인 | 네트워크 없는 컨테이너에서 빌드·브라우저 시험, 외부 요청 0 | `--network none` |
| 실제 프로젝트 | 현재 판을 쓰는 프로젝트 하나를 새 판으로 빌드, MIG-4 비교에서 페이지·앵커 차이 0(의도한 차이는 목록으로) | 수동 + 비교 도구 |

`bin/selftest.sh`의 마지막 줄은 `selftest OK (<N> pages)`, 하나라도 어긋나면 실패 목록과 함께 종료 코드 1.

## 11. 구현 순서 (마일스톤)

각 단계는 앞 단계의 수용 기준을 통과한 뒤 시작합니다. 단계마다 키트 `CHANGELOG.md`에 항목, 큰 선택은 ADR(키트를 쓰는 프로젝트의 ADR 또는 키트 안 기록)로 남깁니다.

| 단계 | 만들 것 | 끝 기준 |
| --- | --- | --- |
| M0 결정 | Astro·Node 버전, 아일랜드 방식(바닐라/Preact), 검색(Pagefind), 문서 밖 읽기 방식(§12 Q1~Q4) 확인·기록 | 결정 기록, 버전 근거(공식 릴리스 태그·날짜) |
| M1 뼈대 | `site/` Astro 프로젝트, Docker 이미지, `docs.sh`(start/stop/status/logs/serve/build), 설정 모듈, `features.json`, 문서 읽기(프로젝트 + 키트 겹치기), 주소 규칙, 레이아웃·테마·탭 메뉴, 경고 수집기 | 빈 프로젝트(README 하나)가 빌드·미리보기, 다시 그림 2초 |
| M2 Markdown | FR-MD 전부, FR-CORE-1~5, 수식·Mermaid·코드, 검색, 반응형 레이아웃(FR-UI-5)과 공통 터치 부품(FR-UI-7: 그림 무대, 아래쪽 시트, 누르기 툴팁) | 문법별 시험 통과, 외부 요청 0, 모바일 시험(가로 넘침 0, 서랍 메뉴) |
| M3 탭 설정 | FR-NAV, `kit.py`를 `features.json`·`docs-kit.yml site`에 맞춤, `init`·`migrate`, 일반 탭 | 묶음 5개 경고 0, 탭 순서 |
| M4 기록 탭 | ADR(+ C4 뷰어), records, experiments, arc42, publications | 카드·목록·역링크·검사, C4 뷰어 브라우저 시험 |
| M5 진행 탭 | weekly, roadmap(+ 뷰어·항목 페이지), plan(+ 상호작용·보드) | 고정 입력 수용 기준, 보드 저장(미리보기 포트만) |
| M6 근거·지도 | quality(docs_check 연동, 캐시), graph(+ 뷰어, 점검, 질문 칸) | ADR-0999 틀림, 지도 데이터·뷰어 시험 |
| M7 이전·검증 | MIG-1~5, 실제 프로젝트 비교, NFR 측정 | 비교 차이 0(또는 승인된 목록), NFR 표 기준 충족 |
| M8 문서 | 사용법 페이지, README 지시문·AGENTS-GUIDE·AGENTS 템플릿을 새 명령으로, `docs-kit-context.md`를 새 판 명세로 갱신, 이 PRD 상태를 "구현됨"으로 | 문서 안 명령이 모두 실제로 동작(근거 점검 option 검사 통과) |

전환 방법: 새 판이 M7을 통과할 때까지 현재 판(MkDocs)을 기본으로 두고, 새 판은 `docs.sh`의 선택(예: `DOCS_ENGINE=astro`)이나 별도 브랜치에서 시험합니다. M7 뒤 기본을 바꾸고 메이저 버전을 올립니다(CHANGELOG에 이전 안내).

## 12. 열린 질문 (M0에서 정함)

| # | 질문 | 선택지 | 제안 |
| --- | --- | --- | --- |
| Q1 | Astro 콘텐츠 로더가 Astro 프로젝트 밖(`DOCS_ROOT/docs`)을 읽고 미리보기에서 변경을 감시하는가 | glob 로더 + 절대 경로 / 사용자 정의 로더(파일 읽기 + 감시) / 빌드 전에 `docs/`를 작업 폴더로 동기화 | 먼저 glob 로더로 시험하고, 감시가 안 되면 사용자 정의 로더 (확인하지 않음) |
| Q2 | Starlight(Astro 문서 테마)를 쓸 것인가 | Starlight 위에 확장 / 직접 레이아웃 | 직접 레이아웃: 최상위 탭 줄, 전체 폭 대시보드, 프로젝트 덮어쓰기 규칙을 맞추기 쉬움. Starlight의 검색·접근성 구현은 참고 |
| Q3 | 아일랜드 구현 방식 | 바닐라 TS / Preact / Svelte | 바닐라 기본, 보드·지도만 Preact 허용(번들 크기 측정 뒤) |
| Q4 | 근거 점검을 Python 그대로 쓸 것인가 | Python 실행 결과 읽기 / TS로 다시 씀 | Python 그대로: 에이전트가 호스트에서 같은 도구를 쓰므로 한 구현 유지 |
| Q5 | 경고를 빌드 실패로 할 것인가 | 기본 경고 출력 / 기본 strict | 기본 출력(현재 판과 같음), 배포 검증에서 `--strict` |
| Q6 | 사이트 검색의 한국어 품질 | Pagefind 기본 / 낱말 쪼개기 보강 | Pagefind로 시작, 검색 평가 질문 몇 개로 확인 |
| Q7 | 휴대폰에서 공유 사이트를 어떻게 여는가 | 사내 Wi-Fi·VPN만 / 그 밖 | 사내망 주소라 사내 Wi-Fi·VPN이 필요(키트 범위 밖, 프로젝트 배포에서 정함) |

## 13. 용어

| 용어 | 뜻 |
| --- | --- |
| 키트 | docs-kit 저장소. 프로젝트에 `.docs-kit/` 서브모듈 |
| 탭 (feature) | 최상위 메뉴 하나와 그 자동화. `docs-kit.yml`에서 켜고 끔 |
| 묶음 (profile) | 처음 켜는 탭의 모음 |
| 표시 줄 | 문서에 한 줄로 쓰는 `<!-- 이름 -->`. 빌드 때 표·그림으로 바뀜 |
| 카드 | 기록 문서 제목 아래 머리말 요약 상자 |
| 정본 | 사실과 결정을 두는 문서(arc42, ADR, EXP, VR, MC) |
| 아일랜드 | 정적 페이지 안에서 브라우저 JS로 동작하는 부분(뷰어, 보드) |
| 미리보기 / 공유 사이트 | 작성자용 서버(보통 8001, 보드 저장·질문 가능) / 팀이 보는 정적 사이트(8000, 읽기 전용) |
