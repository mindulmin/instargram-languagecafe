# 한국어 학습 계정: 수업 → 복습 → 재방문

2026-09-11 기준. 수익은 아직 검증되지 않았다. 도달·저장·공유는 관심 지표이며 구매나 학습 성취가 아니다.

## 연결한 운영

1. **Instagram 본편**: 외국인이 바로 쓸 한국어 표현을 상황·뜻·사용 구분·발음·복습으로 완결한다. 첫 카드에서 실제 상황과 배울 표현을 보여 준다. 기존 원본성·워터마크·낚시성 문구 검사도 그대로 적용한다.
2. **Threads**: 같은 표현을 글로 복습하고 마지막에 공식 Instagram 본편 링크 1개를 제공한다. 사이트 판매 링크로 바꾸지 않는다.
3. **Story**: 본편과 Threads 성공 뒤 한 장의 1080×1920 복습 이미지. 한 상황, 목표 표현, 짧은 영어 뜻, 프로필의 전체 수업 안내를 넣는다. 새 이미지와 검수 기록이 없으면 올리지 않는다. API 게시 실패는 재시도하지 않고 이미지와 실패 근거를 보관한다.
4. **반응 수집**: 매 실행 최근 캐러셀 3개의 도달(reach), 저장(saved), 공유(shares)를 공식 API에서 각각 읽어 `growth-insights.json`에 남긴다. 미지원·권한 부족·누락은 unavailable이며 0으로 바꾸지 않는다. 보고서는 GitHub 실행별 artifact에 30일간 보존한다.

14일 최대 캐러셀 3건, 최소 72시간 간격. Story는 pair당 최대 1장. Story를 새 계정 대량 노출의 보장 수단으로 취급하지 않고 기존 수업 재방문 가설로 운영한다. 최소 3개 수업의 수치가 쌓이면 상황·첫 카드·복습 문구 중 한 요소만 바꿔 비교한다. 작은 표본에서 승자를 단정하지 않는다.

## 공식 지원과 수동으로 남긴 부분

- Facebook Login 기반 Instagram API는 Stories 게시를 Business 계정에 한해 지원한다. 계정 전환이나 권한 확장은 자동으로 하지 않는다. API 거절 시 자동화는 안전하게 멈추고 수동 업로드용 파일을 보관한다.
- 클릭 가능한 링크·투표·퀴즈 스티커는 이번 구현에서 지원한다고 가정하지 않는다. 이미지 속 안내는 클릭 가능한 스티커가 아니다. 필요한 경우 계정 소유자가 Instagram 앱에서 원본 수업 링크 스티커를 붙인다.
- 계정 소개의 현재 `Speak Engilsh | Studio mindulmin`은 한국어 학습 방향과 불일치한다. **수정 제안**: `Learn Korean for real-life moments. Visual lessons + quick recall practice. Made by Studio mindulmin.` 프로필은 변경하지 않았다.
- Instagram 앱의 Account Status에서 추천 자격을 확인하고, 대표 입문 수업을 고정하는 작업은 수동 점검 항목으로 남긴다. API로 추천 자격이나 고정을 검증했다고 주장하지 않는다.
- 자동 좋아요·팔로우·댓글·DM·시청 조작, 무관한 해시태그, 광고 집행, 무단 리포스트를 하지 않는다. Reel은 기존 별도 사람 검수 경계를 유지한다.

## 근거

- Meta [Content publishing / Media reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md): STORIES 컨테이너와 게시 경로.
- Meta [Facebook Login limitations](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login.md): Business 계정의 Story 게시 제한.
- Meta [Media insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights.md): 공식 반응 수치. 권한·미디어 유형별 지원 차이를 보존한다.
- Meta [2026 AI Drives Performance](https://about.fb.com/news/2026/01/2026-ai-drives-performance/amp/): Instagram 추천에서 원본 콘텐츠 비중을 높인다는 플랫폼 설명. 이 계정의 노출 증가 예측은 아니다.
- Meta [Recommendation Guidelines](https://about.fb.com/news/2020/08/recommendation-guidelines/): 공개 가능한 콘텐츠와 추천 대상 콘텐츠의 기준이 다르다.

## 운영 확인

`controller.json`: 선정·차단 이유. `preflight.json`: 게시 허가와 누락 조건. `growth-insights.json`: 반응만. `checkpoint.json`: pair의 실제 결과. `story.json`: Story의 별도 결과. 초록색 workflow 결과만으로 게시 성공이라고 보고하지 않는다.
