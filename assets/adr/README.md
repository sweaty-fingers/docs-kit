# ADR 목록

과제에서 내린 **아키텍처·기술 결정**을 결정 하나에 문서 하나씩, 같은 형식으로 남긴 기록(Architecture Decision Record)입니다. "왜 이렇게 되어 있지?"에 대한 답을 여기서 찾고, 같은 논의를 반복하지 않기 위해 씁니다.

- 시간 순서 한 줄 요약: [의사결정 로그](log.md)
- 결정이 걸린 시스템 요소와 구조도: [아키텍처 (C4)](c4.md)
- 쓰는 법: [작성 가이드](guide.md)
- 새 ADR의 시작점: [템플릿](template.md)
- arc42 섹션·가이드는 **현재 상태와 방법**을, ADR은 **그렇게 정한 이유와 버린 대안**을 담습니다. 다른 문서에서 결정 이유가 길어지면 ADR로 옮기고 링크합니다.

## 전체 목록

아래 표는 각 ADR의 머리말(front matter)에서 자동으로 만들어집니다. 직접 고치지 않습니다.

<!-- adr-index -->

## 상태

| 상태 | 뜻 |
| --- | --- |
| <span class="adr-status adr-status--proposed">제안</span> | 작성됨, 검토 중. 아직 따르지 않아도 됨 |
| <span class="adr-status adr-status--accepted">승인</span> | 결정됨. 현재 이 결정을 따름 |
| <span class="adr-status adr-status--rejected">기각</span> | 검토했지만 채택하지 않음. 같은 제안이 다시 나올 때 근거로 씀 |
| <span class="adr-status adr-status--deprecated">폐기</span> | 더 이상 해당 없음 (대상이 사라짐). 대체 결정 없음 |
| <span class="adr-status adr-status--superseded">대체됨</span> | 새 ADR로 바뀜. 머리말 `superseded_by`가 새 ADR을 가리킴 |
