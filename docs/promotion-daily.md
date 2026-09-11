# 일별 홍보 성과 운영

매일 09:00 Asia/Seoul에 Supabase Cron이 짧은 서버 진입점을 호출하고, GitHub Actions가 최대 20분 동안 작업을 조정·저장한다. Threads·GA4는 Vercel의 기존 sensitive 비밀값을 그대로 사용하는 원격 소스 엔드포인트에서 수집하고, TE31는 GitHub에서 목록만 읽는다. 기존 Vercel 비밀값을 조회·추출·복제하지 않는다. 부모가 Fluid 활성화와 Hobby maxDuration 300초 지원을 확인했다. GitHub 실행 대기 때문에 **수집 완료 시각까지 09:00 정각을 보장하지 않는다**. PC는 필요 없다.

## 배포 전 부모 작업자 설정

1. `supabase/migrations/20260911_create_promotion_daily.sql`, 이어서 `20260911_create_promotion_remote_claims.sql` 적용. 기존 일별 전용 4테이블/4RPC에 원격 소스용 `promotion_remote_claims`와 `promotion_claim_remote_source`를 추가한다. 원본 저장 SQL은 이번 보완에서 수정하지 않았다. RLS 활성화, anon/authenticated/public 권한 없음, service_role 전용. 기존 항공권·계정 테이블 변경 없음.
2. Vercel: 기존 `ADMIN_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GH_PAT`와 새 `PROMOTION_JOB_SECRET`(충분히 긴 임의 값). GH_PAT은 `uingga/flight` Actions 쓰기 권한 필요. 새 인증은 `Authorization: Bearer ...` 헤더만 받는다.
3. GitHub Actions secrets: 이미 있는 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`와 **새 `PROMOTION_JOB_SECRET`만 필요**. 이 새 비밀값을 Vercel에도 동일하게 설정하며 기존 dispatcher 인증과 공유한다. `THREADS_ACCESS_TOKEN`, `GA4_PROPERTY_ID`, `GA4_CLIENT_EMAIL`, `GA4_PRIVATE_KEY`는 기존 Vercel 값만 사용한다. GitHub로 복제하거나 원문을 확인하지 않는다.
4. 부모가 제공한 TE31 페이지 1 원본(HTTP 200, 88,344 bytes, 2026-09-11T05:19:59.813919Z)으로 검증했다. 원본은 HTTP `text/html`에 charset이 없고 HTML meta가 `euc-kr`인 CP949 호환 바이트다. UTF-8 원본이 아니다. 정제된 실제 fixture와 원본/행별 SHA256은 `scripts/fixtures/te31-listing-page1.euc-kr.{html,meta.json}`에 있다. 5235 조회114/댓글1, 5232 조회133/댓글0, 5211 조회179/댓글5를 파싱한다. 5232의 0은 확인된 9셀 표 구조에 실제로 존재하는 빈 댓글 셀만 의미한다. 셀 누락·형식 변경은 미확인이다. 추천 컬럼은 없어 미확인으로 유지한다. 이번 작업에서 새 네트워크 요청은 하지 않았다. 남은 3개 등록 ID는 페이지1에 없으므로 부모가 필요시 나머지 목록 페이지를 제한적으로 확인한다. 준비 후 repository variable `PROMOTION_TE31_LISTING_VERIFIED=1` 설정. 미설정은 요청 없이 지원 전 상태를 유지한다.
5. GA4 report metadata의 timeZone이 `Asia/Seoul`인지 제한된 조회로 검증. 다른 시간대/누락 메타/샘플링/임계치 적용/행 상한 초과는 채택하지 않는다.
6. 안전 지점·빌드 등 기존 배포 절차는 부모 작업자가 수행. 이 작업에서는 커밋/푸시/배포/운영 조회/마이그레이션/예약 설정을 실행하지 않았다.

## 진입점과 예약

- 실행: `npx tsx scripts/collect-promotion-daily.ts`. `PROMOTION_LIVE_RUN=1` 필수. 선택 `PROMOTION_RUN_DAY=YYYY-MM-DD`는 현재 KST 날짜와 일치해야 한다. dotenv 자동 로드 없음.
- 워크플로: `.github/workflows/promotion-daily.yml` (`workflow_dispatch`). 고정 main checkout, read-only repository 권한, 동일 작업 concurrency, 23분 timeout. CLI 자체 20분 timeout, DB lease 25분.
- 서버 요청: `POST https://www.tikitikit.kr/api/internal/promotion-daily`, `Authorization: Bearer <PROMOTION_JOB_SECRET>`. 요청 본문/URL로 대상이나 날짜를 지정할 수 없다. 고정 GitHub 저장소/워크플로만 호출한다.
- 원격 소스: `POST https://www.tikitikit.kr/api/internal/promotion-source`, 같은 Bearer 헤더, JSON `{ "source": "threads" | "ga4", "day": "현재 KST YYYY-MM-DD", "runId": "claim한 UUID v4" }`. query/추가 필드/임의 소스/URL은 거부한다. 본문 512 bytes, 헤더 인증 후 검증. DB의 실행 ID·running·잔여 lease 240초 이상 및 소스별 최초 claim을 확인한다. GA4는 같은 회차의 저장된 Threads 결과가 있어야 시작하며, 그 결과의 최대 30개 게시글만 링크 연결 대상으로 사용한다. 전달된 게시글/URL/인증정보를 입력으로 받지 않는다.
- 원격 함수 `maxDuration=300`, 요청 시작부터 소스 작업 예산 **220초**, DB 후확인 최대15초 여유. 각 외부 요청은 15초와 남은 소스 예산 중 작은 값으로 abort하고 다음 요청 직전에도 예산을 확인한다. timeout Promise.race로 수집을 방치하지 않는다. Threads/GA4는 이미 완료된 관측을 partial로 보존한다. GitHub는 고정 www origin만 호출, redirect 거부, 250초/2MB 제한, source/day/run ID/지표/URL/숫자/시각의 응답 계약 검증, 재시도 없음. 서버 응답은 명시적 데이터 DTO만 포함한다.
- Supabase Dashboard Jobs: cron `0 0 * * *` (UTC = 09:00 KST), 위 POST/헤더 설정. `docs/crawl-watchdog.md`와 같은 pg_cron/pg_net 운영 기반. 루트 도메인 대신 최종 www 주소를 사용한다. 자동 같은 날 재시도 없음.
- 관리자 읽기: `GET /api/admin/promotion-daily?days=30`, `Authorization: Bearer <ADMIN_KEY>`. 1~90일, private/no-store, GET만 구현. 소스의 최신 정상값은 기간 밖에서도 유지된다.

