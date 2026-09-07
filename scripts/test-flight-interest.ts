import assert from 'node:assert/strict';
import { parseFlightInterest, isCompleteInterestReport } from '../src/lib/flight-interest';
import { loadFlightInterest, FLIGHT_INTEREST_RANGES } from '../src/lib/server/flight-interest-report';
import type { ReportRow, ReportRequest } from '../src/lib/ga4';

const row = (event: string, id: string, route: string, count: number): ReportRow => ({
    dimensionValues: [event, id, route].map(value => ({ value })), metricValues: [{ value: String(count) }],
});
async function main() {
    const report = parseFlightInterest({ rows: [
        row('flight_impression', 'seen-only', '인천-도쿄', 9999),
        row('detail_open', 'detail-only', '인천-도쿄', 999),
        row('booking_click', 'flight-a', '인천-도쿄', 3),
        row('booking_click', 'flight-b', '인천-도쿄', 4),
        row('booking_click', 'flight-a', '(not set)', 2),
        row('detail_open', 'flight-a', '인천-도쿄', 7),
        row('city_booking_click', 'flight-b', '인천-도쿄', 99),
        row('affiliate_click', 'flight-b', '인천-도쿄', 99),
        row('city_detail_open', 'flight-b', '인천-도쿄', 99),
        row('booking_click', '(not set)', '인천-도쿄', 11),
        row('detail_open', '', '인천-도쿄', 13),
        row('booking_click', 'tie', '부산-오사카', 4),
        row('detail_open', 'tie', '부산-오사카', 1),
    ] });
    assert.equal(report.available, true);
    assert.deepEqual(report.rows.map(item => item.flightId), ['flight-a', 'tie', 'flight-b', 'detail-only']);
    assert.deepEqual(report.rows[0], { flightId: 'flight-a', route: '인천-도쿄', bookingClicks: 5, detailOpens: 7 });
    assert.deepEqual(report.unidentified, { bookingClicks: 11, detailOpens: 13 });
    assert.equal(parseFlightInterest({ rows: [row('detail_open', 'conflict', 'A-B', 1), row('booking_click', 'conflict', 'A-C', 1)] }).rows[0].route, null);
    assert.equal(parseFlightInterest({ rows: [row('detail_open', 'missing-route', '(not set)', 1)] }).rows[0].route, null);
    assert.deepEqual(parseFlightInterest({}).rows, []);
    assert.equal(parseFlightInterest({ rowCount: 2, rows: [row('booking_click', 'a', 'A-B', 1)] }).available, false);
    for (const metadata of [{ dataLossFromOtherRow: true }, { subjectToThresholding: true }, { samplingMetadatas: [{}] }]) {
        assert.equal(parseFlightInterest({ metadata }).available, false);
        assert.equal(isCompleteInterestReport({ metadata }), false);
    }
    assert.equal(isCompleteInterestReport(null), false);
    assert.equal(isCompleteInterestReport({ rows: [], rowCount: 0 }), true);

    const calls: ReportRequest[] = [];
    const config = { propertyId: 'test', clientEmail: 'test', privateKey: 'test' };
    const result = await loadFlightInterest(config, async (_, request) => {
        calls.push(request);
        if (request.dateRanges[0].startDate === 'today') throw new Error('unregistered dimension');
        // The winning flight only becomes first after the second page is merged.
        return request.offset === 0
            ? { rowCount: 3, rows: [row('booking_click', 'early', 'A-B', 4), row('booking_click', 'late', 'C-D', 2)] }
            : { rowCount: 3, rows: [row('booking_click', 'late', 'C-D', 3)] };
    });
    assert.equal(result.today.available, false);
    for (const period of ['recent7', 'current'] as const) {
        assert.equal(result[period].available, true);
        assert.equal(result[period].rows[0].flightId, 'late');
        assert.equal(result[period].rows[0].bookingClicks, 5);
        assert.deepEqual(calls.filter(call => call.dateRanges[0].startDate === FLIGHT_INTEREST_RANGES[period][0].startDate).map(call => call.offset), [0, 2]);
    }
    assert.deepEqual(new Set(calls.map(call => JSON.stringify(call.dateRanges))), new Set(Object.values(FLIGHT_INTEREST_RANGES).map(range => JSON.stringify(range))));
    for (const call of calls) {
        assert.deepEqual(call.dimensions?.map(dimension => dimension.name), ['eventName', 'customEvent:flight_id', 'customEvent:route', 'customEvent:travel_agency', 'customEvent:departure_date', 'customEvent:return_date', 'customEvent:airline', 'customEvent:price']);
        assert.deepEqual(call.metrics, [{ name: 'eventCount' }]);
        assert.deepEqual((call.dimensionFilter as any).orGroup.expressions.map((expression: any) => expression.filter.stringFilter.value), ['detail_open', 'booking_click']);
    }
    const incomplete = await loadFlightInterest(config, async () => ({ rowCount: 3, rows: [] }));
    const described = parseFlightInterest({ rows: [
        { dimensionValues: ['booking_click', 'recorded', '인천-도쿄', 'ybtour', '2026-09-20', '2026-09-23', '진에어', '100000'].map(value => ({ value })), metricValues: [{ value: '2' }] },
        { dimensionValues: ['detail_open', 'recorded', '인천-도쿄', 'ybtour', '(not set)', '(not set)', '(not set)', '90000'].map(value => ({ value })), metricValues: [{ value: '5' }] },
    ] });
    assert.deepEqual(described.rows[0].recorded, { agency: 'ybtour', departureDate: '2026-09-20', returnDate: '2026-09-23', airline: '진에어', minPrice: 90000, maxPrice: 100000 });
    assert.equal(described.rows[0].detailOpens, 5);
    assert.equal(described.rows[0].bookingClicks, 2);
    assert.equal(incomplete.recent7.available, false);
    const capped = await loadFlightInterest(config, async () => ({ rowCount: 1000, rows: [row('booking_click', 'a', 'A-B', 1)] }));
    assert.equal(capped.current.available, false);
    console.log('PASS: exact ID aggregation, action-only counts, sorting, missing history, report quality, all periods, pagination and independent failures');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
