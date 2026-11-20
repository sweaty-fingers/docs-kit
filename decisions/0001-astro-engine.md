# 0001. 사이트 엔진을 Astro 직접 레이아웃으로 만든다 (M0 결정)

- 날짜: 2026-11-20
- 상태: 승인 (사용자 승인: "astro 직접 레이아웃으로 가자")
- 관련: [prd.md](../prd.md) §6, §11 M0, §12 Q1~Q7

## 1. 배경

prd.md는 MkDocs Material + 훅으로 된 docs-kit 0.15를 Astro로 다시 만들라고 정합니다. 문서 형식, 탭, 호스트 도구, 에이전트 운영은 그대로 둡니다. M0에서는 구현에 들어가기 전에 열린 질문(§12)과 버전을 정합니다.

## 2. 결정

| # | 질문 | 결정 | 근거 |
| --- | --- | --- | --- |
| Q2 | Starlight를 쓸 것인가 | **쓰지 않음. Astro 위에 직접 레이아웃** | Starlight는 머리말 `title`이 필수이고 제목을 따로 그립니다. 문서는 본문 `# ADR-0001. ...`로 제목을 쓰므로 모든 문서를 고치거나 제목이 두 번 나옵니다(MIG-1 위반). `README.md` → `index.html`과 `.html` 주소(FR-ARC-4), 키트 `assets/`와 프로젝트 `docs/`를 겹치는 규칙(FR-ARC-1), 최상위 탭 줄과 모바일 서랍(FR-UI-1/5)은 모두 Starlight 기본 구조를 덮어써야 합니다. 이 저장소를 쓰던 robot-manipulation 사이트도 탭 줄과 사이드바를 이미 덮어쓰고 있었습니다. 검색(Pagefind), GitHub식 앵커, 접근성은 같은 라이브러리를 직접 써서 얻습니다 |
| Q1 | 프로젝트 밖 `docs/`를 어떻게 읽고 감시하나 | **콘텐츠 컬렉션 대신 키트 모듈(`site/src/lib/site.ts`)이 파일 시스템에서 직접 읽음.** 개발 서버는 통합(`site/src/integration.ts`)이 `docs/`, `docs-kit.yml`, 키트 `assets/`를 감시하고 페이지를 다시 그림 | 겹치기(같은 경로면 프로젝트 우선), README 매핑, 탭별 계산을 한곳에서 하려면 직접 읽는 편이 단순합니다. 렌더 결과는 파일 수정 시각으로 캐시합니다. 시험: 문서 수정과 새 페이지 추가가 다음 요청(약 0.2초)에 반영됨. 머리말 형식 검사는 탭 모듈(M4~)에서 zod 스키마로 합니다 |
| Q3 | 아일랜드 구현 | **의존성 없는 JavaScript**(`site/public/_kit/kit.js`). 보드·지도에 Preact를 쓸지는 M5·M6에서 번들 크기를 재고 정함 | 1차(공통 화면)는 작은 스크립트 하나로 충분합니다 |
| Q4 | 근거 점검을 Python 그대로 쓸 것인가 | **Python 그대로**(`bin/docs_check.py --json`을 빌드 때 실행, M6) | prd.md 제안과 같음 |
| Q5 | 경고를 빌드 실패로 할 것인가 | **기본은 출력만, `docs.sh build --strict`(또는 `DOCS_STRICT=1`)이면 실패** | prd.md 제안과 같음 |
| Q6 | 사이트 검색 한국어 품질 | **Pagefind로 시작**(`forceLanguage: ko`) | 검색 평가는 M6에서 |
| Q7 | 휴대폰에서 공유 사이트를 어떻게 여나 | 키트 범위 밖(프로젝트 배포) | |

### 2.1 버전 (2026-11-20 확인)

| 항목 | 고정한 것 | 근거 |
| --- | --- | --- |
| Astro | 7.4.13 (`site/package-lock.json`) | npm 최신 안정판(2026-11-18). 7.4.x 안에서 갱신 |
| Node | 24 LTS(Docker 이미지 `node:24-bookworm-slim`), 호스트 실행은 22.18 이상 | 시험한 판(호스트 v24.3.0). 26 LTS도 나왔지만 이 판으로 시험하지 않음 |
| Mermaid | 11.4.1 | 0.15에서 이미 내장한 파일을 그대로 씀(`assets/_kit/vendor/README.txt`의 sha256). 12.x는 시험 뒤 올림 |
| KaTeX | 0.19.1 | 빌드 때 그림(`rehype-katex`), CSS·글꼴은 사이트에 실음 |
| Pagefind | 1.6.0 | |
| Shiki | 4.6.0 | 코드 강조, 밝음·어두움 두 벌 |

### 2.2 prd.md와 다르게 한 것

| 항목 | prd.md | 이 구현 | 이유 |
| --- | --- | --- | --- |
| 수식 | KaTeX (같음) | 같음 | MkDocs 판의 MathJax 대신. `$...$`, `$$...$$` 문법은 같음 |
| 콘텐츠 읽기 | 콘텐츠 컬렉션 로더 | 키트 모듈이 직접 읽음 | Q1 |
| `docs-kit.yml` | §5의 키 | `site.base`, `site.url`, `site.extra_css`, `site.extra_js` 추가 | 하위 경로 배포(GitHub Pages 프로젝트 사이트)와 프로젝트별 스타일. 비우면 지금과 같음 |
| 실행 방식 | Docker 이미지 | Docker(기본) 또는 호스트 Node(`DOCS_RUNNER=host`) | 배포 환경이 프로젝트마다 다름(사용자 요구). CI에서는 호스트 Node가 단순함 |
| 주소 만들기 | `build.format: 'file'` + README 매핑 | 같음. README 쪽(`a.html`)은 빌드 뒤 `a/index.html`로 옮김 | Astro는 경로 끝 `index`를 특별히 다뤄 `a/index.html`을 바로 만들지 못함(시험함) |

## 3. 결과

- 좋아지는 점: 화면이 컴포넌트(`site/src/layouts`, `site/src/components`)로 나뉘고, 계산은 TypeScript 모듈과 단위 시험(`site/tests`)으로 갑니다.
- 감수할 점: 탭 모듈(ADR, 기록, 진행, 근거·지도)은 M4~M6에서 다시 만들어야 합니다. 그 전까지 그 탭의 표시 줄은 "M4~M6에서 만들어짐" 안내 상자로 보입니다. Docker 실행은 이 환경에 데몬이 없어 시험하지 못했습니다.
- 재검토 조건: Starlight가 본문 H1 제목과 겹치기 로더를 지원하게 되면 다시 봅니다.
