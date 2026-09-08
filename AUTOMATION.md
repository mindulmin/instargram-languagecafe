# Language Cafe 카드뉴스 자동화

## 흐름

1. `jobs/new-carousel.template.json`을 복제해 새 작업 파일을 만든다.
2. `brand/language-cafe-mascot-v1/IDENTITY-LOCK.md`, `content-queue/CHARACTER-VISUAL-GATE.md`, `content-queue/VISUAL-SYSTEM-v2.md`, `content-queue/WEEKLY-INSTAGRAM-REVENUE-OPERATING-SYSTEM.md`를 읽고, 새 카드 HTML·문구 검수 규칙·내보낼 폴더를 작업 파일에 연결한다.
3. 아래 준비 명령을 실행한다. 9:16 마스터 8장(1080 x 1920), 피드 파생본 8장(1080 x 1350), 화면 잘림, 한국어와 실생활 영어 검수를 모두 통과해야 한다.
4. 게시할 내용이 맞을 때만 승인 명령을 실행한다.
5. 발행 명령은 승인된 작업만 올리고, 성공하면 작업 파일을 `published`로 바꿔 같은 작업의 재발행을 막는다.

## 명령

```powershell
npm.cmd run preflight -- --job jobs/<새-작업>.json
npm.cmd run approve-job -- --job jobs/<새-작업>.json
npm.cmd run publish-job -- --job jobs/<새-작업>.json
```

## 공개 이미지 호스팅 초기 설정

Catbox는 사용하지 않는다. 카드뉴스 실발행 때 검수된 PNG 8장을 원본 산출물로 보존하고, Instagram 수집 호환성을 위해 JPEG 공개 사본 8장을 Cloudflare Pages Direct Upload로 한 번에 배포한다. Graph API에는 검증된 고유 배포 호스트의 `pages.dev` JPEG URL만 전달한다. 프로젝트 별칭은 이후 배포에서 이전 카드 세트를 바꿀 수 있으므로 Graph API URL로 쓰지 않는다.

```powershell
npm.cmd run hosting:login
npm.cmd run hosting:status
npm.cmd run hosting:create
npm.cmd run hosting:test
npm.cmd run hosting:deploy-job -- --job jobs/<작업>.json
```

- `hosting:login`은 이 PC에서 한 번만 브라우저 OAuth를 완료한다. 토큰을 채팅이나 저장소에 붙여넣지 않는다.
- 기본 전용 프로젝트 이름은 `language-cafe-instagram-assets`다. 다른 프로젝트를 쓸 때만 `CLOUDFLARE_PAGES_PROJECT` 환경 변수를 설정한다.
- 게시 직전에 전용 고정 도메인의 `job ID + 카드 묶음 해시` 경로에서 8개 공개 JPEG를 실제 GET으로 다시 읽어 JPEG 형식·접근 가능 여부·스테이징된 JPEG와의 SHA-256 일치를 확인한다. 로컬 PNG 원본·피드 파생본은 그대로 보존한다. 하나라도 실패하면 Instagram 컨테이너를 만들지 않는다.
- 첫 Pages 배포의 DNS·캐시 전파를 최대 약 60초 기다린 뒤 검증한다. 전파 대기 중에는 Instagram API를 호출하지 않는다.
- `hosting:deploy-job`은 Instagram에 접촉하지 않고 공개 이미지 호스팅만 독립 검증할 때 사용한다.
- 결과는 카드뉴스 내보내기 폴더의 `public-image-hosting-report.json`에 기록한다.

## 자동으로 막는 것

