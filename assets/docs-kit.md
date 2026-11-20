# 문서 사이트 사용법

이 사이트는 **docs-kit**(공통 문서 규격)으로 만들어집니다. 프로젝트는 문서 내용(`docs/`)과 설정 파일 하나(`docs-kit.yml`: 쓸 탭 §7, 사이트 이름, 메뉴, 짧은 주소)만 관리하고, 모양·확장 기능·탭별 목록·뷰어는 docs-kit이 제공합니다(사이트 엔진은 Astro). docs-kit은 프로젝트의 `.docs-kit/`에 git 서브모듈로 들어 있습니다.

## 1. 실행

기본은 Docker입니다. 키트의 `docker/Dockerfile`로 Node와 사이트 패키지를 담은 이미지를 처음 한 번 만들어 씁니다. Docker가 없으면 호스트의 Node(22.18 이상)로 돌고(`DOCS_RUNNER=host`), 처음 한 번 사이트 패키지를 설치합니다.

| 명령 | 동작 |
| --- | --- |
| `.docs-kit/bin/docs.sh start` | 미리보기 서버를 백그라운드로 실행. PC·Docker를 재시작해도 다시 켜짐 |
| `.docs-kit/bin/docs.sh status` | 실행 여부와 접속 주소 (`http://localhost:8000/`과 이 PC의 IP) |
| `.docs-kit/bin/docs.sh logs` | 서버 로그. 저장할 때마다 다시 빌드한 결과와 `WARNING` |
| `.docs-kit/bin/docs.sh stop` | 서버 끄기 |
| `.docs-kit/bin/docs.sh serve` | 터미널에서 직접 실행 (Ctrl-C로 끝) |
| `.docs-kit/bin/docs.sh build` | 정적 사이트를 `build/site/`에 생성. `--strict`면 경고가 하나라도 있을 때 실패 |

- 포트를 바꾸려면 `DOCS_PORT=8080 .docs-kit/bin/docs.sh start`처럼 지정합니다(`status`, `stop`에도 같은 값).
- `docs/` 안의 파일이나 `docs-kit.yml`을 저장하면 1~2초 뒤 열린 페이지가 자동으로 새로고침됩니다.
- 배포 방식은 프로젝트가 정합니다. `build/site/`는 정적 파일이라 사내 웹 서버에 그대로 올리거나 GitHub Pages 같은 곳에 올립니다. 하위 경로(예: `https://<계정>.github.io/<저장소>/`)에 올릴 때는 `docs-kit.yml`의 `site.base`를 그 경로로 둡니다.
- 미리보기 서버는 **로그인 없이** 네트워크로 닿는 누구나 볼 수 있습니다. 공개하면 안 되는 문서면 열어 둘 범위를 정해서 씁니다.
- 수식(KaTeX, 빌드할 때 그림), Mermaid 다이어그램, 아키텍처 뷰어(ELK), 사이트 검색(Pagefind), 글꼴(Pretendard)은 버전을 고정해 사이트에 함께 실립니다. 사이트 검색은 빌드한 사이트(`build`)에서 동작하고 미리보기(`start`)에서는 안내만 나옵니다.

## 2. 문서 작성 규칙

