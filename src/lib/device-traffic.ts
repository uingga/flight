import type { ReportResponse } from './ga4';
import { completeAcquisitionReport } from './acquisition';
export const DEVICE_PERIODS = ['today', 'recent7', 'recent30'] as const;
export type DevicePeriod = typeof DEVICE_PERIODS[number];
export interface DeviceTrafficRow { device: string; label: string; sessions: number; users: number; percent: number }
export interface DeviceTrafficReport { available: boolean; sessions: number; rows: DeviceTrafficRow[] }
export type DeviceTrafficData = Record<DevicePeriod, DeviceTrafficReport>;
export const unavailableDevices = (): DeviceTrafficReport => ({available:false,sessions:0,rows:[]});
const labels: Record<string,string> = {mobile:'모바일',desktop:'PC',tablet:'태블릿','(not set)':'기기 미확인','':'기기 미확인'};
export function parseDeviceTraffic(report: ReportResponse): DeviceTrafficReport {
    if (!completeAcquisitionReport(report)) return unavailableDevices();
    const seen = new Set<string>();
    const rows: DeviceTrafficRow[] = [];
    for (const row of report.rows || []) {
        const device = row.dimensionValues?.[0]?.value ?? '';
        const sessions = Number(row.metricValues?.[0]?.value);
        const users = Number(row.metricValues?.[1]?.value);
        if (seen.has(device) || !Number.isSafeInteger(sessions) || sessions < 0 || !Number.isSafeInteger(users) || users < 0) return unavailableDevices();
        seen.add(device);
        rows.push({device,label:labels[device] || '기타 기기 · ' + device,sessions,users,percent:0});
    }
    for (const device of ['mobile','desktop','tablet']) if (!seen.has(device)) rows.push({device,label:labels[device],sessions:0,users:0,percent:0});
    const sessions = rows.reduce((sum,row)=>sum+row.sessions,0);
    if (!Number.isSafeInteger(sessions)) return unavailableDevices();
    for (const row of rows) row.percent = sessions ? row.sessions / sessions * 100 : 0;
    return {available:true,sessions,rows:rows.sort((a,b)=>b.sessions-a.sessions)};
}
