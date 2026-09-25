# 메인 공지 팝업 템플릿

`AnnouncementDialog`는 기존 운영 팝업 스타일과 `OverlayDialog`의 포커스 트랩·복원, ESC, 배경 클릭, 스크롤 잠금을 재사용합니다. 모바일 손잡이 스와이프도 유지합니다. 별도 CMS나 새 디자인은 없습니다.

## 사용

1. `src/lib/service-update-notice.ts`처럼 모듈 최상위에 `AnnouncementNotice` 상수를 만듭니다. `id`, `storageKey`, `endsAt`(시간대가 명시된 ISO 날짜의 `Date.parse`), `eyebrow`, `title`, `body`를 지정합니다. 버튼 문구는 선택적으로 `closeLabel`, `dismissLabel`을 지정합니다.
2. `const {open, close, dismiss} = useAnnouncementNotice(NOTICE, !previewMode)`로 상태를 만듭니다. 공지 객체를 렌더마다 새로 만들지 않습니다.
3. `<AnnouncementDialog notice={NOTICE} open={open} active={최상단여부} onClose={close} onDismiss={dismiss} />`를 메인 스타일 토큰 영역 안에 렌더링하고 기존 오버레이 우선순위에 포함합니다.

일반 닫기·ESC·배경·스와이프는 저장하지 않습니다. 다시 보지 않기는 `storageKey`에 `dismissed`를 저장합니다. 같은 공지의 문구 수정으로 키를 바꾸면 기존 선택이 무효화되므로 유지합니다. 새 공지만 새 키를 사용합니다. ID는 공지 식별용이고 영구 비노출 기준은 storageKey입니다.

종료 시각부터 비노출이며 열린 상태도 타이머·탭 복귀로 종료됩니다. 저장소가 차단되면 공지는 표시하지만 닫기는 가능합니다. previewMode 비노출 정책을 유지합니다.

현재 공지는 노출하지 않습니다. `항공권 데이터 복구 중입니다` 공지(키 `tikitikit-service-update-20260923-flight-data-recovery-v1`)는 사용자 요청에 따라 2026-09-25 00:00 KST부터 비노출합니다. 팝업만 내리며 수집 일정·접근 제한 판단·예약 링크는 변경하지 않습니다.

검증: `npx tsx --test scripts/test-service-update-notice.ts`. 브라우저에서는 PC/모바일 닫기·재방문·영구 비노출·Tab 트랩·ESC 복원·종료 경계를 확인합니다. 스타일 변경은 별도 작업입니다.

템플릿 범위 타입 검사: `npx tsc -p tsconfig.announcement.json`.
로컬 브라우저 회귀: `node output/announcement-preview.cjs`로 3560 포트 서버를 띄운 뒤 `node scripts/test-announcement-dialog.cjs`. 테스트는 외부 요청을 차단하고 API를 스텁으로 대체하며, 브라우저 시각만 종료 전후로 조정합니다. 캡처는 `output/announcement-dialog/`에 저장합니다.
