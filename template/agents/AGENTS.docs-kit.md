<!--
docs-kit section for a project's AGENTS.md (the rules every agent reads at the start of a session).
How to use it: .docs-kit/AGENTS-GUIDE.md §4.
  - Copy everything below the line "8<" into the project's AGENTS.md (new project: as the start of the file,
    existing project: as its own section, after the project's own rules about the codebase).
  - Replace every <...>. Delete the blocks marked [탭: <id>] for tabs that are off (`.docs-kit/bin/kit.py status`),
    and add them back when a tab is turned on later.
  - Keep the section numbers or renumber them consistently; other documents cite "AGENTS.md §N".
-------------------------------------------------------------------------------------------------------- 8< -->
## 문서 관리 (docs-kit)

이 프로젝트의 문서는 **docs-kit**(`.docs-kit/`, git 서브모듈, 원격 `<docs-kit 저장소 URL>`)으로 씁니다. 문서를 어떤 종류로 나누고 어디에 무엇을 쓰는지의 원본은 **문서 규격**(`.docs-kit/assets/docs-standard.md`, 사이트 메뉴 "문서 규격")입니다. 이 절은 그 요약과 이 프로젝트에서 정한 것입니다. 규격과 이 절이 다르면 규격이 우선이고 이 절을 고칩니다.

- 문서 사이트: 공유 `<공유 주소, 예: http://<서버>:8000/>`, 개발 미리보기 `.docs-kit/bin/docs.sh start`(`DOCS_PORT`로 포트)
- 켠 탭: `docs-kit.yml` (`.docs-kit/bin/kit.py status`로 확인). 지금: `<profile 이름과 바꾼 탭>`
- 답변·문서는 한국어, "~합니다"체. 사실과 추정을 구분("확인하지 않음", "(추정)"). 날짜는 `YYYY-MM-DD`
- 코드·주석·CLI 출력은 영어. 커밋 메시지·MR 설명은 <한국어|영어>

### D1. 세션을 시작하면

1. `.docs-kit/bin/kit.py check --fetch`를 실행합니다(읽기와 `git fetch`만 함). `WARN`이 있으면 작업 전에 사용자에게 알립니다.

    | 점검 결과 | 할 일 |
    | --- | --- |
    | `docs-kit has uncommitted changes` / `not on origin/<브랜치>` | 이전 세션의 docs-kit 작업이 끝나지 않음. D6 절차를 마무리할지 사용자에게 묻습니다 |
    | `newer docs-kit on origin/<브랜치>` | 다른 프로젝트에서 키트가 갱신됨. `.docs-kit/bin/kit.py update`를 제안하고, 동의하면 실행 → 빌드 경고 0 → `.docs-kit` 커밋(사용자 요청 시) |
    | `tabs on without files` | 켠 탭의 시작 파일이 없음. `.docs-kit/bin/kit.py enable <id>`로 복사 |
    | `no docs-kit.yml` | 탭 설정이 없음. 사용자와 묶음을 정해 `kit.py init` 또는 `docs-kit.yml` 작성 |

2. `git status`로 작업 트리를 봅니다. 같은 작업 트리에서 다른 세션(사람·다른 에이전트)이 동시에 일할 수 있으므로, 내가 만들지 않은 변경은 고치거나 되돌리거나 커밋하지 않습니다.

### D2. 어디에 쓰나 (규격 §1~§6)

먼저 **층**을 정하고, 정본이면 **섹션·부록**을 정합니다. 아래 표에서 이 프로젝트가 켠 탭만 남깁니다.

