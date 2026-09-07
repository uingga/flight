// Validate the public page's own navigation function; never execute source text or call an API.
const LIST = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
export function followingMonth(month: string): string {
    if (!/^[1-9]\d{3}(0[1-9]|1[0-2])$/.test(month)) throw Error('invalid_inventory_month');
    return month.endsWith('12') ? String(Number(month.slice(0,4))+1)+'01'
        : month.slice(0,4)+String(Number(month.slice(4))+1).padStart(2,'0');
}
export function nativeMonthUrl(source: unknown, vars: Record<string,string|null>, month: string): string | null {
    if (typeof source !== 'string' || source.length > 6000 || !/^[A-Z]{2}$/.test(vars.TabGubun || '')
        || !['ICN','GMP'].includes(vars.airSect || '') || !/^(?:[A-Z]{3})?$/.test(vars.SelectedCityCd ?? '!')
        || month !== followingMonth((vars.nowYear || '')+(vars.nowMonth || ''))) return null;
    const expected = `function nextMonth(year, month){var TabGubun = '${vars.TabGubun}';var airSect = '${vars.airSect}';var SelectedCityCd = '${vars.SelectedCityCd}';location.href="/flight/w/international/dcair/dcairList?TabGubun="+TabGubun+"&nowMonth="+month+"&nowYear="+year+"&SelectedCityCd="+SelectedCityCd+"&airSect="+airSect;}`;
    if (source.replace(/\s/g,'') !== expected.replace(/\s/g,'')) return null;
    return LIST+'?'+new URLSearchParams({TabGubun:vars.TabGubun!,nowMonth:String(Number(month.slice(4))),
        nowYear:month.slice(0,4),SelectedCityCd:vars.SelectedCityCd!,airSect:vars.airSect!});
}