## 저장과 실패 의미

- DB 현재 시각으로 KST 날짜를 확인하고 advisory lock + 날짜 PK로 중복/경합을 막는다. 실행 ID와 25분 lease를 검증한 트랜잭션으로 소스별 원본 관측 및 latest를 함께 저장한다. 같은 날 완료·미완료 회차를 자동 재실행하지 않는다.
- 3개 소스 모두 success일 때만 회차 complete. partial/failed/unsupported 또는 저장 중단은 incomplete. 프로세스가 죽으면 running 행을 남기되 읽기에서 25분 이후 미완료 표시, 다음 날 claim에서 실제 상태 정리. 만료된 이전 프로세스는 저장/완료할 수 없다.
- 원격 소스 claim은 `(day,source)` 유일키와 실행 행 잠금으로 동시 호출/재전송을 막는다. 응답 유실·Vercel 종료 후 자동 재시도하지 않는다. GitHub가 명시적 실패를 기록하고 이전 정상값을 유지한다. 최종 DB lease 확인에 실패한 원격 응답도 채택하지 않는다. GA4의 해당 회차 Threads 결과가 비어 있으면 Threads 글별 연결을 새로 추측하지 않고 TE31만 조회 결과에 연결한다.
- 예약 전달도 별도의 날짜 claim으로 중복 호출을 막는다. 네트워크 응답 불명/실패 시 claimed/failed 기록을 남기며 자동 재전송하지 않는다. 관리자에서 시작 기록 없는 예약 요청을 확인할 수 있다. 필요시 부모 운영자가 외부 수집 시작 여부를 확인하고 workflow_dispatch를 직접 사용한다. 실제 수집 claim은 같은 날 1회만 허용한다.
- `promotion_daily_sources.payload`는 해당 회차에서 확인된 metric만 저장한다. latest에는 metric별 마지막 확인값과 observedAt/day를 병합한다. 실패·누락은 0으로 채우지 않는다. source.lastSuccessAt은 source 전체 success일 때만 바뀐다. 전날 차이는 각 metric.day 바로 전날의 실제 관측만 비교한다. 공백 날짜를 건너뛰거나 첫날 0을 만들어 비교하지 않는다.
- GA4는 날짜 차원으로 어제~3일 전의 실제 일별 수치를 6개 보고서로 확인한다. 최근 보정은 매일 history에 남기고 같은 날짜의 가장 최근 관측을 비교에 사용한다. 오래된 날짜 보정은 더 최근 날짜의 latest를 덮지 않는다. 데이터가 없는 행/이벤트는 확인 불가이며 0으로 추정하지 않는다. 최근 3일도 잠정치이고 더 늦은 반영은 자동 보정 범위 밖이다.
- Threads 최근 30개 글 목록 1회 + 글별 30회 이하 + 본인 답글 3페이지 이하. 기존 본문/본인 답글/확인 등록 연결 함수를 재사용한다. 누락·다중 링크를 추측하지 않는다. shares 등 미제공 지표는 null 취급으로 부분 확인. 실패 글과 최근 30개 밖의 옛 글은 이전값/관측 시각 유지.
- TE31는 고정 `https://te31.com/rgr/zboard.php?id=freead&page=1..3` 목록만 최대 3회, 페이지 사이 5초. 등록 6개 ID만 채택. 기사 view.php를 요청하지 않는다. strict hostname/path/query allowlist, redirect 거부, 15초/2MB 제한. HTTP/HTML meta의 allowlist charset(UTF-8, EUC-KR/CP949)만 TE31에서 해석하고, 선언 충돌·깨진 바이트는 실패 처리한다. 주석 셀을 헤더/본문 모두에서 제거한다. 401/403/429/CAPTCHA는 즉시 소스 중단, 재시도 없음. 목록에 없는 오래된 글은 부분 확인 및 기존 값 유지. 추천 컬럼이 없으면 추천은 미지원/확인 불가이며 수집 성공한 지표로 주장하지 않는다.
- 기존 TE31 `source=te31`+정확한 campaign, Threads share content 전체 유입 및 Threads 확인 출처를 유지한다. 공유 링크는 타채널/타글과 겹칠 수 있고 방문 인원을 글 사이 합산하지 않는다. 예약 이동은 구매가 아니다. 과거 공통 TE31 campaign은 특정 글에 배정하지 않고 기존 표의 별도 집계를 유지한다.