| 층 | 종류 | 위치 | 생명 주기 |
| --- | --- | --- | --- |
| 발행물 | P-NNNN (overview, report, release, note, slides) | `docs/publications/` | overview는 갱신, 나머지는 발행 후 고정(`commit` 필수) |
| 발행물 | 주간 보고 | `docs/weekly/YYYY-MM-DD.md` | 회의 전 `draft`, 회의 뒤 `published` + `commit` |
| 재료 | 메모 | `docs/memos/<번호>.md` (메뉴 "메모"의 앱) | 사람이 쓰고 정리함. 에이전트는 고른 메모만 읽음. 근거가 아님 |
| 정본 | arc42 A1~A12 | `docs/arc42/aNN_*.md` | 갱신 (머리말 `status`, `owner`, `reviewed`) |
| 정본 | ADR | `docs/adr/` | 추가만 (승인 뒤 본문 고치지 않음, 바뀌면 새 ADR + `supersedes`) |
| 정본 | 실험 EXP | `docs/experiments/` | 추가만. 연구 질문·가설 하나 = 문서 하나 |
| 정본 | 검증 VR | `docs/records/` | 추가만. 다시 검증하면 새 VR + `supersedes` |
| 정본 | 모델 카드 MC | `docs/models/` | 승격된 모델만 |
| 운영 | 실행 가이드 G, 참고 R | `docs/guides/`, `docs/reference/` | 갱신 |
| 운영 | 작업 내역 | `docs/history.md` | 작업이 병합될 때 맨 위에 한 줄 |
| 지식 | 배경, 용어집 | `docs/background/`, `docs/glossary/` | 가끔 갱신 |

- **사실과 결정은 정본에만** 둡니다. 발행물·가이드·보고에 새 사실이 생기면 먼저 정본에 넣고 링크합니다.
- **할 일은 이슈 트래커**(`<트래커 주소>`)에 둡니다. 문서에 체크리스트를 만들지 않고 이슈 번호(`#12`)만 적습니다.
- 용어는 용어집 색인에 한 줄, 자세한 설명은 한 곳에만. 다른 문서에 용어 표를 만들지 않습니다.
- 번호는 재사용하지 않습니다(ADR-NNNN, VR-NNNN, EXP-NNNN, P-NNNN, G<N>, R<N>, 배경 NN). 제목은 번호로 시작하고, 링크될 제목에 ` / `, ` → `, ` - `를 쓰지 않습니다.
- 문서 사이 링크는 `.md` 상대 경로, `docs/` 밖은 코드 경로(`` `tools/x.sh` ``).
- 큰 파일(수 MB 이상, 바이너리 결과)은 git에 넣지 않고 `<보관소 경로>`에 두고, 문서에는 경로·크기·sha256·다시 만드는 명령만 적습니다.
- ADR은 템플릿 순서 그대로, 고려한 선택지마다 장점·단점·기각 사유, 고른 것은 `(채택)` + 채택 이유. 새 C4 요소가 필요하면 `docs/adr/c4-model.yml`에 같은 커밋으로 추가(요소 id는 바꾸지 않음). 분야 값은 `docs-kit.yml`의 `areas`.
- VR은 실행한 명령과 시각을 첫 줄에 남긴 출력 파일을 `docs/records/assets/VR-NNNN/`에 두고 표(기대 / 실제 / 판정)를 그 파일에서 옮깁니다. 재현 `repro.sh` + `expected.txt`를 함께 만들고 `.docs-kit/bin/repro.sh VR-NNNN`이 모두 `OK`인지 확인합니다. `fail`, `partial`도 남깁니다.

### D3. 근거 먼저 (할루시네이션 줄이기)

1. 프로젝트 사실(값, 결정, 경로, 명령, 상태, 날짜)을 말하거나 쓰기 전에 `python3 .docs-kit/bin/docs_search.py "<질문>"`으로 찾고, 나온 절을 실제로 읽습니다. 코드·설정이 답이면 그 파일을 읽습니다.
2. 답과 문서에 근거(문서 ID와 절, 또는 `경로:줄`)를 붙입니다. 정본(VR·ADR·arc42)을 발행물·보고보다 먼저 쓰고, "대체됨 → 새 기록"이 붙은 것은 새 기록을 씁니다.
3. 못 찾으면 "문서에서 확인 못 함"이라고 쓰고 확인할 방법을 제안합니다. 추측으로 채우지 않습니다.
4. [탭: quality] 틀리게 말한 것이 드러나면 `docs/quality/incidents.json`에 한 줄, 같은 질문을 `docs/quality/questions.json`에 정답 문서와 함께 더합니다.

