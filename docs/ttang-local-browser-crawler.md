# 땡처리닷컴 로컬 브라우저 수집기

## 목적

GitHub 실행 환경에서 땡처리닷컴 접근 제한이 확인됐을 때, 다른 Windows PC의 일반 Chrome
네트워크와 독립 프로필을 사용해 해당 소스만 안전하게 검증한다. 초기 운영은 결과를 곧바로
배포하지 않고 staging 파일과 변경 요약만 만든다.

## chacha95/automation에서 유지한 의도

- 평소 Chrome 사용자 데이터에서 한 번 준비한 별도 프로필을 계속 재사용한다.
- 원래 Chrome과 충돌하지 않는 로컬 디버그 포트(`127.0.0.1:9222`)를 사용한다.
- 사람이 브라우저 상태를 볼 수 있는 일반 Chrome을 실행한다.
- Playwright는 새 브라우저를 가장하지 않고 이미 열린 Chrome에 CDP로 연결한다.

사이트를 속이기 위한 `AutomationControlled` 관련 플래그, 매 실행 프로필 재복사, 개인 Chrome
프로필에 직접 연결하는 방식은 사용하지 않는다. Google 로그인이 복제되지 않아도 땡처리닷컴
수집에는 필요하지 않으므로 로그인을 강제하지 않는다.

## 현재 실행 방법

다른 PC의 저장소에서 의존성을 설치한 뒤 다음 명령 하나를 실행한다.

```bash
npm run crawl:ttang:browser:pilot
```

Windows 보안 제품이 `ExecutionPolicy Bypass`와 Chrome 실행을 결합한 PowerShell을 악성 행위로
오인하지 않도록, 실행 과정에는 PowerShell을 사용하지 않는다. Node.js가 Chrome을 직접 실행하고
같은 Node.js staging 수집기로 이어간다. 백신 예외 등록은 필요하지 않다.

이 명령은 다음 순서로 동작한다.

1. 기존 `~/tmp/chrome-debug` 프로필과 Chrome 설치 여부를 확인한다.
2. 필요한 경우 최소 플래그로 보이는 Chrome을 실행한다.
3. 운영 `data/`를 `.local-crawler/staging/ttang-<시각>/`에 복사한다.
4. 복사본만 대상으로 땡처리 목록과 상세를 수집한다.
5. `summary.json`과 검토용 `all-flights-cache.json`을 남긴다.

운영 `data/all-flights-cache.json`, Git 브랜치, 원격 저장소는 변경하지 않는다.

GitHub 땡처리 회로가 실제로 열린 경우만 확인하는 예약용 명령은 다음과 같다.

```bash
npm run crawl:ttang:browser:scheduled
```

이 명령은 기존 `local-source-fallback-policy.mjs`가 현재 회차의 땡처리 대체 수집을 허용할 때만
Chrome과 staging 수집기를 실행한다. 실행 전 다른 PC의 저장소가 최신 `main`을 받은 상태여야 한다.

## 상품 식별과 요청량

- 목록 카드의 `masterId`와 `hanaFareId`를 함께 저장한다.
- 같은 노선·날짜·항공사라도 `hanaFareId`가 다르면 다른 요금 상품으로 취급한다.
- 목록은 한 번 연 페이지 안에서 날짜별 API를 호출한다.
- 상세는 최종 필터를 통과한 신규·재확인 대상 중 최대 20개만 조회한다.
- 상품당 `scheduleAct.do` 한 번으로 시간과 좌석을 함께 확인한다.
- 상세 요청 사이는 4~8초, 10건 뒤에는 30~60초를 추가로 쉰다.
- 401·403·429·CAPTCHA 또는 8건 연속 실패가 확인되면 남은 요청을 중단한다.

## 안티그래비티 운영 전 확인 순서

1. 수동 staging 실행 한 번으로 `productIdentified`, `timeVerified`, `seatVerified`를 확인한다.
2. 선택한 항공권 한 건의 시간·좌석·가격을 실제 화면과 대조한다.
3. 최소 여러 회차 동안 운영 데이터와 staging 결과를 비교한다.
4. 검증 전에는 자동 병합·커밋·푸시를 추가하지 않는다.
5. 안정화 뒤에도 예약 작업은 먼저 GitHub 회차 상태를 확인하고, 땡처리 회로가 열린 경우에만
   이 수집기를 호출하도록 구성한다.
