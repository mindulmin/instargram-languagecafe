# Language Cafe Instagram publisher

한국어 표현 8장 캐러셀과 같은 표현의 Threads 복습 글을 운영하는 독립 저장소입니다.

GitHub Actions의 **Language Cafe scheduled publisher**가 매일 한국 시간 오전 9시에 GitHub Windows 서버에서 실행됩니다. PC나 Codex 앱을 켜 둘 필요가 없습니다. GitHub의 예약 실행은 지연될 수 있습니다.

현재 게시 계약이 유효하지 않거나 `postDue=false`이면 게시하지 않습니다. 예약 실행 성공과 실제 게시 성공은 별개입니다. Actions 실행 요약에서 실제 상태를 확인하세요.

- [예약 실행과 수동 점검](https://github.com/mindulmin/instargram-languagecafe/actions/workflows/language-cafe.yml)
- [서버 설정과 운영 절차](cloud/README.md)
- [게시 계약](content-queue/AUTOMATION-CONVERSION-PUBLISHER.md)

인증 정보는 GitHub Secrets에, 게시 이력·큐·미해결 잠금은 AES-256-GCM으로 암호화한 `cloud-state` 브랜치에 보관합니다. 공개 저장소에 세션·API 키·원본 운영 로그를 커밋하지 마세요.

클라우드 실행 중 AI 생성·검수는 OpenAI API를 사용합니다. API와 호스팅의 실제 사용량은 각 제공자 계정에서 확인하세요.