| 규칙 | 이유 |
| --- | --- |
| 문서 사이 링크는 **`.md` 상대 경로**로 씁니다 (`[03 §2](../design/03_xxx.md#2-제목)`) | 저장소 화면(GitLab)과 웹 사이트 모두에서 동작 |
| 절 앵커는 GitHub 방식(소문자, 공백 → `-`, 기호 제거, 한글 유지) | 사이트도 같은 규칙으로 앵커를 만듦 |
| 링크 대상이 될 제목에는 공백으로 둘러싼 기호(` / `, ` → `, ` - `)를 쓰지 않습니다 | 앵커에 `--`가 생기면 GitLab에서 링크가 해당 절로 가지 않음(GitLab은 `--`를 `-`로 줄임) |
| 절 참조는 `§4.3`(같은 문서), `03 §4`(문서 번호 두 자리 + 공백 + §)처럼 **그냥 텍스트로** 씁니다. 파일 이름은 `03_xxx.md`처럼 두 자리 번호로 시작하고, 제목은 `### 4.3 제목`처럼 번호로 시작합니다 | 웹에서 자동으로 해당 절 링크가 됨(첫 칸이 번호인 표 행도 대상). 없는 번호는 텍스트로 남음 |
| `docs/` 밖의 파일은 링크 대신 **코드 경로**로 씁니다 (`` `tools/run.sh` ``) | 사이트에는 `docs/` 안의 파일만 들어감 |
| 새 문서는 켠 탭의 폴더(예: `docs/guides/`)에 두면 메뉴에 저절로 들어갑니다. 탭 폴더 밖에 둘 때만 `docs-kit.yml`의 `nav`에 넣습니다 | 메뉴에 없는 문서는 빌드 로그에 경고 |
| Mermaid는 ` ```mermaid ` 코드 블록, 수식은 `$...$`, `$$...$$` | 사이트에서 그려짐 |

## 3. ADR과 아키텍처 (C4)

- 결정은 `docs/adr/NNNN-짧은-영문-제목.md`로 씁니다. 형식과 검토 기준은 [ADR 작성 가이드](adr/guide.md), 시작점은 [템플릿](adr/template.md)입니다.
- [ADR 목록](adr/README.md), [의사결정 로그](adr/log.md), 메뉴는 ADR 머리말에서 자동으로 만들어집니다.
- 시스템 구조는 `docs/adr/c4-model.yml`에 적고, [아키텍처 (C4)](adr/c4.md) 페이지와 [아키텍처 뷰어](adr/viewer/index.html)(전체 화면)에서 봅니다. ADR 머리말의 `c4: [요소 id]`로 결정과 요소를 연결합니다.

문서를 어떤 종류로 나누고 각 종류에 무엇을 쓰는지는 [문서 규격](docs-standard.md)에 있습니다. arc42 섹션(`docs/arc42/`), 발행물(`docs/publications/`)도 ADR·VR처럼 메뉴·목록·카드가 머리말에서 자동으로 만들어집니다. 어느 문서에서나 `<!-- c4-view: <뷰 id> -->`로 C4 그림을 넣을 수 있습니다.

### 3.1 검증 기록 (VR)

실행해서 확인한 결과는 `docs/records/NNNN-짧은-영문-제목.md`(제목 `# VR-NNNN. ...`)로 남깁니다. 규칙과 시작점은 [검증 기록](records/README.md)과 [템플릿](records/template.md)입니다. 프로젝트의 `docs/records/README.md`, `template.md`가 있으면 그것이 우선합니다.

- 메뉴: `docs-kit.yml` `nav`에 `records/README.md`를 넣은 절이 있으면 그 절을, 없으면 끝에 "검증 기록"을 만들어 README, 템플릿, 모든 VR로 채웁니다.
- 목록: README의 `<!-- vr-index -->`가 머리말로 만든 표가 됩니다.
- 카드: 각 VR 제목 아래 결과 배지(통과·부분 통과·실패), 날짜, 장비, 커밋, 절차, ADR, C4 요소, 재현 파일, 대체 관계.
- 연결: VR 머리말 `adr: [2, 6]`에 적은 ADR의 카드에 "검증 기록" 줄이, `c4:`에 적은 요소와 그 ADR에는 아키텍처 뷰어에서 "Verification"·"VERIFIED BY"가 붙습니다.
- 검사: 필수 머리말(`result`, `date`, `by`, `area`, `subject`), 값, 제목 번호, 없는 ADR·VR 번호, `assets/VR-NNNN/repro.sh`·`expected.txt` 누락이 빌드 로그에 `WARNING`으로 나옵니다.

### 3.2 Rerun 기록 넣기

Rerun 기록(`.rrd`)을 페이지에 넣으려면 한 줄을 씁니다. 경로는 프로젝트가 띄운 Rerun 파일 서버 기준입니다.

```markdown
<!-- rerun: nas/records/VR-0002/demo.rrd -->
<!-- rerun: local/render/demo.rrd height=480 -->
```

