# 자체 방문 기록 — 병행 검증 단계

2026-09-07 구현. 운영 DB 설치와 자동 정리 첫 실행 확인 완료. Vercel Production에 서버·클라이언트 활성화 값을 저장했으며, 새 코드 배포 후 병행 수집을 시작한다. 기존 GA4 기록·조회·통계는 변경하지 않는다.

## 해결하는 문제

GA4의 당일 출처별 행 합계가 차원 없는 전체 세션 합계와 다를 수 있다. 이를 임의 비율로 보정하지 않고, 자체 통계는 동일한 방문 원장 한 번의 SQL 스냅샷에서 전체·경로·행동을 계산한다. 이 단계에서는 어드민 `자체 방문 기록 검증`을 열 때만 별도 보고서를 요청한다. GA4 합계와 자체 합계가 같아야 하는 것은 아니다.

## 집계 정의

- 방문: 같은 브라우저에서 30분 미활동 또는 KST 날짜 변경 시 새 UUID. 새로고침·내부 이동·필터 변경은 방문을 새로 만들지 않는다. 첫 유입 경로는 해당 방문 동안 고정한다.
- 활동: 표시된 페이지의 최초 진입 및 pointerdown/keydown/scroll, 상세 열람, 예약 이동. 주기적인 타이머 방문은 만들지 않는다. 활동 시 로컬 시각만 갱신하고, 서버에 이미 전달한 방문·행동은 다시 보내지 않는다.
- 여러 탭: Web Locks와 localStorage로 같은 방문을 공유한다. Web Locks가 없으면 방문만 sessionStorage로 분리하므로 탭별로 다르게 집계될 수 있다. 서버 제약으로 데이터 중복은 막아도 동일한 실제 사람/탭 의미를 완벽히 복원하지는 못한다.
- 브라우저 인원: 임의 visitor UUID를 서버 HMAC으로 변환한 값의 distinct. 로그인 계정과 연결하지 않는다. 기기·시크릿 창·저장소 삭제는 별도 브라우저가 된다. 식별자는 생성 후 90일이 지난 다음 접속에서 교체한다.
- 상세·예약: 해당 방문에서 한 번이라도 발생했는지 기록한다. 항공권별 클릭 횟수나 엄격한 시간순 전환 퍼널이 아니다. 예약 이동이 먼저 도착해도 동일 방문을 생성하며, 상세가 없었다고 임의 생성하지 않는다.
- 전체 방문 = **모든** 경로의 방문 합. 상위 5개만 잘라서 전체처럼 표시하지 않는다. 경로별 인원은 재방문 시 겹칠 수 있으므로 합산하지 않는다.
- 자정 후 2분까지 전날 시작 기록의 지연 전송을 허용한다. 클라이언트 시계가 크게 틀리면 기록을 거절하며 과거 데이터를 보정하지 않는다.
- 공개 `/`, `/flights`, `/tips`, `/drop`, `/share`, `/share-group`, `/about`만 수집한다. `/admin`, `/preview`, `/api`, 개인정보처리방침·약관은 제외한다.

## 최소 수집 / 거부 / 남용 방지

- 저장: 방문 UUID, HMAC 브라우저 키, 방문 시각, 7개 중 하나인 경로 분류, 상세·예약 boolean. URL·원문 referrer·검색어·flight ID·계정 ID·IP 원문·브라우저 UA를 방문 원장에 저장하지 않는다.
- UTM와 referrer는 브라우저에서 분류에만 사용하고 전송하지 않는다. 여행사 필터 `source=myrealtrip`을 캠페인으로 읽지 않는다.
- 기존 `tikitikit_analytics_excluded` 설정을 공유한다. 개인정보처리방침에서 수집을 중지하면 GA4를 비활성화하고 자체 로컬 식별자를 지운다. 이미 저장된 서버 기록의 소급 삭제는 아니다.
- DNT/GPC·자동화 브라우저·숨겨진 최초 탭은 자체 수집에서 제외한다. 브라우저 저장소를 사용할 수 없으면 식별을 우회하지 않고 수집을 건너뛴다. 차단 확장 프로그램이나 브라우저의 수집 차단을 우회하지 않는다.
- POST는 동일 origin만, 운영은 www/non-www 실제 도메인만 허용한다. body 1KB 제한, 필드 allowlist, UUID/시각/종류 검증, 서비스 역할 RPC만 쓰며 RLS로 브라우저 직접 접근 차단.
- 별도 rate 테이블은 `날짜 + 접속 IP`의 서버 HMAC 키로 분당 120회 제한한다. 방문 원장과 연결하지 않으며 원문 IP는 저장하지 않는다. 이 값도 남용 방지를 위한 처리이므로 개인정보처리방침에 기재한다. Vercel이 제공하는 전달 IP 헤더를 신뢰하는 구조이며 다른 호스팅으로 옮기면 trusted proxy 정책을 재검토한다.
- UA/Origin/IP 제한은 완전한 봇 판별이 아니다. 분산 위조 트래픽까지 인증할 수는 없으므로 과도한 유입은 호스팅 방화벽과 함께 확인한다.
- 전송은 클릭을 기다리게 하지 않는 keepalive 요청. 한 페이지에서 같은 방문/행동은 최대 2회 시도, 같은 ID로 재시도, 서버 RPC 3초·클라이언트 4초 제한. 오프라인 영구 큐 없음. 실패는 누락으로 남을 수 있으나 예약 기능을 막지 않는다.