- 9:16 마스터 8장이 1080 x 1920이 아니거나, 피드 파생본 8장이 1080 x 1350이 아닌 경우
- 9:16 마스터의 핵심 콘텐츠가 중앙 1080 x 1350 안전영역을 벗어난 경우
- V2 시각 검수에서 대화 장면, 구성 다양성, 세로 프레임 활용, 카드별 의미 단서 2개 이상, 평면 템플릿 미검출을 실제로 확인하지 못한 경우
- 기준 시트를 이미지 입력으로 쓰지 않았거나 캐릭터의 새싹·눈·비율·민트색·재질이 바뀌고 `characterReview`의 identity-lock 검사가 통과하지 못한 경우
- 카드 안의 글자나 요소가 잘린 경우
- 한국어 금지 문구 또는 검수 규칙을 통과하지 못한 경우
- 일상 영어 문맥 검수를 통과하지 못한 경우
- 공개 캡션에 `[한국어]`, `[영어]`, `[Korean]`, `[English]` 같은 언어 머리표시가 있거나, 언어 메타데이터에 `ko`, `en`이 함께 없는 경우
- 캡션 2,200자 초과 또는 해시태그 30개 초과
- 이미 발행된 작업의 중복 발행
- 최근 Instagram 카드뉴스에 정규화된 동일 캡션이 있거나, 같은 job의 게시 잠금이 이미 존재하는 경우
- 승인 상태가 없는 실발행

## 운영 원칙

- `content-queue/WEEKLY-INSTAGRAM-REVENUE-OPERATING-SYSTEM.md`는 기존 예약 주기를 대체하지 않는 주간 운영 오버레이다. 주차·표현별 증거는 `operations/instagram-weekly/YYYY-Www/<expression-id>/`에 분리해 덮어쓰지 않는다.
- 예약 실행 전에는 comment-feedback-signals.json을 읽고 선택 결과를 daily-selection.json에 남긴다. 두 개 이상의 서로 다른 수용된 직접 요청이 같은 ready 표현을 가리킬 때만 우선 후보가 되며, exact current-focus ready 매치가 항상 먼저다.
- 댓글 신호는 next expression 또는 real-scene request만 후보 근거가 된다. correction, praise, published, duplicate, blocked, 또는 non-ready 신호는 기록만 하고 새 job을 만들지 않는다. 댓글 원문과 작성자 식별자는 저장하지 않는다.
- 공식 읽기 권한이 있을 때만 댓글 신호를 읽기 전용으로 확인할 수 있다. 자동 댓글·답글·DM은 하지 않으며, 읽기 권한이 없으면 comment feedback은 unavailable로 남긴다. 한 표현 한 카드 원칙과 최종 duplicate 및 exact-once 관문은 그대로 적용한다.
- 추천 피드를 만들기 위한 자동 좋아요·저장·댓글·팔로우·시청 조작은 하지 않는다. 참고 수집은 읽기 전용 또는 사람이 직접 수행한다.
- 미처리 대화 시작·문장 저장 문제·지원 질문은 수와 근거를 확인해 전달서로 남긴다. 자동 DM·댓글·답장은 보내지 않는다.
- 조회·저장 수치는 전환 증거가 아니다. 무료 대화 첫 답과 문장 저장까지 관측되지 않으면 `unavailable`, `baseline_unavailable`, `unverified_priority`를 그대로 기록한다.
- 실제 발행 때만 Cloudflare Pages 공개 이미지 배포와 인스타그램 전송이 실행된다.
- 발행 성공 후 게시물 링크와 결과가 작업 파일 및 `status-memory.json`에 남는다.
- 고정 댓글 문구는 작업 파일에 함께 보관한다. 댓글 고정은 인스타그램 앱에서 마지막으로 확인한다.
- 지금은 안전한 수동 승인형 자동화다. 발행 요일과 시간을 정하면, 이 준비 단계만 정기 실행하고 실발행은 승인 대기 상태로 둘 수 있다.

## 카드뉴스 릴스

```powershell
npm.cmd run render-reel-test
npm.cmd run review-reel-test
```

