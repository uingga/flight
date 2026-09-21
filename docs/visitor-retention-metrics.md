# 방문·재방문 지표 정정 (2026-09-21)

## 정의

- 기간별 방문자·일별 방문자·신규/재방문 행동 비교 분모는 GA4 `totalUsers`로 통일한다. 행동 분자도 `totalUsers`다.
- `newVsReturning`은 기간 중 동일인이 두 행에 포함될 수 있다. 두 행의 합을 분모로 한 비율은 폐기한다. 호환용 `returning.*.rate`는 null이다.
- 대표: 첫 방문 다음 날부터 7일까지 적어도 한 번 새 세션을 시작한 사람 / 해당 첫 방문자.
- 보조: 위와 동일하되 30일까지. 당일 새로고침/같은 날 재방문은 제외한다. 예약 이동은 구매가 아니다.
- 각 지표는 어제까지 관찰 기간을 모두 채운 **최근 30개 첫 방문 날짜**를 사용한다. 두 지표의 모집 기간은 다르며 화면에 날짜·분자·분모를 모두 표시한다.
- 예: 2026-09-21 조회, 7일 지표는 8/15–9/13 첫 방문자, 30일 지표는 7/23–8/21 첫 방문자. GA4 속성 시간대 기준이다.

## 구현

`firstSessionDate`로 첫 방문 집단을 고정하고 `session_start`의 `totalUsers`를 집계한다. 첫 방문 날짜별 재방문 창 전체를 한 보고서로 요청한다. 날짜별 사용자 수를 더하지 않는다. 서로 다른 첫 방문 날짜 집단만 합산한다.

`/api/ga-retention`은 기존 어드민 비밀키를 헤더로 검사한 뒤 GA4 읽기만 한다. 수집·예약·DB 변경 없음. 다른 어드민 통계를 막지 않도록 별도로 로딩한다. 빈 표본/조회 실패/임계치 적용/샘플링/분자 초과는 0%로 위장하지 않는다.

61개 보고서를 최대 5개씩 배치, 배치 동시성 2로 요청한다. 결과는 속성·날짜·시간대별 서버 인스턴스 내 6시간 캐시 및 중복 요청 병합. 인스턴스 간 공유 캐시는 아니므로 서버리스 재시작 시 재조회된다. 실패 후 자동 반복 요청 없음. API quota/처리 지연은 배포 후 확인 필요.

GA4는 실제 사람의 완전한 식별이 아니다. 쿠키 삭제·다른 기기·동의 거절·광고 차단·GA4 처리 지연에 따른 누락/변동이 있다. 과거 전체 사용자를 별도 개인식별 저장소로 복원하지 않는다. 기존 신규/재방문 행동 표는 첫 방문 코호트 전환율과 별개다. 공유 링크 자동 상세 열기는 이번에 분리하지 않는다.

## 검증

- `node node_modules/tsx/dist/cli.mjs --test scripts/test-ga-retention.ts`: 외부 fetch를 합성 응답으로 대체, 실제 API GET/배치 경로 포함.
- `node node_modules/typescript/bin/tsc -p tsconfig.ga-retention.json`: 변경 경로 및 어드민 전체 의존성 타입 검사.
- 최종 결과: 오프라인 테스트 7개 통과/0개 실패(exit 0), 범위 타입 검사 exit 0. 초기 테스트 표본 기대치 오류와 테스트 환경의 Next 전용 모듈 처리를 정정한 후 재실행했다.
- 선택적 실제 GA4 읽기 계약 확인: `node node_modules/tsx/dist/cli.mjs scripts/check-ga-retention-readonly.ts --live-ga4-read-only`. 로컬 GA4 설정 필요. 인증/응답 원문 출력 금지. 운영 설정을 변경하지 않는다.
- 2026-09-21 로컬 전체 tsc는 4GB heap 초과로 실패. 범위 타입 검사 성공과 구분한다. 전체 Next 빌드/브라우저 시각 검증/운영 배포는 수행하지 않았다.
- 실제 GA4 계약 확인은 로컬 설정 부족 단계에서 중단되어 외부 보고서 검증 미완료. 운영에서 지원 여부와 집계 값을 확인하기 전 실측 재방문율을 보고하지 않는다.

## 공식 근거

- https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema (`firstSessionDate`, `totalUsers`)
- https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/batchRunReports (최대 5개)
- https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/CohortSpec (`accumulate`는 runReport 미지원; 사용하지 않음)

배포 대상은 ga4.ts, ga-retention.ts, ga-stats/route.ts, ga-retention/route.ts, AdminRetention.tsx 및 admin/page.tsx의 이번 좁은 변경이다. 현재 admin/page.tsx의 다른 미배포 변경을 통째로 옮기지 않는다. 배포 승인 후 최신 main에 해당 delta만 통합·재검증한다.
