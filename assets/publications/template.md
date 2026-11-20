# 발행물 템플릿

아래 블록을 복사해 `docs/publications/NNNN-<영문 제목>.md`로 저장하고 채웁니다. 규칙은 [문서 규격](../docs-standard.md) §5에 있습니다. 발행물에만 있는 사실이나 결정은 없어야 합니다. 새 사실이 나오면 먼저 정본에 넣고 여기서는 인용·링크합니다.

````markdown
---
kind: overview              # overview | report | release | note | slides
audience: 전 팀             # 누구를 위한 글인가
date: 2026-11-05            # overview는 마지막 갱신일, 나머지는 발행일
status: draft               # draft | published | archived
based_on: [A1, A3, A10, ADR-0004, VR-0002]   # 엮은 정본
# commit: <git rev-parse --short HEAD>        # overview가 아니면 발행할 때 필수 (스냅숏)
---

# P-NNNN. <제목>

<도입: 이 글이 누구에게 무엇을 전하는지 2~3줄.>

## 1. <절 제목>

<서술. 자세한 내용은 정본 링크로.>

<꼭 같아야 하는 표는 정본에서 끼워 넣고, 바로 아래에 정본 링크를 둔다 (GitLab 화면에서는 끼워 넣기가 보이지 않음)>
;--8<-- "arc42/a01_goals.md:rq"

자세한 근거: [A1 §1](../arc42/a01_goals.md)
````