- 매 카드뉴스 작업은 검수된 8장 PNG로 30초 세로 릴스를 함께 만든다. 카드는 잘리지 않아야 하며, 느린 줌·작은 이동·같은 카드 기반 흐린 배경·짧은 전환만 쓴다.
- 예외: `publish_one_learning_pair` handoff와 그 14일 학습 짝 action은 새 릴스를 만들거나 렌더링·재생성·업로드하지 않는다. 이 action의 범위는 공식 readback을 마친 Instagram 카드뉴스 1건과 Threads 텍스트 학습 짝 1건뿐이며, 기존 릴스 산출물은 `review_ready`, `autoPublish=false` 상태로 그대로 둔다.
- 릴스 MP4에는 인스타그램 음원을 넣지 않는다. 대신 `instagram-music-handoff.md`에 표현에 맞는 분위기와 검색 의도 3개를 적는다.
- 계정 소유자가 인스타그램 앱에서 실제 사용 가능한 음원을 고른다. 볼륨 또는 믹스가 보이면 5-10%에서 시작해 카드 글자가 잘 읽히는지 확인한다. 조절이 없거나 방해되면 무음으로 공유한다.
- 자동화는 릴스를 업로드하거나 `publish-reel.cjs`를 실행하지 않는다. 카드뉴스 API 게시와 릴스 인앱 게시를 분리해 중복·권리·계정별 음원 문제를 막는다.

## Instagram 원본 수업과 Threads 학습 짝 게시

Instagram 카드뉴스가 외국인 학습자를 위한 **완성형 한국어 표현 수업의 기준본**이다. Threads는 상품 광고나 사이트 판매 유입 글이 아니라, 공식 Instagram 읽기 확인까지 끝난 같은 표현을 짧게 다시 말해 보고 마지막에 그 시각 수업으로 돌아가는 **별도 텍스트 학습 짝**이다. Instagram 캡션을 복사하지 않고, 이미지도 붙이지 않는다.

```powershell
npm.cmd run prepare-threads-draft -- --source-carousel-job jobs/<공식-readback까지-통과한-발행-카드뉴스-job>.json
npm.cmd run prepare-threads-draft -- --source-carousel-job jobs/<카드뉴스-job>.json --dry-run
npm.cmd run review-threads-draft -- --job content-queue/threads/jobs/<Threads-job>.json
npm.cmd run test:threads-draft
npm.cmd run publish-threads -- --job content-queue/threads/jobs/<Threads-job>.json
npm.cmd run publish-threads -- --job content-queue/threads/jobs/<Threads-job>.json --publish
npm.cmd run test:threads-publish
```

