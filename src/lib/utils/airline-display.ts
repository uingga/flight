// Presentation only: preserve stored airline names and matching keys.
export function airlineDisplayName(airline: string): string {
    return airline.trim()
        .replace(/트리니티\s*항공\s*\(구\)\s*티웨이\s*항공/gi, '트리니티항공')
        .replace(/티웨이\s*항공|트리니티\s*항공|t\s*['’]?\s*way\s*(?:airlines?|air|항공)/gi, '트리니티항공')
        .replace(/^TW$/i, '트리니티항공');
}
