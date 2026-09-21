// Presentation only: preserve stored airline names and matching keys.
export function airlineDisplayName(airline: string): string {
    return airline.replace(/트리니티\s*항공\s*\(구\)\s*티웨이\s*항공/g, '트리니티항공');
}
