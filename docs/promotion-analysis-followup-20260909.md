# 홍보 성과 집계 보완 후 이어 할 비교 분석

사용자 요청: 집계 연결·갱신 표시를 먼저 보완한 뒤 원래 계획한 Threads·TE31 글별
사이트 유입 → 상세 열람 → 예약 이동 비교 분석을 이어 한다. 배포는 별도 승인 후 진행한다.

## 작업 위치와 기준

- 작업 디렉터리: `tmp/promotion-insights-fix-20260909` (루트의 다른 변경과 분리한 임시 복사본)
- 기준 커밋: `aa97c713da54db781c4cbd88565c8ee3678607a1` (`origin/main`)
- 운영 데이터·수집·스케줄러·실제 게시글은 변경하지 않았다.
- 9/9 사용자 배포 승인을 받았다. 최신 운영 `f8ea5031b48928c508387e3f13e97a13dc860e56`에
  변경 파일 충돌이 없음을 확인하고 별도 `tmp/deploy-promotion-insights-20260909`에 적용했다.
  빌드·집계 회귀 테스트 통과. 배포 전 안전 지점은 `safe/20260909-1744`다.
- 소스 변경: `src/lib/threads-tracking.ts`, `src/lib/threads-post-links.ts`,
  `src/lib/server/threads-insights.ts`, `src/app/api/threads-insights/route.ts`,
  `src/components/AdminAnalyticsFreshness.tsx`, `src/components/AdminThreadsPosts.tsx`,
  `src/components/AdminTe31Posts.tsx`, `src/app/admin/page.tsx`.
- 테스트 변경: `scripts/test-threads-reply-tracking.cjs`, `scripts/test-promotion-insights.cjs`,
  `scripts/test-admin-threads-posts-ui.mjs`, `scripts/test-te31-posts-ui.mjs`.
- 문서: 이 문서와 `docs/threads-insights.md`.

## 운영에서 확인한 기준값 (9/9 17:20 KST 조회)

| 게시글/링크 | 사이트 방문 인원 | 상세 인원 | 예약 이동 인원 |
| --- | ---: | ---: | ---: |
| TE31 9/8 부산 특가 5곳 / `tikitikit_te31_pus-260908` | 7 | 1 | 0 |
| TE31 9/1 푸꾸옥 / `tikitikit_te31_pqc1438` | 3 | 0 | 0 |
| Threads 9/8 타이중 / `share_xmodetour-CHI-20107439` | 1 | 1 | 0 |
| Threads 9/1 푸꾸옥 / `share_group_pqc1438` | 2 | 0 | 0 |
| Threads 글 연결 미확인 / `share_xmodetour-manual-z3zer8` | 2 | 2 | 0 |
| TE31 글 특정 불가 / `tikitikit_te31` | 3 | 0 | 0 |

Threads 2개 글은 글별 표가 비어 있어 링크별 집계에서 확인한 값이다.
타이중 부모 글 `DdAzc1RD1sp`와 본인 댓글 `DdAzdN9j4m3`의 정확한 공유 URL을
Threads 원문에서 확인했다. 이 열람으로 Threads 자체 조회수에 1회가 더해졌을 수 있다.
공유 링크를 통해 사이트를 열거나 새 사이트 이벤트를 만들지는 않았다.
푸꾸옥 `/t/g-pqc1438` 운영 HEAD 응답의 `utm_content=share_group_pqc1438`도 확인했다.

## 배포 승인 후 순서

1. 변경 파일만 최신 운영 기준에 적용하고 빌드·안전 지점 확보 후 승인 범위대로 배포한다.
2. 운영 글별 표에서 타이중과 푸꾸옥 연결 결과를 확인한다. 수치를 하드코딩하지 않는다.
3. 댓글 자동 조회 실패의 세부 상태가 표시되면 권한/토큰/일시 오류 여부를 확인한다.
   현재 원인 세부는 운영 코드가 오류를 숨겨 확정하지 못했다. 확인 등록은 이 장애 자체를 고치지 않는다.
4. 같은 기간·같은 지표로 글별 결과를 다시 조회하고, 조회 시각과 당일 잠정치를 표시한다.
5. 읽을 수 없는 값은 0으로 만들지 않는다. 오래된 TE31 글 3개는 추적 불가로 별도 분리한다.
6. 공유 링크의 다른 채널 재사용 및 사람 중복, 공유 진입에서 상세 자동 열림을 해석에 반영한다.
7. 게시 후 경과 시간이 다른 소표본이므로 채널 승자를 단정하지 않는다. 부산 모음 글과
   단일 특가 글이 만든 실제 탐색·예약 이동을 비교하고 다음 콘텐츠 실험을 제안한다.

예약 이동은 외부 여행사 페이지로 나가는 행동이며 결제·예약 완료가 아니다.
TE31 조회/댓글/추천은 9/8 19:40 수동 관측값이므로 현재 사이트 방문과 나눠 CTR을 계산하지 않는다.
