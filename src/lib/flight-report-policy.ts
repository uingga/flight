export const AUTO_HIDE_REPORT_THRESHOLD = 3;
export const AUTO_HIDE_MIN_NETWORKS = 2;
export const AUTO_HIDE_DURATION_MS = 24 * 60 * 60 * 1000;
export const AUTO_HIDE_DAILY_SOURCE_LIMIT = 5;

export interface FlightReportVote {
    reporter_hash: string;
    device_hash?: string | null;
    network_hash?: string | null;
    report_type: 'price_changed' | 'unavailable';
}

export function summarizeFlightReportVotes(votes: FlightReportVote[]) {
    const devices = new Set<string>();
    const networks = new Set<string>();
    let priceChanged = 0;
    let unavailable = 0;

    for (const vote of votes) {
        // 이전 버전 신고에는 새 익명 식별값이 없을 수 있다. 그 경우 기존 식별값을
        // 보수적인 한 표로 사용하되, 같은 값이 여러 번 있어도 한 사람으로만 센다.
        devices.add(vote.device_hash || vote.reporter_hash);
        networks.add(vote.network_hash || vote.reporter_hash);
        if (vote.report_type === 'price_changed') priceChanged += 1;
        if (vote.report_type === 'unavailable') unavailable += 1;
    }

    return {
        distinctDevices: devices.size,
        distinctNetworks: networks.size,
        priceChanged,
        unavailable,
        shouldAutoHide: devices.size >= AUTO_HIDE_REPORT_THRESHOLD
            && networks.size >= AUTO_HIDE_MIN_NETWORKS,
    };
}
