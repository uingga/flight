# 네이버 가격 확인 운영

## 실행 분담

| 실행 위치 | 시각·조건 | 대상 | 최대 건수 | 역할 |
|---|---|---:|---:|---|
| GitHub Actions | 매일 07:05 KST 마이리얼트립 예약 스크래핑 성공 후 | `myrealtrip` | 200 | 갱신된 마이리얼트립 노선 후속 확인 |
| Windows `TikitikitNaverCrawl` | 매일 14:30 KST | 전체 여행사 | 280 | 11:56 일반 여행사 수집 결과 후속 확인 |

GitHub `naver-crawl.yml`에는 독립 예약이 없다. `myrealtrip-scrape.yml`의 07:05 예약 이벤트가
성공했을 때만 호출하며, 스크래핑 결과에 데이터 변경이 없어도 실행한다. 18:03 예약 회차와
수동 실행은 네이버 워크플로를 자동 호출하지 않는다. `SOURCE_FILTER=myrealtrip`을 바꾸지 않는다.

`daily-crawl.yml`의 11:56 일반 크롤은 GitHub 네이버 워크플로를 호출하지 않는다. 일반 여행사
수집, 11:56 오늘의 표 신규 선정, 다른 회차의 오늘의 표 누락 복구는 기존대로 수행한다.

## Windows 실행과 오늘의 표 복구

Windows 작업은 `scripts/install-naver-crawl-task.ps1`이 14:30 KST로 등록하고,
`scripts/run-naver-crawl.ps1`이 실행 시작 시 최신 `main`을 받는다. 주거용 IP에서
`SOURCE_FILTER=all`, `MAX_FLIGHTS=280`으로 확인한 뒤 최신 원격 네이버 데이터와 병합하고,
최신 항공권 캐시를 다시 필터링해 커밋한다.

네이버 수집·필터링 데이터가 `main`에 반영되고 운영 항공권 API가 해당 캐시 이상으로 올라온
뒤에만 `node scripts/select-today-pick.mjs --repair`를 실행한다. 현재 오늘의 표가 오늘 날짜이며
필터링된 결과에도 남아 있으면 파일을 바꾸지 않는다. 사라졌거나 유효하지 않을 때만 복구하며,
변경된 경우 `data/today-pick.json`만 별도 커밋한다.

동시에 다른 데이터 커밋이 들어와 push가 거절되면 로컬 복구 커밋을 되돌리고 최신 `main`과
운영 API를 다시 받은 뒤 `--repair`를 재실행한다. 두 번 모두 반영하지 못하면 오류로 종료하고
낡은 복구 결과를 강제로 밀어 넣지 않는다.
