# G1. 시작하기

> 기준: {{TODAY}}

새로 합류한 사람이 저장소를 받아 문서 사이트를 띄우기까지의 절차입니다. 단계마다 **명령 → 기대 결과 → 안 될 때** 순서로 씁니다. 이유와 결정은 정본(ADR)으로 링크합니다.

## 1. 저장소 받기

```bash
git clone --recurse-submodules <저장소 주소>
```

- 기대 결과: `.docs-kit/` 폴더에 파일이 있음
- 안 될 때: `.docs-kit/`이 비어 있으면 `git submodule update --init`

## 2. 문서 사이트 띄우기

```bash
.docs-kit/bin/docs.sh start
```

- 기대 결과: `http://localhost:8000/`에서 이 사이트가 열림
- 안 될 때: `port is already allocated`이면 `DOCS_PORT=8080 .docs-kit/bin/docs.sh start`