## 운영 설치 순서 — 별도 배포 승인 후

1. 기존 안전 배포 절차를 따른다. 현재 루트에는 다른 작업의 변경이 있으므로 이 작업 파일만 최신 main에 통합한다. 다른 작업의 `.next`를 빌드로 덮지 않는다.
2. Supabase SQL에서 `20260907_create_visit_analytics.sql` 적용. 기존 회원·GA4 테이블을 변경하지 않는다.
3. `20260907_schedule_visit_cleanup.sql` 적용. pg_cron이 없으면 **실패하도록 설계**했다. `cron.job` 등록과 실제 성공 실행을 확인하기 전에는 수집을 켜지 않는다. 원장은 90일, rate 키는 24시간 후 매시간 정리하므로 최대 1시간 정리 지연이 있다.
4. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 사용. 권장 별도 서버 비밀 `VISIT_ANALYTICS_SECRET`; 없으면 service role 키를 HMAC에 사용한다. 비밀 교체 시 과거와 브라우저 키가 달라질 수 있으므로 임의 교체하지 않는다. 비밀은 절대 NEXT_PUBLIC로 노출하지 않는다.
5. `NEXT_PUBLIC_VISIT_ANALYTICS_ENABLED=true` (빌드 시), `VISIT_ANALYTICS_ENABLED=true` (서버)를 **둘 다** 설정해 병행 수집 배포. 기본은 둘 다 꺼짐. 개인정보처리방침과 중지 버튼도 같은 배포에 포함한다.
6. 자체 생성 테스트 데이터를 운영에 보내지 않는다. 실제 방문이 들어온 후 어드민 검증 영역에서 최초 수집 시각, 합계 일치, 모바일 예약 정상, HTTP 429/503 비율, cron 실행을 확인한다.
7. 여러 날짜·재방문·자정 구간을 관찰한다. 손실률/활성화 시점 차이를 확인하고 운영자와 합의한 뒤 별도 변경으로 주 통계 전환. 자동 전환·자동 폴백으로 서로 다른 분모를 섞지 않는다.

중지: 서버 `VISIT_ANALYTICS_ENABLED=false`로 기록을 중지하고 클라이언트 플래그를 false로 재빌드한다. GA4는 그대로다. 기록 테이블을 삭제할 필요가 없으며 정리 작업은 유지한다.

## 검증

```sh
npm run test:visits
# 앱의 dependencies/lockfile은 건드리지 않는 로컬 SQL 테스트 런타임
npm install --prefix output/visit-test-runtime --no-save --package-lock=false --ignore-scripts @electric-sql/pglite
npm run test:visit-sql
npm run build
```

SQL 테스트는 운영 Supabase에 접속하지 않는 메모리 PostgreSQL(PGlite). 중복·역순·고정 경로·고유 브라우저 수·합계·ID 충돌·속도 제한·브라우저 역할 권한·보관 정리를 검증한다. 단일 로컬 엔진이므로 분산 부하/실제 pg_cron 운영 실행을 대체하지 않는다. HTTP 테스트는 DB 요청을 가로채며 브라우저 테스트는 loopback 서버만 사용한다.

### 2026-09-07 검증 결과 및 남은 전환 조건

