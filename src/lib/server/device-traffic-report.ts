import { runReport, type Ga4Config } from '../ga4';
import { DEVICE_PERIODS, parseDeviceTraffic, unavailableDevices, type DeviceTrafficData } from '../device-traffic';
export async function loadDeviceTraffic(config: Ga4Config, query: typeof runReport = runReport): Promise<DeviceTrafficData> {
    const ranges = {today:{startDate:'today',endDate:'today'},recent7:{startDate:'7daysAgo',endDate:'yesterday'},recent30:{startDate:'30daysAgo',endDate:'yesterday'}};
    const result = {} as DeviceTrafficData;
    // Use the shared GA queue/cache; a failed period must not hide other periods.
    for (const period of DEVICE_PERIODS) {
        try {
            result[period] = parseDeviceTraffic(await query(config,{
                dateRanges:[ranges[period]], dimensions:[{name:'deviceCategory'}],
                metrics:[{name:'sessions'},{name:'totalUsers'}], limit:100,
            }));
        } catch { result[period] = unavailableDevices(); }
    }
    return result;
}
