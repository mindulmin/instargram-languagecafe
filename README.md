# Language Cafe Instagram publisher

한국어 표현 8장 캐러셀과 같은 표현의 Threads 복습 글을 운영하는 독립 저장소입니다.

GitHub Actions의 **Language Cafe scheduled publisher**가 매일 한국 시간 오전 9시에 GitHub Windows 서버에서 실행됩니다. PC나 Codex 앱을 켜 둘 필요가 없습니다. GitHub의 예약 실행은 지연될 수 있습니다.

이 설명은 게시 실행 서버에 해당합니다. 매일 새 게시 지시를 발급하는 컨트롤러는 아직 로컬 Codex 작업이므로, 현재 상태에서는 PC를 끄고 콘텐츠 선정부터 게시까지 전 과정을 자동 운영할 수 없습니다.

2026-09-08 확인: GitHub 서버 점검과 안전성 테스트는 통과했지만 `CLOUDFLARE_API_TOKEN`이 미등록이고, 클라우드 게시 지시는 2026-09-05의 `postDue=false` 상태입니다. 실제 게시를 시작하려면 [Actions Secrets](https://github.com/mindulmin/instargram-languagecafe/settings/secrets/actions)에 전용 이미지 업로드 토큰을 등록하고, 검증된 새 게시 지시를 클라우드에 반영해야 합니다. 날짜나 승인 상태만 바꿔 게시를 강제하지 마세요.

현재 게시 계약이 유효하지 않거나 `postDue=false`이면 게시하지 않습니다. 예약 실행 성공과 실제 게시 성공은 별개입니다. Actions 실행 요약에서 실제 상태를 확인하세요.

- [예약 실행과 수동 점검](https://github.com/mindulmin/instargram-languagecafe/actions/workflows/language-cafe.yml)
- [서버 설정과 운영 절차](cloud/README.md)
- [게시 계약](content-queue/AUTOMATION-CONVERSION-PUBLISHER.md)

인증 정보는 GitHub Secrets에, 게시 이력·큐·미해결 잠금은 AES-256-GCM으로 암호화한 `cloud-state` 브랜치에 보관합니다. 공개 저장소에 세션·API 키·원본 운영 로그를 커밋하지 마세요.

클라우드 실행 중 AI 생성·검수는 OpenAI API를 사용합니다. API와 호스팅의 실제 사용량은 각 제공자 계정에서 확인하세요.