- 페이지에는 "뷰어 불러오기" 버튼이 있는 상자가 생깁니다. 누르기 전에는 아무것도 받지 않습니다(뷰어 약 40 MB).
- 뷰어는 두 가지입니다. `local`(기본): 뷰어(`web_port`)와 파일 서버(`file_port`)가 문서 사이트와 **같은 PC**에서 돌아야 하고, 서버가 응답하지 않으면 상자에 시작 명령이 나옵니다. `hosted`: Rerun 호스팅 웹 뷰어(app.rerun.io)가 사이트에 함께 올린 파일(`docs/<경로>.rrd`)이나 `https://` 주소의 파일을 엽니다. GitHub Pages처럼 서버를 띄울 수 없는 공개 배포에 씁니다(파일 서버가 CORS를 허용해야 함, GitHub Pages는 허용).
- 포트와 시작 명령은 프로젝트 `docs-kit.yml`에서 정합니다. 기본값은 아래와 같습니다.
  ```yaml
  rerun: {web_port: 9090, file_port: 9091, start: tools/rerun_server.sh start}   # local (기본)
  rerun: {viewer: hosted, version: "0.22.1"}       # hosted: 기록을 만든 SDK 버전에 맞춤 (없으면 최신)
  ```
- GitLab 화면에서는 주석이라 보이지 않습니다. 본문에 파일 위치와 여는 명령을 함께 적어 둡니다.

### 3.3 짧은 주소와 서버 링크

긴 주소(특히 Rerun 뷰어 주소)를 사람에게 주거나 입력하기 쉽게 `/r/<이름>/` 짧은 주소를 만듭니다. 프로젝트 `docs-kit.yml`에 적습니다.

```yaml
site:
  shared_port: 8000            # 공유(배포) 사이트의 포트. 아래 kit-dev-only 참고
links:
  - {name: vr-0002, to: "rerun:nas/records/VR-0002/demo.rrd", title: VR-0002 기록 영상}
  - {name: c4, to: adr/c4.md, title: 아키텍처 뷰어}
  - {name: dev, to: "port:8001/", title: 개발 미리보기}
```

- `to`: 문서(`.md`), `rerun:<경로>`(Rerun 뷰어에 그 파일을 열어 줌, 포트는 `rerun`), `port:<포트>/<경로>`(같은 PC의 다른 서버). 주소의 호스트는 언제나 읽는 사람이 연 호스트라, 서버를 옮겨도 그대로 동작합니다.
- 페이지에 `<!-- short-links -->` 한 줄을 쓰면 짧은 주소 표(전체 주소 포함)가 됩니다.
- 본문 링크로도 씁니다: `[기록 영상](rerun:nas/records/VR-0002/demo.rrd)`, `[개발 미리보기](port:8001/)`.
- `<div class="kit-dev-only" markdown>` … `</div>` 안의 내용은 `shared_port`가 **아닌** 포트로 연 페이지(개발 미리보기 등)에서만 보입니다. 공유 사이트에는 공유 주소만 보이게 할 때 씁니다.
- 없는 문서를 가리키거나 이름이 잘못되면 빌드 로그에 `WARNING`이 나옵니다.

## 4. 프로젝트에서 바꿀 수 있는 것

| 하고 싶은 것 | 방법 |
| --- | --- |
| 사이트 이름, 메뉴, 배포 경로 | 프로젝트 `docs-kit.yml`의 `site.name`, `nav`, `site.base` |
| 머리줄의 저장소 링크, 페이지마다 "이 페이지 고치기" | `site.repo_url`, `site.edit_url`(예: `https://github.com/<계정>/<저장소>/edit/main/docs/`) |
| 프로젝트만의 스타일·스크립트 | `docs/` 아래 파일(예: `docs/_static/site.css`)을 두고 `docs-kit.yml`의 `site.extra_css`, `site.extra_js`에 경로를 적음 |
| docs-kit 페이지·파일 하나를 바꿈 (예: ADR 목록 소개문) | 같은 경로로 프로젝트 `docs/`에 파일을 둠(예: `docs/adr/README.md`). 프로젝트 파일이 우선 |
| 모든 프로젝트에 공통인 것 (테마, ADR 형식, 뷰어) | docs-kit 저장소에 반영하고 각 프로젝트에서 서브모듈을 갱신 |

## 5. docs-kit 받기와 갱신

```bash
git clone --recurse-submodules <프로젝트 저장소>   # 처음 받을 때
git submodule update --init                        # 이미 받았는데 .docs-kit/이 비어 있을 때
git submodule update --remote .docs-kit            # docs-kit 최신으로 갱신 (또는 .docs-kit/bin/kit.py update: 바뀐 점도 보여 줌)
git add .docs-kit && git commit -m "Update docs-kit"
```

## 6. 문제 해결