- 실행 전 원본 카드뉴스 job의 `workflow.status`가 `published`이고 `naturalKoreanReview`, `globalLearnerReview`, `distributionReview`, 공식 post-readback이 모두 통과해야 한다. 하나라도 확인되지 않으면 Threads 초안을 만들지 않는다.
- 생성기는 `content-queue/threads/jobs/`에 한 표현당 하나의 `approved` job과 자동 검수 근거를 저장한다. `workflow.autoPublish=true`, `manualPostDecisionRequired=false`, `standingDirectPostAuthorization=true`를 기록하지만 준비 단계 자체는 API를 호출하지 않는다. 선택 원본·Google Sheet 상태·카드뉴스 job·Instagram job도 수정하지 않는다.
- 본문은 180–480자를 목표로 하며 500자를 넘지 않는다. 순서는 자연스러운 영어 상황 → 한글 목표 표현 한 줄 → 짧은 영어 뜻 → 3분 회상 → 마지막 한 줄 `Review the full visual lesson on Instagram → <공식 carousel permalink>`다.
- `strategyVersion=instagram-study-companion-link-v2`, `externalLinkCount=1`, `linkTargetType=source_instagram_permalink`만 허용한다. URL은 원본 job의 공식 `CAROUSEL_ALBUM` readback permalink와 정확히 같아야 하며, HTTPS `www.instagram.com/p/...` 형식이고 UTM·추가 query·fragment가 없어야 한다. URL 0개·2개 이상·다른 host·HTTP·bare domain·v1 job은 차단한다.
- controller는 permalink를 Instagram 게시 전에 알 수 없으므로 `threadsApprovedLinkTarget`을 미리 채우지 않는다. 대신 `threadsLinkTargetBinding=derive_exactly_from_official_instagram_readback`을 요구하고, readback 뒤 생성기가 실제 permalink를 `controlBinding.sourceLinkTarget`에 고정한다. 게시기는 source job을 잠금 전과 후에 다시 읽어 이 값과 정확히 일치하는지 확인한다.
- 명시적 link attachment나 preview 옵션은 요청하지 않는다. 본문 URL로 Threads가 preview를 자동 표시할 수 있으므로 job과 영수증에는 `threadsExplicitLinkAttachmentRequested=false`, `threadsPlatformPreviewState=unavailable_platform_managed`를 기록한다. 자동 preview가 없었다고 추정하지 않는다.
- 현재 영어 상품 홈은 한국어 학습 연장 목적지로 승인하지 않는다. `owned_practice_landing`은 HTTPS allowlist, 정확한 UTM 4개, 한국어 학습 정렬과 공식 readback 승인이 모두 있더라도 현 v2 source-link 전략에서는 신규 생성·게시를 차단한다.
- 결제·가격·checkout·landing·UTM·수익 실험 상태는 이 학습 짝의 생성 또는 게시 허가 조건이 아니다. 게시 허가는 Instagram 기준 수업의 정확한 원본, 공식 읽기 확인, 콘텐츠 검수, 중복·잠금·멱등성 검증으로만 판단한다.
- 이미 같은 표현 ID 또는 정규화한 동일 본문이 로컬 Threads queue에 있으면 중단한다. 같은 표현을 여러 Threads 초안으로 늘리지 않는다.
- 게시기는 기본 드라이런이다. 실제 API 호출은 `--publish`를 명시했을 때만 가능하며, `C:\Users\earth\.codex\threads\session.json`에 별도 Threads 사용자 ID와 게시 토큰이 있어야 한다. Instagram 세션을 Threads 세션으로 간주하지 않는다.
- 실제 게시 전 `published` 영수증, 원자적 per-job lock, 로컬 중복, 공식 최근 Threads의 동일 전문·목표 한글 표현을 다시 확인한다. TEXT 컨테이너 생성과 publish 호출은 각각 정확히 한 번만 실행한다.
- 타임아웃·연결 오류·모호한 종료는 자동 재시도하지 않는다. 공식 최근 미디어에서 결과를 확인할 수 없으면 job을 blocked로 남기고 lock을 보존한다. 공식 permalink와 전문이 정확히 한 건 확인되고, 영수증에 source-link target, `threadsExternalLinkCount=1`, `threadsExplicitLinkAttachmentRequested=false`, `threadsPlatformPreviewState=unavailable_platform_managed`가 기록된 뒤에만 `published`를 기록한다.
- 기존 `threads-exposure-v1-20260830` 코호트는 새 글을 더 등록하지 않는다. 이미 저장된 코호트와 24/72시간 공식 수치는 과거 증거로 보존하고, 남은 후속 수집은 읽기 전용으로만 수행한다.
- 댓글·답글·DM·프로필 변경·좋아요·팔로우·저장 조작은 구현하지 않는다. `publish-reel.cjs`도 실행하지 않으며 릴스는 `review_ready`, `autoPublish=false`를 유지한다.

## Content Desk 작업대

```powershell
npm.cmd run workstation
```

- 브라우저에서 `http://127.0.0.1:4178`을 연다.
- 작업대는 실제 job JSON, 카드 원본, 릴스 job, 자동화 상태를 읽어 카드뉴스 게시 여부와 카드뉴스 릴스의 인앱 음원 단계를 한 화면에 보여준다.
- `상태 새로고침`은 로컬 파일의 최신 상태를 다시 읽는다. 이 화면은 릴스를 게시하거나 인스타그램 음원을 자동 선택하지 않는다.
- 다계정 서비스 준비 구조와 출시 단계는 `workstation/MULTI-TENANT-SERVICE.md`에 기록한다. 현재 `service/card-desk.sqlite`은 Language Cafe 실데이터 워크스페이스와 고객 온보딩 워크스페이스를 분리한다. 실제 고객 로그인·OAuth 토큰·결제 정보는 아직 이 로컬 데이터베이스에 저장하지 않는다.