### D4. 쓰고 나서 확인

```bash
.docs-kit/bin/docs.sh build 2>&1 | grep -iE "warn|error"     # 아무것도 안 나와야 함
python3 .docs-kit/bin/docs_check.py --changed                  # [탭: quality] 틀림 0
```

- arc42 섹션을 고쳤으면 머리말 `status`와 `reviewed`를 갱신합니다.
- 바꿨다고 보고하는 것은 사용자가 보는 곳(미리보기, 공유 사이트)에서 확인합니다.

### D5. 탭별 작업 흐름 (켠 탭만 남김)

- [탭: roadmap] **로드맵** `docs/roadmap/roadmap.yml`: 일을 마친 커밋에서 항목을 `status: done`, `date`, `refs`(VR, ADR, MR, 이슈)로. 계획이 바뀌면 `status`(`next`·`later`·`future`)와 `after`만 고침. 하지 않기로 한 일은 지우지 않고 `dropped`. 항목 `id`는 바꾸지 않음. 업무(`units`) 이름은 이슈 트래커 마일스톤·주간 보고 업무 이름과 같게.
- [탭: plan] **현황판** `docs/plan/`: 새 이슈·로드맵 항목을 만들면 `scope.yml`에 한 줄(`added`: 오늘, 크기, 완료 정의). 뺀 일은 `dropped` + `removed` + `reason`. 단계 통과 기준을 채운 VR이 생기면 Epic `dod`의 `met`·`evidence`. 새 위험은 `risks.yml`에(점수는 제안으로 두고 사용자 확인), 다시 평가하면 `history`에 줄을 더함. 이슈 스냅숏 `docs/plan/issues.json`은 `<스냅숏 명령>`으로 새로 받음. 스프린트 보드는 개발 미리보기에서 열고 저장 서버 `.docs-kit/bin/serve.sh board start`. 일을 시작·끝낼 때 이번 스프린트 카드의 칸을 맞춤.
- [탭: memos] **메모**: 메모는 사람이 메뉴 "메모"의 앱에서 쓰는 재료입니다. 에이전트는 사용자가 고른 메모만 읽고(`.docs-kit/bin/memos.py show <번호…>`, 찾기는 `memos.py list --work … --tag … --since …`), 메모 파일을 고치거나 지우지 않습니다(사용자가 시킬 때만). 메모가 GitHub 저장소에 저장되는 프로젝트(`docs-kit.yml` `memos.github`)에서는 `memos.py`가 읽기 전에 복제본을 `git pull`하고, 에이전트는 그 복제본에 커밋하지 않습니다. 메모의 사실을 문서에 쓸 때는 정본에서 확인하고 인용합니다. 메모는 `docs_search`에 나오지 않습니다.
- [탭: weekly] **주간 보고**: 사용자가 "주간 보고 써 줘"라고 하면 먼저 **어느 메모를 참고할지 묻습니다**(`.docs-kit/bin/memos.py list`로 최근 메모를 업무별로 보여 주고, 번호·업무·태그·기간으로 고르게 함. 메모 앱의 "에이전트에게 넘기기"로 붙여 넣은 목록이 있으면 그것을 씀). 고른 메모가 있으면 `.docs-kit/bin/weekly_draft.py --memos <고른 것> --write`로 재료와 뼈대를 만들고 **그 메모에 적힌 일만** 씁니다(메모 날짜가 보고 기간 밖이어도 됨, 그 주의 커밋·이슈를 더하지 않음, 머리말 `memos`는 뼈대가 채움). 메모를 고르지 않거나 "알아서 써 줘"면 `.docs-kit/bin/weekly_draft.py --write`로 그 기간의 이슈·커밋·작업 내역에서 씁니다. 어느 쪽이든 업무 단위로 **배경 → 한 일 → 결과(근거 링크) → 다음**을 씁니다. 업무 이름은 지난 보고와 같게. 새 사실을 보고에만 쓰지 않음. 지난 "다음"을 못 했으면 이유. `status: draft`로 두고 검토 요청. 회의 뒤 `published` + `commit`.
- [탭: graph] **문서 지도**: 새 문서에는 머리말 `topics: [<로드맵 트랙 id>]`(최대 2개). 고치지 않는 문서(ADR·VR)는 `docs/graph/topics.yml`. 지도 패널의 점검(연결 안 된 문서, 추정 주제, 링크할 쌍)을 보고 맞으면 링크를 넣음. 질문 서버는 `.docs-kit/bin/serve.sh ask start`.
- [탭: quality] **근거 점검**: 문서를 고친 뒤 `docs_check.py --changed` → 틀림 0. 확인 못 함은 근거를 링크하거나 (예정)·(외부 출처)를 표시. 외부 저장소·장비 경로와 아직 없는 계획 경로는 `docs/quality/config.json`에. 주간 보고 때 `docs_check.py --record`.
- [탭: history] **작업 내역**: 작업을 MR로 올릴 때 `docs/history.md` 맨 위에 한 줄(날짜, 업무, 내용, 결과 링크, 재현 명령, 자세한 문서).
- 위 페이지들은 사용자가 따로 요청하지 않아도 작업 흐름 안에서 맞춥니다. MR을 올리기 전에 빌드 경고에 `plan:`·`roadmap:`이 있으면 먼저 고칩니다.

