# 한국 공휴일 달력

운영 PC·모바일 날짜 직접 선택 달력은 `src/lib/korean-calendar.ts`를 공유한다.
일요일과 확인된 공휴일·대체공휴일은 기존 `--brand-dark`로 표시한다.
선택 시작·끝은 기존 흰 글씨를 유지하고, 선택 불가 날짜는 흐리게 표시한다.

2026·2027년 날짜를 확인해 등록했다. 추석이 토요일과 겹쳤다는 이유만으로
대체공휴일을 생성하지 않는다. 2026-09-28 및 2027-06-07은 공휴일이 아니다.
미등록 연도의 공휴일은 추측하지 않으며 일요일만 표시한다.
새 월력요항 발표와 임시공휴일 지정 시 이 테이블 및 테스트를 갱신한다.

확인 기준 (2026-09-21):
- 2026 월력요항: https://www.kasa.go.kr/prog/bbsArticle/BBSMSTR_000000000010/view.do?bbsId=BBSMSTR_000000000010&nttId=B000000001860Pe2zT3
- 2027 월력요항: https://www.kasa.go.kr/prog/plcyBrf/brief/kor/sub01_01_04/view.do?plcyBrfNo=431
- 노동절·제헌절 공휴일 지정: https://www.korea.kr/multi/visualNewsView.do?newsId=148965799
