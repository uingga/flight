# TE31 admin performance

## 2026-09-11 일별 저장 추가

현재 일별 수집·저장·예약 기준은 [promotion-daily.md](promotion-daily.md)를 따른다. 운영 관리자에서는 아래의 과거 수동 반응값을 숨기고 새 일별 저장 영역을 사용한다. 기존 최근 30일 GA4 표와 출처+캠페인 연결은 유지한다. 부모 제공 실제 EUC-KR 목록 페이지 1의 등록 글 3개를 검증했으며 나머지 페이지의 제한적 확인과 운영 활성화는 부모가 수행한다. 아래 내용은 최초 구현 기록이다.

## Implemented 2026-09-08

- Admin tab id `threads` is preserved; visible label is 홍보 성과.
- Threads retains its existing panels. TE31 uses the existing GA4 promotionCampaigns response, without additional collection jobs or API reports.
- Five manually verified posts are registered in `src/lib/te31-posts.ts`.
- External counts are manual cumulative observations as of approximately 2026-09-08 19:40 KST. Refresh updates site statistics only, not TE31 counts.
- 5232 and 5211 match exact campaign plus source `te31`. Legacy posts without confirmed dedicated tracking stay unassigned.
- Generic historical campaigns such as `tikitikit_te31` are shown separately, never silently assigned to a post.
- Site metrics cover the API's recent 30-day campaign window including today, not lifetime. Unknown, failed and absent reports are not converted to zero. Users are not summed across posts.
- Booking clicks mean outbound movement, not confirmed bookings.

## Verification

- `node scripts/test-te31-posts.cjs`: exact matching, channel separation, legacy ambiguity, null/zero.
- `node scripts/test-te31-posts-ui.mjs`: 1440/390/320px, expanded notes, no page overflow, missing/empty reports. Local server port 31860; external browser requests blocked.
- Production build passed, including type/lint checks.
- Existing Threads reply-tracking regression test passed.
- Preview route requires loopback host, local preview mode and ADMIN_KEY; forbidden on Vercel.

No deployment, push, crawler, scheduler or operational cache changes were performed. Actual production GA4 attribution for these posts still needs verification after approved deployment; fixture test values are not real performance.
