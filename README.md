# docs-kit

프로젝트 문서를 **같은 규격**으로 쓰고 웹으로 보기 위한 공통 키트입니다. 각 프로젝트에 git 서브모듈(`.docs-kit/`)로 넣어 쓰고, 에이전트(Claude Code, Codex 등)가 이 키트의 규칙대로 문서를 쓰고 관리합니다.

- 키트에는 **구조, 템플릿, 예시 페이지, 자동화(훅·뷰어·도구)**만 있습니다. 내용은 프로젝트가 채웁니다.
- 모든 탭(현황판, 주간 보고, 로드맵, 문서 지도, 근거 점검, 문서함, 아키텍처, ADR, 실험, 검증 기록, 모델, 실행 가이드, 참고, 공용 파일, 배경, 용어집, 작업 내역)을 갖고 있고, 프로젝트는 **쓸 탭만 켭니다**(`docs-kit.yml`, `bin/kit.py`).
- 프로젝트를 하면서 형식을 고치면 이 저장소에 반영하고 push합니다. 다른 프로젝트는 `bin/kit.py update`로 최신 키트를 받습니다.

| 문서 | 누가 읽나 | 내용 |
| --- | --- | --- |
| 이 README | 사람 | 에이전트에게 줄 지시문(§1), 직접 세우는 법, 구조 |
| [AGENTS-GUIDE.md](AGENTS-GUIDE.md) | 에이전트 | 세우기·들이기 절차, 묻기, 제안서 형식, AGENTS.md에 넣을 것, 운영 중 요청 |
| [template/agents/AGENTS.docs-kit.md](template/agents/AGENTS.docs-kit.md) | 에이전트 | 프로젝트 AGENTS.md에 넣을 "문서 관리 (docs-kit)" 절 |
| [docs-kit-context.md](docs-kit-context.md) | 에이전트 | 키트의 전체 명세(사이트 조립, 탭별 형식, 도구, 시험). 엔진 코드 구조와 검증 결과는 [site/README.md](site/README.md), 결정은 [decisions/](decisions/) |
| [prd.md](prd.md) | 에이전트 | 키트를 처음부터 다시 만드는 제품 요구사항(사이트 엔진은 Astro): 목표, 구조, 기능 요구사항과 수용 기준, 구현 순서 |
| `assets/docs-standard.md` | 모두 | 문서 규격 (사이트 메뉴 "문서 규격") |
| `assets/docs-kit.md` | 모두 | 사이트 사용법 (사이트 메뉴 "문서 사이트 사용법") |
| `CHANGELOG.md` | 모두 | 버전마다 바뀐 점 |

---

## 1. 에이전트에게 줄 지시문 (복사해 붙여 넣기)

`<docs-kit 저장소 URL>`은 `https://github.com/sweaty-fingers/docs-kit`입니다. `main`이 사이트 엔진이 Astro인 판(0.16 이후)이고, MkDocs 판은 태그 `v0.15.4`에 남아 있습니다. 서브모듈은 `git submodule add -b main <URL> .docs-kit`로 넣습니다. 모두 **제안 → 사용자 승인 → 작업** 순서입니다.

### 1.1 새 프로젝트를 docs-kit으로 시작할 때

```text
이 저장소의 문서 체계를 docs-kit으로 세워 줘.

- docs-kit 저장소: <docs-kit 저장소 URL>
  .docs-kit/ 이 아직 없으면 먼저 임시 폴더에 clone해서 README.md, AGENTS-GUIDE.md,
  template/agents/AGENTS.docs-kit.md 를 읽어. (서브모듈 추가는 내가 승인한 뒤에)
- 절차는 AGENTS-GUIDE.md §2를 따라:
  1) 프로젝트 목적과 계획, 성격(연구/개발/당장 쓸 앱), 기간·인원, 정기 회의, 실험·검증 여부,
     이슈 트래커, 문서 공유 방법, 큰 파일 보관소, 결정 분야를 한 번에 물어봐.
  2) 답을 바탕으로 §4 제안서 형식으로 탭 묶음(profile)과 켤/끌 탭, 처음 만들 문서,
     AGENTS.md에 넣을 내용을 제안해.
  3) 내가 승인하기 전에는 파일을 만들거나 바꾸지 마. 승인하면 진행하고,
     빌드 경고 0과 `.docs-kit/bin/kit.py check` 경고 0을 확인해서 보고해.
- 모르는 내용은 지어내지 말고 비워 두거나 나에게 물어봐.
- 커밋과 push는 내가 요청할 때만 해.
```

### 1.2 진행 중인 프로젝트에 docs-kit을 들일 때

