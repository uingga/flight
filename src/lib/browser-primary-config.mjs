// Enabled after 34-request month-complete validation and A/B worker installation on 2026-09-07.
// Poll existing slots, but contact OnlineTour only once every randomized 2–3 days.
export const ONLINE_BROWSER_PRIMARY = Object.freeze({ enabled: true, slotsPerDay: 4, randomDayInterval: true });
export const MODE_BROWSER_PRIMARY = Object.freeze({ enabled: true, slotsPerDay: 4 });
export const TTANG_BROWSER_PRIMARY = Object.freeze({ enabled: true, slotsPerDay: 2 });
