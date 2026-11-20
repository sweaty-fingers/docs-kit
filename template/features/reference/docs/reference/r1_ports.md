# R1. 포트와 주소

여러 문서가 찾아보는 포트와 주소의 표입니다. 포트를 바꾸면 이 표를 함께 고칩니다(근거 점검이 문서 속 포트를 이 표와 대조합니다).

| 포트 | 무엇 | 띄우는 명령 | 누가 봄 |
| --- | --- | --- | --- |
| 8000 | 문서 사이트 (공유) | `.docs-kit/bin/docs.sh start` | 팀 |
| 8001 | 문서 사이트 (개발 미리보기) | `DOCS_PORT=8001 .docs-kit/bin/docs.sh start` | 작성자 |
| 8002 | 스프린트 보드 저장 서버 | `.docs-kit/bin/serve.sh board start` | 작성자 |
| 8003 | 문서 질문 서버 | `.docs-kit/bin/serve.sh ask start` | 작성자 |