## 확장과 검증

새 플랫폼은 `PromotionAdapter`와 명시적 registry/허용 엔드포인트/지표 이름을 추가하고, `PROMOTION_SOURCES` 및 DB RPC의 완료 대상 목록을 함께 확장한다. UI는 공통 SourceResult/Metric 계약으로 렌더링한다. 어댑터 없는 소스는 unsupported이며, 임의 블로그 URL 자동 수집 기능은 없다.

로컬: `npm run test:promotion-daily` (기존 핵심 20 + 원격/실제 TE31 표본 테스트), 기존 `test-threads-reply-tracking.cjs`, `test-threads-reply-diagnostics.mjs`, `test-promotion-insights.cjs`, `test-te31-posts.cjs`. fixture UI는 로컬 preview 환경에서 `scripts/test-promotion-daily-ui.mjs` 및 기존 Threads/TE31 UI 검사. 실제 목록 표본은 `npx tsx scripts/validate-te31-listing.ts <원본 바이트 HTML 파일>`로 요청 없이 검사한다. 이미 UTF-8로 변환한 파일은 meta도 UTF-8로 바꾼 경우에만 입력한다.

SQL은 정적 계약 검사와 메모리 저장소의 runner 경합/중복 테스트를 포함한다. 실제 PostgreSQL의 권한·동시 claim·lease fencing은 migration 적용 후 부모가 검증해야 한다. Supabase를 사용할 수 없으면 JSON 파일로 조용히 폴백하지 않고 저장 실패를 표시한다. 서버리스 동시 실행에서 동일한 내구성·원자성을 보장하는 다른 저장소가 확정되면 PromotionStore 구현만 교체한다.