| 증상 | 조치 |
| --- | --- |
| `ERROR: no docs-kit.yml` | 프로젝트 루트에서 `.docs-kit/bin/init.sh "이름"` |
| `.docs-kit/bin/docs.sh: No such file` | `.docs-kit/`이 비어 있음: `git submodule update --init` |
| `WARNING config: settings read from mkdocs.yml` | MkDocs 판에서 옮겨 온 프로젝트: `.docs-kit/bin/kit.py migrate`로 `docs-kit.yml`에 옮김 |
| `port is already allocated` | `DOCS_PORT=8080 .docs-kit/bin/docs.sh start` |
| 고쳤는데 페이지가 안 바뀜 | `.docs-kit/bin/docs.sh logs`에서 `ERROR` 확인. docs-kit의 `site/` 코드를 고친 뒤에는 `stop` 후 `start` |
| 검색 창에 "검색 색인이 없습니다" | 미리보기에서는 정상. `docs.sh build`로 만든 사이트에서 검색됨 |
| `§4.3` 표기가 링크가 안 됨 | 같은 번호로 시작하는 제목(또는 첫 칸이 번호인 표 행)이 없음 |
| 아키텍처 뷰어가 "데이터를 불러오지 못했습니다" | 파일을 직접 열지 말고 문서 사이트(서버나 `build/site`)에서 엶 |

## 7. 탭 켜고 끄기

docs-kit은 모든 탭(현황판, 주간 보고, 로드맵, 문서 지도, 근거 점검, 문서함, 아키텍처, ADR, 실험, 검증 기록, 모델, 실행 가이드, 참고, 공용 파일, 배경, 용어집, 작업 내역)을 갖고 있고, 프로젝트는 쓸 탭만 켭니다. 설정은 프로젝트 루트의 `docs-kit.yml`이고, 규칙은 [문서 규격](docs-standard.md) §13입니다.

```bash
.docs-kit/bin/kit.py status              # 지금 켜진 탭
.docs-kit/bin/kit.py enable roadmap      # 켜기: 시작 파일(docs/roadmap/roadmap.yml 등)도 복사 (있으면 그대로)
.docs-kit/bin/kit.py disable weekly      # 끄기: 문서는 남고 메뉴에서만 빠짐
.docs-kit/bin/kit.py profile research    # 묶음 바꾸기 (minimal, app, dev, research, all)
```

<!-- kit-features -->

## 8. 함께 오는 도구

호스트의 Python 3.8 이상(표준 라이브러리만)으로 바로 돕니다. 출력은 프로젝트의 `build/` 아래에만 씁니다.

| 도구 | 하는 일 |
| --- | --- |
| `.docs-kit/bin/kit.py` | 처음 세우기(`init`), 탭 보기·켜기·끄기, 키트 상태 점검(`check`), 최신 키트로 갱신(`update`), MkDocs 판 설정 옮기기(`migrate`) |
| `.docs-kit/bin/docs.sh` | 문서 사이트 미리보기·빌드 (Docker 또는 호스트 Node) |
| `.docs-kit/bin/docs_search.py "질문"` | 문서를 절 단위로 찾음(BM25, 임베딩 서버가 있으면 하이브리드). 에이전트가 사실을 쓰기 전에 근거를 찾을 때 |
| `.docs-kit/bin/docs_check.py --changed` | 바꾼 문서의 주장(문서 번호, 경로, 포트, 수치)을 원천과 대조. `--record`는 날짜별 기록 |
| `.docs-kit/bin/serve.sh board start` | 스프린트 보드 저장 서버(개발 미리보기에서 연 보드만 저장) |
| `.docs-kit/bin/serve.sh ask start` | 문서 지도의 질문 서버(로컬 생성 모델 `DOCS_LLM_URL`, 임베딩 `DOCS_EMBED_URL`은 프로젝트가 띄움) |
| `.docs-kit/bin/repro.sh VR-NNNN` | 검증 기록의 재현 스크립트를 새 폴더에서 돌리고 기록 값과 비교 |
| `.docs-kit/bin/weekly_draft.py --write` | 지난 보고 이후의 재료(지난 '다음', 이슈 스냅숏, 커밋, 새 문서, 작업 내역)와 이번 보고 뼈대 |

포트 기본값: 공유 사이트 8000, 개발 미리보기 8001, 보드 저장 8002, 질문 서버 8003. 프로젝트가 바꾸면 참고 문서(포트 표)에 적습니다.
