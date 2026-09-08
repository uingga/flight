import type { ReportResponse } from './ga4';
import { isCompleteInterestReport } from './flight-interest';

export const FILTER_KEYS = ['departure', 'region', 'max_price', 'airline', 'source', 'sort', 'date_period'] as const;
export type FilterKey = typeof FILTER_KEYS[number];
export interface DemandItem { key: string; label: string; count: number; users: number | null }
export interface DemandGroup { available: boolean; items: DemandItem[]; cleared: number; missing: number }
export interface FilterDemandData { groups: Record<FilterKey, DemandGroup>; cities: DemandGroup; resetCount: number }
const known = (value: string) => Boolean(value.trim()) && !['(not set)', '(other)', '(empty)'].includes(value);
export const emptyDemandGroup = (available = false): DemandGroup => ({ available, items: [], cleared: 0, missing: 0 });
const labels: Record<string, string> = { ybtour: '노랑풍선', hanatour: '하나투어', modetour: '모두투어', onlinetour: '온라인투어', ttang: '땡처리닷컴', myrealtrip: '마이리얼트립' };
function labelFor(type: string, value: string) {
    if (type === 'max_price' && /^\d+$/.test(value) && Number(value) > 0) return `${Number(value).toLocaleString('ko-KR')}원 이하`;
    if (type === 'source') return labels[value] || value;
    return value;
}
function addRow(group: DemandGroup, type: string, value: string, count: number, users: number) {
    if (!Number.isSafeInteger(count) || count <= 0) return;
    if (!known(value)) { group.missing += count; return; }
    if (['all', '전체'].includes(value)) { group.cleared += count; return; }
    if (group.items.some(item => item.key === value)) { group.available = false; return; }
    group.items.push({ key: value, label: labelFor(type, value), count, users: Number.isSafeInteger(users) && users > 0 && users <= count ? users : null });
}
export function parseFilterDemand(report?: ReportResponse, cityReport?: ReportResponse): FilterDemandData {
    const groups = Object.fromEntries(FILTER_KEYS.map(key => [key, emptyDemandGroup(isCompleteInterestReport(report))])) as Record<FilterKey, DemandGroup>;
    const cities = emptyDemandGroup(isCompleteInterestReport(cityReport));
    let resetCount = 0;
    if (isCompleteInterestReport(report)) for (const row of report?.rows || []) {
        const [type, value = ''] = (row.dimensionValues || []).map(item => item.value);
        const count = Number(row.metricValues?.[0]?.value);
        if (type === 'reset' && value === 'all' && Number.isSafeInteger(count) && count > 0) resetCount += count;
        if (FILTER_KEYS.includes(type as FilterKey)) addRow(groups[type as FilterKey], type, value, count, Number(row.metricValues?.[1]?.value));
    }
    if (cities.available) for (const row of cityReport?.rows || []) addRow(cities, 'city', row.dimensionValues?.[0]?.value || '', Number(row.metricValues?.[0]?.value), Number(row.metricValues?.[1]?.value));
    for (const group of [...Object.values(groups), cities]) {
        if (!group.available) { group.items = []; group.cleared = 0; group.missing = 0; }
        group.items.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko-KR'));
    }
    return { groups, cities, resetCount };
}
