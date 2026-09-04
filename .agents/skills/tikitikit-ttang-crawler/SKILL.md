---
name: tikitikit-ttang-crawler
description: Run or inspect Tikitikit's Ttang.com browser crawler on the dedicated Windows crawler worker, using visible Chrome and staging-only safety controls.
metadata:
  hermes:
    version: 1.0.0
    platforms: [windows]
    tags: [tikitikit, crawler, ttang, windows, operations]
---

# 티키티킷 땡처리 브라우저 수집

## 언제 사용하나

사용자가 땡처리닷컴 로컬 브라우저 수집의 상태 확인, 시험 실행 또는 예약 실행을 요청했을 때만
사용한다. 이 스킬은 크롤링 PC에서 실행되는 원격 Hermes Bot 전용이다.

## 역할 경계

- Hermes는 실행 여부 확인, 정해진 명령 1회 실행, 결과 요약만 맡는다.
- 실제 반복 수집과 요청 간격, 중단 기준은 저장소의 수집 코드가 맡는다.
- Hermes의 자체 격리 브라우저에서 항공권을 하나씩 임의로 클릭하지 않는다.
- 전용 프로필로 보이는 Chrome을 여는 기존 Node.js 실행기를 사용한다.
- 운영 캐시 병합, Git 커밋·푸시, 배포는 절대 이어서 실행하지 않는다.
- 실패 뒤 같은 회차를 임의로 재시도하지 않는다.
- `.env*`, 쿠키, 토큰, 원문 응답 전체를 출력하지 않는다.

## 첫 등록

사용자가 현재 PC를 전용 크롤링 PC라고 명시한 경우에만 프로젝트 루트에서 다음을 한 번 실행한다.

```powershell
npm run hermes:ttang:enroll
```

일반 작업 PC에서는 등록하지 않는다. 등록표는 Git에 올라가지 않는 `.local-crawler/`에 남고,
다른 PC로 복사된 등록표는 호스트 이름 검사에서 거부된다.

## 상태 확인

실행 요청을 받으면 먼저 다음 명령으로 상태를 확인한다.

```powershell
npm run hermes:ttang:status
```

- `worker.registered`가 `false`면 실행하지 말고 등록이 필요하다고 알린다.
- `running`이 있으면 새 작업을 시작하지 않는다.
- `scheduledEligibility.shouldRun`이 `false`면 예약 실행을 강행하지 않는다.

## 시험 실행

사용자가 시험 또는 pilot 실행을 명시한 경우에만 한 번 실행한다.

```powershell
npm run hermes:ttang:pilot
```

## 예약 대체 실행

사용자가 예약 실행을 요청했거나 크롤링 PC의 정해진 작업이 실행된 경우 다음을 한 번 실행한다.

```powershell
npm run hermes:ttang:scheduled
```

이 명령은 GitHub의 땡처리 수집 차단 회로가 실제로 열려 있을 때만 Chrome을 시작한다. 조건이
아니면 `skipped`가 정상 결과다.

## 결과 보고

명령 마지막의 `HERMES TTANG OPERATOR RESULT`만 기준으로 다음을 짧게 보고한다.

- 실행, 건너뜀, 실패 중 어느 상태인지
- 목록 원본 수와 노출 전후 수
- 상품 식별, 시간 확인, 좌석 확인 수
- 새 staging의 `summaryPath`
- 사용자가 확인하거나 결정해야 할 오류

`operationalDataChangedByThisCommand`가 `true`이면 안전 위반으로 보고하고 어떤 후속 작업도 하지
않는다. `failed_validation`, `response_format`, `E001`, 차단 신호가 있으면 원인을 요약하되 재실행은
사용자의 새 지시를 기다린다.

더 자세한 운영 기준은 프로젝트의 `AGENTS.md`와 `docs/ttang-local-browser-crawler.md`를 읽는다.