- `npm run test:visits`, `npm run test:visit-sql`: 통과.
- 별도 복사본 `tmp/visit-analytics-verify-20260907`의 production build: 통과. 원래 개발 서버 `.next`는 건드리지 않았다. 기존 DROP 미리보기 CSS와 react-datepicker 경고가 있었다.
- 1440/390/320px 실제 빌드 어드민: 비활성 안내, 가짜 보고서의 합계 검증, 표 넘침 없음, 개인정보 설정의 수집 거부 유지 확인. 화면 캡처는 `output/visit-panel-*.png`이며 모두 테스트 수치다.
- `test:redesign`의 기존 실패 원인 확인: 통계 변경 전 HEAD에도 `[data-fresh-schedule-options]`가 없고 `openFreshFlight`는 같은 출발일 상품이 하나면 상세, 여러 개면 노선 결과를 열고 있었다. 또 PC 상세는 기존 `modal={!isDesktopViewport}` 설정인데 테스트가 PC 배경까지 잠기기를 기대했다. 화면 기능을 바꾸지 않고 테스트의 기대 동작을 현재 계약으로 수정했다.
- 별도 빌드에서 `npm run test:redesign -- http://127.0.0.1:3192/preview/mobile-redesign --fixture`: 모바일 320/390px, PC 1440px 핵심 흐름 통과. 모바일 스크롤 잠금, PC 목록에서 다른 상세 선택, 상세 링크/뒤로가기/공유 URL/필터 등을 확인했다. 로컬 캐시의 날짜만 메모리에서 미래로 옮긴 테스트 데이터이며 파일·운영 데이터는 변경하지 않는다. fixture 모드는 localhost에서만 허용하고 브라우저 외부 요청은 차단한다.
- 실제 데이터 모드에서는 마이리얼트립 0건 조건에 걸렸다. 변동하는 운영 데이터의 공급 여부와 화면 회귀를 분리하기 위해 fixture 옵션을 추가했으며, 기존 실제 데이터 모드의 확인 조건은 삭제하지 않았다. fixture 통과가 현재 운영 데이터 정상이나 활성화 상태의 종단간 수집 검증을 의미하지는 않는다.
- 운영 SQL 적용 완료. `tikitikit_visits`, `tikitikit_visit_rate_limits`의 RLS=true, anon 읽기/인증 브라우저 쓰기=false 확인. 정리 작업은 매시 25분, 첫 예약 실행은 2026-09-07 19:25 KST에 succeeded(약 4ms). 설치 당시 새 원장은 비어 있어 기존 데이터 삭제는 없다. 임시 매분 실행안은 안전 검사에서 차단되어 적용하지 않았다.
- Vercel Production 전용 `VISIT_ANALYTICS_ENABLED=true`, `NEXT_PUBLIC_VISIT_ANALYTICS_ENABLED=true` 저장 확인. 기존 Supabase 서비스 키를 사용하며 새 자격 증명을 만들거나 공개하지 않았다. 배포와 실데이터 관찰 결과는 아래에 기록한다.
- 운영 DB 읽기 전용 사전 검사: Tikitikit 프로젝트 `xhbhumrolldqswdmeypq`, `postgres` 실행 역할, 기존 pg_cron 1.6.4 확인. 사용자에게 새 기록의 영구 자동 삭제를 실행 직전 확인받은 뒤 설치했다.
- 작업 중 다른 변경이 `src/app/layout.tsx`의 폰트 설정에 들어왔다. 해당 변경은 이 작업에서 만든 것이 아니며 보존했다. 배포용 패치에서는 이 작업의 `VisitAnalytics` import/배치만 선별했다. 다른 작업의 미리보기·운영 데이터도 건드리지 않는다.
- 최종 배포본은 원격 main `1a12b3ea`에 통계 변경만 합친 독립 복사본이다. `test:visits`, PGlite SQL 검사, 클라이언트 수집 플래그를 켠 production build, 어드민/개인정보 320/390/1440px 검사, 최종 main 기준 `test:redesign --fixture` 모두 통과했다. 마지막 회귀 검사는 장식용 화살표가 aria-hidden인 현재 버튼의 접근 가능한 이름(`전체 항공권`)으로 바로잡았다. 기존 main의 접힌 인원 선택과 PC 상세 동작은 그대로 유지했다.