### D6. docs-kit을 고칠 때 (형식은 키트에, 내용은 프로젝트에)

**여러 프로젝트가 같이 쓰는 것**(문서 규격, 템플릿, 가이드, 훅, 뷰어, 사이트 모양, 탭, `bin/` 도구)은 이 프로젝트의 `docs/`가 아니라 docs-kit 저장소에서 고칩니다. 그래야 다음 프로젝트가 최신 키트를 받습니다. 프로젝트에만 해당하는 내용(이름, 경로, 실제 값, 예시)은 키트에 넣지 않습니다.

1. **새 탭이 필요하면 먼저 있는 탭을 찾습니다**: `.docs-kit/bin/kit.py status`. 같은 일을 하는 탭이 있으면 `kit.py enable <id>`로 켜고 끝. 없을 때만 키트에 새 탭을 만듭니다(`.docs-kit/AGENTS-GUIDE.md` §6).
2. `.docs-kit`이 따라가는 브랜치(`.gitmodules`의 `branch`, 보통 `main`)인지 확인합니다(분리된 HEAD면 `git -C .docs-kit checkout -B <브랜치> origin/<브랜치>`, 같은 커밋일 때만).
3. 고치고, `VERSION`을 올리고(형식 추가 = 마이너, 고침 = 패치), `CHANGELOG.md` 맨 위에 항목, 바뀐 동작은 `docs-kit-context.md`에도 반영합니다.
4. `.docs-kit/bin/selftest.sh` → `selftest OK`. 미리보기는 키트의 `site/` 코드를 시작할 때만 읽으므로 `stop` 후 `start`로 다시 켜서 화면을 확인합니다.
5. docs-kit 커밋 → **docs-kit 먼저 push** → 프로젝트에서 `git add .docs-kit`(+ 새 형식으로 옮긴 문서) 커밋 → push. 기존 문서를 새 형식으로 옮겼으면 같은 프로젝트 커밋에 넣습니다(내용은 바꾸지 않음, ADR이면 "형식 정리").
6. 프로젝트 저장소가 `submodule.recurse=true`면 push는 `git push --recurse-submodules=no`로 합니다.

### D7. git

- 커밋과 push는 **사용자가 요청할 때만** 합니다. 기본 브랜치에 바로 커밋하지 않고 작업 브랜치에.
- 내 변경만 커밋합니다. `git add`는 내가 바꾼 파일을 경로로 하나씩(`git add -A`, `git add .`, `git add docs` 쓰지 않음). 커밋 전에 `git diff --cached --stat`.
- 커밋은 주제별로 나눕니다(도구 / 문서 / docs-kit 갱신). force push, 원격 브랜치 삭제는 하지 않습니다.
