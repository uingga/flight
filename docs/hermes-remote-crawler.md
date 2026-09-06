# Hermes 원격 크롤링 PC 구성

## 목표 구조

```text
메인 PC의 Hermes
  └─ 크롤링 PC의 원격 Bot에게 요청
       └─ 등록된 프로젝트 명령 1회 실행
            └─ 전용 프로필의 보이는 Chrome
                 └─ staging 결과와 summary.json 생성
```

메인 PC는 요청과 결과 확인만 한다. Chrome, 네트워크 요청, staging 파일은 모두 크롤링 PC에서
처리한다. Antigravity는 이 흐름에 포함하지 않는다.

## 크롤링 PC 준비

1. 클라우드 동기화 폴더 밖에 티키티킷 저장소를 별도로 clone한다.
2. Node.js와 Hermes Desktop을 설치하고 저장소에서 `npm install`을 실행한다.
3. Hermes에서 이 저장소를 프로젝트로 연다.
4. 프로젝트 루트에서 `hermes skills trust`를 실행해 저장소의 프로젝트 스킬을 신뢰한다.
5. 사용자에게 이 PC가 전용 크롤링 PC인지 확인받은 뒤 `npm run hermes:ttang:enroll`을 한 번
   실행한다.
6. `npm run hermes:ttang:status`에서 `worker.registered: true`인지 확인한다.

작업자 등록표는 `.local-crawler/hermes/worker.json`에만 있고 Git에 올라가지 않는다. 저장소를
다른 PC에 복사해도 호스트 이름이 다르면 실행이 거부된다.

## 메인 PC와 연결

Chrome을 화면에 띄워야 하므로 크롤링 PC의 Hermes backend는 Windows에 로그인한 사용자의 세션에서
실행한다. Windows 서비스나 메인 PC의 SSH terminal backend로 Chrome을 띄우지 않는다.

1. 두 PC를 Tailscale 같은 사설망에 연결한다.
2. 크롤링 PC에서 Hermes remote backend를 사설망 주소에만 연다.
3. 메인 PC의 Hermes Desktop `Settings → Connections`에서 크롤링 PC의 remote gateway를 등록한다.
4. 크롤링 PC에 속한 Bot을 `tikitikit-crawler`처럼 구분되는 이름으로 만든다.
5. 메인 PC에서는 그 원격 Bot을 지목해 상태 확인이나 1회 실행을 요청한다.

공개 인터넷에 backend 포트를 직접 노출하지 않는다. 인증 정보는 Hermes의 로컬 비밀 설정에만
보관하고 저장소나 대화에 적지 않는다.

## 원격 Bot에게 요청하는 말

상태만 확인:

> 티키티킷 프로젝트에서 땡처리 브라우저 수집 상태만 확인해줘. 실행은 하지 마.

수동 시험 1회:

> 티키티킷 땡처리 브라우저 pilot을 한 번만 실행하고 summary를 보고해줘. 실패해도 재실행하거나
> 운영 반영, 커밋, 푸시, 배포는 하지 마.

정규 대체 회차:

> 티키티킷 땡처리 예약 대체 수집을 확인해줘. 정책상 실행 대상일 때만 한 번 실행하고, 아니면
> 건너뛴 이유만 알려줘.

원격 Bot은 `.agents/skills/tikitikit-ttang-crawler/SKILL.md`에 따라 다음 네 명령만 사용한다.

```bash
npm run hermes:ttang:enroll
npm run hermes:ttang:status
npm run hermes:ttang:pilot
npm run hermes:ttang:scheduled
```

## 아직 자동화하지 않는 것

- pilot 실패 뒤 자동 재시도
- staging 결과의 운영 캐시 병합
- Git 커밋·푸시
- Vercel 배포
- 검증 전 Hermes cron 등록

수동 pilot이 여러 회차 안정적으로 끝나고 실제 화면과 데이터 대조가 끝난 뒤에만 예약 작업을
켜는 것으로 한다.
