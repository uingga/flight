# B PC 크롤러 검증 진행 — 2026-09-07

## 사용자 승인 경계

최신 지시: 크롤러 완성을 진행하되 **운영은 사용자에게 확인받고 실행**한다.
이번 변경은 구현과 검토용 검증뿐이다. 운영 데이터 병합, 정기 실행 등록·이관·중단,
main 반영, push, 배포는 하지 않았다. 기존 운영 크롤러/예약 작업은 그대로다.

## 구현 및 검증

- A 전용 작업공간: `C:/Users/ynal/tikitikit-wt/codex-crawler-recovery-20260906`
- B 별도 검증 폴더: `C:/Users/ynal/AppData/Local/Tikitikit/crawler-validation-20260907`
- B의 기존 `Tikitikit_crawler_antigravity` 소스와 package-lock 수정은 보존했다.
  새 폴더에는 코드만 전달했고 설치된 node_modules를 연결했다. 운영 data/와 인증 파일은
  복사하지 않았다. 초기 tar의 일부 한글 보관 문서는 Windows 압축 해제에서 오류가 났으므로
  이 폴더를 원본 전체의 백업이나 Git 체크아웃으로 취급하지 않는다. 필수 코드·테스트는 확인했다.

### 땡처리

B의 `ttang-20260905T185656Z` 저장 결과를 현재 `ttang-staging-validation.mjs`로 직접 재검증했다.

- 원본 수집 1,395건, 검토 대상 151건.
- checkpoint: 선택 151 / 성공 97 / 빈 결과 54 / 실패 0 / 미조회 0.
- 상품·노선·네 시간·확인 시각·runId 대조 결과 시간 97건, 좌석 54건으로 기존 집계와 일치.
- 이는 **2026-09-06 KST의 저장 증거를 재검증한 것**이며 오늘 새로 수집한 결과가 아니다.
- B에서 실행기·검토 판정 테스트 24개 통과. A에서 시간 큐·상품 일정 파서와 checkpoint/보강
  테스트 13개도 통과했다. 실제 운영 병합은 없었다.
- 최신 운영 참조에는 오늘 08:44 KST PC 땡처리 대체 수집 성공이 이미 기록돼 있다.
  5시간 간격 및 허용 회차를 무시해 추가 실수집하지 않았다. B 기존 로컬 data/는 9월 4일
  기준으로 오래됐으므로 이를 최신 차단 상태로 쓰면 안 된다.

### 온라인투어

- 지역 실패 진단에 쿼리값·프래그먼트·인증정보 없이 도메인/짧은 정적 경로를 보존한다.
  숫자 등 동적 경로는 가린다. **보조 프레임을 새로 허용하지 않았다.**
- `onlinetour-catalogue.ts`와 `crawl-onlinetour-catalogue.ts`를 추가했다.
  명시된 지역 순서, 지역 진입 시 보이는 도시 목록, 각 도시의 화면상 첫 출발월부터
  보이는 다음 달 버튼만 순회한다. `throughMonth`와 도시별 월 상한을 넘지 않는다.
- 지역 이동과 상품 조회를 합산해 한 계획의 예산을 공유한다. 지역 최대 6회, 상품 최대 100회,
  범위당 최대 20페이지, 도시당 최대 12개월은 **설정 가능한 절대 상한**이지 권장 요청량이나
  이번 실사이트 실행 횟수가 아니다. 재시도/확인 요청도 포함하고 기본 간격은 5초다.
- 지역 이동 때 받은 첫 페이지는 같은 프로세스에서 화면의 범위·페이지 상태를 재확인한 뒤
  이어받아 재조회하지 않는다. 다른 화면으로 이동한 뒤에는 재사용하지 않는다.
- 연결부는 동시에 붙지 않는다. 매 연결 종료 후 접근 제한을 다시 확인하고, 실패하면 뒤의
  지역/도시를 실행하지 않는다. 성공/부분 페이지는 개별 UUID checkpoint에 보존한다.
- 사용자 동의 및 유한 계획 없는 실사이트 CLI 실행은 거부한다. 기존 PC 차단 상태를 읽고,
  검증 실행끼리의 PC 공용 잠금과 접근 제한 후 24시간 휴식을 적용한다. 운영 모드는 없다.
- `plannedCoverageCompleted`는 **계획 내 보이는 후보 순회 완료**일 뿐 전 사이트 모든 상품
  수집의 증명이 아니다. `productionReady=false`, `fullCatalogueComplete=false`를 유지한다.
- A/B에서 신규 전체 순회 검사 12개 통과. 기존 온라인투어 adapter 44개, 지역 검사 41개와
  기존 회귀도 통과했다. 실제 캡처 원본이 없는 선택적 replay 1건은 skip이다.

## 아직 완료하지 못한 실사이트 검증

B SSH/코드 실행은 정상이다. 두 Chrome 포트도 listening 상태다. 그러나 온라인투어의
일반 Chrome WebSocket 연결은 받아들여지지 않았다. 연결 진단 결과는 `connection_not_accepted`,
사이트 요청 0 / 화면 조작 0 / attach 0이다. 이것만으로 Chrome 승인창이 실제 떠 있다고
단정할 수 없다. 브라우저 연결 동의·상태 확인이 필요하며 보안 설정은 우회하지 않았다.

따라서 `invalid_paused_request`를 일으킨 보조 프레임의 실제 URL/용도는 여전히 미확정이고,
신규 전체 순회도 실사이트에서는 아직 실행하지 않았다. 코드·모의 검증 통과를 실제 성공으로
보고하지 않는다. 연결이 허용되면 첫 진단은 기존 안전한 탭 상태를 읽고 좁은 지역 전환 1회로
문제 요청을 식별하는 것이다. 과거 실행 계획의 남은 예산을 신규 승인으로 재사용하지 않는다.

## 검증 명령

```text
npm run test:onlinetour-browser
npm run test:ttang-time
npm run test:ttang-partial
npm run test:ttang-staging
node scripts/verify-ttang-saved-evidence.mjs --staging <보존된 검토 결과 폴더>
node node_modules/tsx/dist/cli.mjs scripts/crawl-onlinetour-catalogue.ts --help
```

Orca 실행 파일이 없어 Antigravity 분담은 사용하지 못했고 Codex가 직접 구현·검증했다.
Orca 설치/다른 실행 파일 우회는 하지 않았다.
