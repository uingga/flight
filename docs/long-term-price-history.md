# 장기 가격 기록

## 목적

`data/price-history.json`은 화면과 추천 계산에 쓰는 최근 14개 관측치만 유지한다. 장기 분석 데이터는 Git 저장소를 키우지 않도록 Supabase에 별도로 누적한다.

장기 기록은 다음 질문에 답하기 위한 내부 자산이다.

- 특정 노선에서 일정 가격 이하의 표가 얼마나 자주 나오는가
- 여행사와 출발 공항별 가격대가 어떻게 다른가
- 출발일까지 남은 기간에 따라 가격이 어떻게 변하는가
- DROP과 조건형 특가 알림 후보가 평소보다 실제로 저렴한가

## 저장 구조

### `flight_price_daily`

항공권별 일일 기록이다. 여행사, 노선, 출발·귀국일, 항공 시간, 표시 가격, 실제 판단 가격, 좌석 수를 저장한다.

- 같은 날짜와 같은 항공권은 새 행을 만들지 않고 최신 관측값으로 갱신한다.
- 땡처리닷컴의 `effective_price`에는 발권수수료 20,000원을 포함한다.
- `listed_price`도 별도로 남겨 표시 가격과 실제 판단 가격을 구분한다.

### `route_price_daily`

노선별 분석을 빠르게 하기 위한 일일 요약이다.

- `source = all`: 모든 여행사를 합친 노선 요약
- `source = 여행사 키`: 해당 여행사만의 노선 요약
- 최저가, 평균가, 항공권 수를 표시 가격과 실제 판단 가격 기준으로 각각 저장

### 항공권 생애 기록

일별 최종값과 별도로, 한 항공권이 나타나고 가격·좌석이 변하고 잠시 사라졌다가 다시 나타나는 과정을 보존한다.

- `flight_crawl_runs`: 여행사별 수집 성공·이전 데이터 보존·일부 실패와 수집량을 기록
- `flight_offer_current`: 안정적인 `offer_key` 기준으로 각 항공권의 최신 상태를 기록
- `flight_offer_events`: 최초 발견, 가격·좌석·노출·비교가 변화, 일시 미확인, 재등장, 판매 종료 추정 사건을 누적

네이버 비교가는 같은 공항·같은 날짜로 확인된 값과 확인 시각을 함께 저장한다. 비교되지 않은 항공권이 더 많으므로 값이 없는 다음 회차가 기존 비교가를 지우지 않으며, 네이버만 확인한 회차는 여행사 상품의 `마지막 발견` 시각과 판매 종료 판정을 움직이지 않는다. 직항 여부가 확실하지 않은 동안 공개 추천 근거로 확대 해석하지 않는다.

수집 실패나 수집량이 직전보다 크게 줄어든 회차는 항공권이 사라진 것으로 세지 않는다. 정상 수집에서 1회 안 보이면 `missing_once`, 3회 연속 안 보이면 `paused_estimated`, 72시간이 지나거나 출발일이 지났으면 `ended_estimated`로 기록한다. 이 기준은 첫 2주 표본 검토 뒤 조정한다.

모든 테이블은 RLS를 켜고 공개 클라이언트 권한을 주지 않는다. GitHub Actions의 service-role 키만 기록할 수 있다.

## 자동 실행

`.github/workflows/daily-crawl.yml`에서 정상 크롤링 뒤 `npm run archive:prices`를 실행한다. 하루 여러 번 실행되어도 기본키가 같아 행 수가 중복 증가하지 않으며, 그날의 최신 관측값으로 갱신된다.

같은 워크플로우는 이어서 `npm run record:lifecycle`을 실행한다. 마이리얼트립 별도 갱신도 성공한 조회 결과를 같은 기록기에 전달한다. 기록 단계는 `continue-on-error`로 격리되어 테이블이나 환경 설정에 문제가 있어도 항공권 수집과 배포를 막지 않는다.

로컬 구조 검증:

```bash
npm run archive:prices:dry
npm run record:lifecycle:dry
npm run test:lifecycle
```

## 최초 설정

Supabase SQL Editor에서 다음 마이그레이션을 한 번 실행한다.

```text
supabase/migrations/20260819_create_long_term_price_history.sql
supabase/migrations/20260824_create_flight_lifecycle.sql
supabase/migrations/20260829_grant_long_term_price_history_access.sql
```

테이블 생성 전에는 GitHub의 장기 기록 단계가 실패할 수 있으므로 워크플로우에서 `continue-on-error`로 격리한다. 기존 항공권 크롤링과 사이트 배포는 계속 정상 작동한다.
