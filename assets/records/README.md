# 검증 기록 (VR)

환경 구축, 빌드, 장비 대조처럼 **실제로 실행해서 확인한 결과**를 한 번에 한 문서로 남깁니다. 언제, 어디서, 어떤 버전으로 해 봤고 무엇이 기대와 같았는지와 그 증거를 담습니다. ADR이 "왜 정했나", 실행 가이드가 "어떻게 하나"라면, VR은 "해 보니 어땠나"입니다.

## 1. 목록

아래 표는 각 VR의 머리말에서 자동으로 만들어집니다.

<!-- vr-index -->

## 2. 규칙

| 규칙 | 내용 |
| --- | --- |
| 파일 | `docs/records/NNNN-짧은-영문-제목.md`, 제목 `# VR-NNNN. <확인한 것과 결과>`. 번호는 재사용하지 않음 |
| 머리말 | `result`(pass, partial, fail), `date`, `by`, `area`, `subject` 필수. `host`, `commit`, `adr`, `guide`, `c4`, `supersedes`는 선택 ([템플릿](template.md)) |
| 증거 | `docs/records/assets/VR-NNNN/`. 큰 파일은 저장소 밖에 두고 경로와 sha256만 |
| 재현 | `assets/VR-NNNN/repro.sh`(다시 실행)와 `expected.txt`(이 기록의 값). 없으면 빌드 로그에 경고 |
| 고치기 | 쓴 뒤 고치지 않음. 다시 검증하면 새 VR에 `supersedes: <번호>`. 옛 VR에는 "대신하는 새 기록"이 자동 표시 |

웹에서는 각 VR 제목 아래 결과 카드가 붙고, `adr:`에 적은 ADR의 카드와 아키텍처 뷰어에 이 VR이 "검증 기록"으로 표시됩니다(docs-kit `site/src/lib/records.ts`).