```text
진행 중인 이 프로젝트의 문서를 docs-kit으로 관리하도록 바꾸고 싶어.

- docs-kit 저장소: <docs-kit 저장소 URL>
  .docs-kit/ 이 아직 없으면 먼저 임시 폴더에 clone해서 README.md, AGENTS-GUIDE.md,
  template/agents/AGENTS.docs-kit.md 를 읽어.
- 절차는 AGENTS-GUIDE.md §3을 따라:
  1) 먼저 읽기만 해서 파악해: 저장소 구조, 기존 문서(README, docs/, 위키 사본 등),
     기존 AGENTS.md·CLAUDE.md, 문서 사이트 설정, 이슈 트래커, 최근 커밋.
  2) 파악한 내용(목적, 성격, 진행 상황)을 요약하고, 확인 못 한 것은 질문으로 정리해.
  3) §4 제안서 형식으로 탭 묶음, 기존 문서마다 어디로 옮길지(이전 대응표),
     할 일 목록은 이슈로 옮길 것, AGENTS.md에 더할 내용, 커밋 단위 순서를 제안해.
  4) 내가 승인하기 전에는 파일을 만들거나 옮기지 마. 승인하면 순서대로 진행하고
     묶음마다 빌드 경고 0을 확인해. 기존 문서는 내용을 바꾸지 말고 형식만 옮겨.
- 기존 AGENTS.md의 프로젝트 고유 규칙은 그대로 두고 docs-kit 절을 더해.
- 커밋과 push는 내가 요청할 때만 해.
```

### 1.3 docs-kit을 쓰는 프로젝트에서 새 세션을 열 때

프로젝트 AGENTS.md에 docs-kit 절이 있으면 따로 지시할 것이 없습니다(에이전트가 세션마다 읽음). 확인하고 싶으면:

```text
AGENTS.md를 읽고 "문서 관리 (docs-kit)" 절의 D1(세션 시작)을 해 줘.
경고가 있으면 조치와 함께 알려 주고, 키트가 새 버전이면 바뀐 점을 요약해서 갱신할지 물어봐.
```

### 1.4 새 메뉴(탭)가 필요할 때

```text
<무엇을 보고 싶은지> 메뉴가 필요해.
AGENTS-GUIDE.md §6대로 docs-kit에 같은 일을 하는 탭이 있는지 먼저 `.docs-kit/bin/kit.py status`로 확인하고,
있으면 그 탭을 켜는 안, 없으면 docs-kit에 새 탭을 만드는 안(모든 프로젝트 공통)과
이 프로젝트에만 문서로 두는 안을 비교해서 제안해. 승인 뒤 진행해.
```

### 1.5 문서 형식을 바꿨을 때 (키트에 반영)

```text
방금 바꾼 문서 형식(<무엇>)은 다른 프로젝트도 같이 써야 해.
AGENTS-GUIDE.md §7 절차로 docs-kit 저장소에 반영해 줘: 프로젝트 고유 내용은 빼고,
VERSION·CHANGELOG·docs-kit-context.md를 고치고, selftest와 빌드 경고 0을 확인해.
docs-kit을 먼저 push하고 이 프로젝트의 .docs-kit을 갱신하는 것까지 해 줘.
```

### 1.6 docs-kit을 처음부터 다시 만들 때 (Astro 판)

```text
docs-kit 저장소의 prd.md를 읽고 docs-kit을 Astro 기반으로 처음부터 구현해 줘.
- 동작의 세부 기준은 docs-kit-context.md와 지금 저장소의 코드야(MkDocs 판은 태그 v0.15.4). 문서 형식, 템플릿,
  호스트 도구(bin/*.py), 에이전트 문서는 그대로 가져다 쓰고 사이트 엔진만 새로 만들어.
- 먼저 prd.md §12 열린 질문(Astro·Node 버전, 아일랜드 방식, 검색, 문서 밖 읽기)을 확인해서
  근거와 함께 제안하고, 내가 승인하면 §11 구현 순서대로 진행해. 단계마다 끝 기준을 통과시키고 보고해.
- prd.md에 없는 것은 지어내지 말고 물어봐. 커밋과 push는 내가 요청할 때만 해.
```

---

## 2. 사람이 직접 세우기

호스트에 필요한 것은 git, Python 3.8 이상, 그리고 Docker **또는** Node 22.18 이상(`DOCS_RUNNER=host`)입니다. Docker를 쓰면 처음 한 번 사이트 이미지를 만듭니다.

```bash
cd <프로젝트 루트>
git submodule add -b main https://github.com/sweaty-fingers/docs-kit.git .docs-kit
.docs-kit/bin/kit.py init --name "프로젝트 이름" --profile dev   # minimal | app | dev | research | all
.docs-kit/bin/docs.sh build 2>&1 | grep -iE "warn|error"         # 아무것도 안 나와야 함
.docs-kit/bin/docs.sh start                                       # http://localhost:8000/
git add .gitmodules .docs-kit docs-kit.yml docs .gitignore
git commit -m "Add docs site (docs-kit)"
```

