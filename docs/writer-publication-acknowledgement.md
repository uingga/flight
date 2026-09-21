# 게시 결과 확인 오류 처리 (2026-09-21)

## 확인한 현상

Daily Flight Crawl `35561214541`의 수집은 성공했지만 GitHub는 13:42:22 KST에
`writer publication refused`로 종료했다. 공통 writer는 13:42:41에 게시를 완료했고
`3c5eec9c796d61393b0d8662bce1cd2fec1cf8ab`에 같은 수집 시각의 결과가 반영됐다.
기존 catch가 상세 원인을 버리므로 당시의 정확한 HTTP 상태/통신 오류는 확정할 수 없다.

## 수정 범위

- 기존 60초 확인 기한 내에서 릴레이의 일시 통신/응답 오류를 재확인한다.
- 요청 ID, 내용, 최초 요청 시각과 압축 본문을 고정한다. 기존 SQL `submit`의
  `(role,id)` 조회·내용 충돌 검사를 이용해 같은 영수증을 확인한다.
  별도 상태 조회 RPC나 DB 마이그레이션은 추가하지 않는다.
- 확인 간격은 250ms에서 2초로 완화한다. 웹 요청 하나의 대기는 최대 15초이며
  전체 남은 확인 기한을 넘겨 새 요청을 시작하지 않는다.
- 릴레이가 보관된 최종 응답을 반환할 때 `x-publication-state: completed`를 붙인다.
  입력 거절은 `rejected`, 큐 통신 실패는 503/`unknown`으로 구분한다.
- 구형 릴레이의 분류 없는 409는 결과 미확인으로 취급한다. 동일 영수증만 재확인하고
  최종 확인이 안 되면 비정상 종료·보관 규칙을 유지한다. 성공으로 간주하지 않는다.
- 401/403/413/429 및 명시적인 최종 거절은 더 요청하지 않는다. 이미 접수된 뒤
  확인 권한이 거절된 경우 게시 자체의 실패를 확정하지 않는다.
- 직접 연결된 조정기 작업은 통신 오류 시 재호출하지 않는다.
- 오류 코드, HTTP 상태, 요청 ID, 접수 확인 여부만 기록한다. 토큰·응답 본문·임의 오류
  메시지·URL은 기록하지 않는다. GitHub 알림은 수집 실패와 게시 결과 미확인을 구분한다.

## 유지하는 보호

새 요청 ID 생성에 의한 재발행, 직접 push, 원장/잠금 초기화, 재수집은 하지 않는다.
공통 writer·인증·원본 기준 SHA·데이터 보존·7일 artifact 보관 규칙은 변경하지 않는다.
기한이 지난 미확인 요청은 운영 원장/실제 반영을 대조한 뒤 별도로 처리해야 한다.

## 검증과 적용

`node --test scripts/test-writer-publication-ack.mjs scripts/test-writer-relay-heartbeat.mjs scripts/test-writer-transport-limits.mjs scripts/test-mrt-publication-recovery.mjs scripts/test-mrt-finalization.mjs scripts/test-crawl-publication-blocker.mjs scripts/test-merge-crawl-log.mjs`

테스트는 가짜 릴레이 및 로컬 HTTP 서버만 사용한다. 실제 여행사·운영 writer 호출 없음.
수정은 별도 작업공간에 준비하며 운영 적용은 사용자 배포 승인 이후 정식 경로로 한다.
GitHub 실행 코드와 Vercel 릴레이가 적용 대상이며 PC 설치 런타임은 이 변경만으로
자동 갱신되지 않는다. PC 적용은 설치본 변경과 안전한 유지보수 절차가 별도로 필요하다.