설정 파일은 `docs-kit.yml` 하나입니다: 켤 탭(`profile`, `features`), 분야(`areas`), 사이트(`site.name`, `site.issues_url`, 하위 경로 배포면 `site.base`), 짧은 주소(`links`), 메뉴를 직접 정할 때만 `nav`. 배포는 프로젝트가 정합니다(`build/site/`는 정적 파일; GitHub Pages 예: 서브모듈을 받고 `DOCS_RUNNER=host .docs-kit/bin/docs.sh build --strict` 후 `build/site` 업로드).

`init`은 `template/base/`(docs-kit.yml, docs/README.md)와 켠 탭의 시작 파일(`template/features/<id>/`)을 복사합니다. 있는 파일은 건드리지 않습니다. 이후:

```bash
.docs-kit/bin/kit.py status                 # 탭 상태
.docs-kit/bin/kit.py enable plan roadmap    # 켜기 (시작 파일 복사)
.docs-kit/bin/kit.py disable weekly         # 끄기 (문서는 남고 메뉴에서만 빠짐)
.docs-kit/bin/kit.py profile research       # 묶음 바꾸기
```

docs-kit MkDocs 판(0.15)을 쓰던 프로젝트는 `.docs-kit/bin/kit.py migrate`로 `mkdocs.yml`의 사이트 설정(이름, 트래커 주소, 짧은 주소, Rerun, nav)을 `docs-kit.yml`로 옮깁니다. 다른 문서 사이트(Starlight, MkDocs 등)가 있던 프로젝트는 AGENTS-GUIDE §3대로 문서를 탭 폴더로 옮깁니다(형식만).

## 3. 받기와 갱신

```bash
git clone --recurse-submodules <프로젝트 저장소>
git submodule update --init                 # .docs-kit/이 비어 있을 때
.docs-kit/bin/kit.py check --fetch          # 키트 상태: 고치다 만 것, push 안 된 것, 새 버전
.docs-kit/bin/kit.py update                 # 따라가는 브랜치(보통 main)의 최신으로 갱신하고 바뀐 점(CHANGELOG)을 보여 줌
git add .docs-kit && git commit -m "docs-kit <버전>"
```

프로젝트는 서브모듈 커밋으로 키트 버전을 고정합니다. 갱신은 각 프로젝트가 원할 때 합니다.

## 4. 구조

| 경로 | 역할 |
| --- | --- |
| `site/` | 사이트 엔진(Astro): 설정 읽기, 문서 겹치기, Markdown 호환, 메뉴, 화면, 검색. 구조와 단계별 진행은 [site/README.md](site/README.md) |
| `site/src/config/features.json` | 탭 목록, 묶음, 기본 분야 (`kit.py`와 사이트가 함께 읽음) |
| `docker/` | 사이트 이미지(Node + 사이트 패키지)와 진입 스크립트 |
| `decisions/` | 키트의 큰 결정 기록 |
| `hooks/`, `mkdocs.base.yml` | MkDocs 판의 훅과 설정(참고용, 사이트는 쓰지 않음; 탭 모듈은 `site/src/lib/`). `hooks/kitconf.py`는 `kit.py`가 씀 |
| `assets/` | 사이트에 들어가는 키트 페이지·뷰어·스타일 (`assets/<탭>/`, `_kit/`, `docs-standard.md`, `docs-kit.md`) |
| `template/base/`, `template/features/<id>/` | `kit.py init`·`enable`이 복사하는 시작 파일 |
| `template/agents/AGENTS.docs-kit.md` | 프로젝트 AGENTS.md에 넣을 절 |
| `tests/fixtures/all/` | selftest 고정 입력(주간 보고, 로드맵, 현황판, 리스크, 스프린트, 검색 질문, 주제) |
| `bin/` | `kit.py`(설정), `docs.sh`(사이트), `docs_search.py`·`docs_check.py`·`docs_ask.py`(근거), `serve.sh`(보드·질문 서버), `plan_board.py`, `repro.sh`(VR 재현), `weekly_draft.py`(주간 보고 재료), `init.sh`, `selftest.sh` |

## 5. docs-kit 고치기

절차는 [AGENTS-GUIDE.md](AGENTS-GUIDE.md) §7입니다. 요약:

1. 이 저장소의 `main`에서 고칩니다. 프로젝트 고유 내용(이름, 경로, 실제 값, 예시)을 넣지 않습니다. 화면 문구는 한국어, 코드 주석은 영어.
2. `bin/selftest.sh` → `selftest OK` (단위 시험, 묶음 5개 빌드와 탭 순서, minimal 프로젝트의 탭 켜기·끄기, Markdown 고정 입력, 외부 스크립트 없음, `migrate`, 인용 점검).
3. 쓰고 있는 프로젝트 하나에서 화면을 확인합니다(`site/` 코드를 고쳤으면 미리보기 서버를 다시 켬).
4. `VERSION`, `CHANGELOG.md`, 바뀐 동작은 `docs-kit-context.md`에 반영하고 커밋 → push(키트 먼저) → 프로젝트의 `.docs-kit` 갱신.
