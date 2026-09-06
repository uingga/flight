// Offline fixture: no browser or external requests. Parent kills this process after durable checkpoint.
import { TtangDetailCheckpoint } from '../../src/lib/ttang-detail-checkpoint';
import type { TtangTimeCandidate } from '../../src/lib/ttang-time-enrichment';

const root = process.argv[2];
const dir = process.argv[3];
const candidates = ['101', '102'].map(fareId => ({
    key: `product|10|${fareId}|20991001`,
    product: { masterId: '10', fareId, fareType: 'VV', carrierCode: '7C', depCode: 'ICN', arrCode: 'NRT', departureDate: '20991001', arrivalDate: '20991004' },
    flights: [], routeId: '', route: { depCode: 'ICN', arrCode: 'NRT', depDate: '20991001', arrDate: '20991004', airline: '제주항공' },
    priority: 0, lastAttemptAt: 0,
} satisfies TtangTimeCandidate));
const writer = new TtangDetailCheckpoint(root, dir, 'interruption-test', new Date(Date.now() - 1000), 'test-adapter');
writer.begin(candidates, 0);
writer.start(candidates[0].key);
writer.record(candidates[0], { status: 'success', data: { depTime: '09:00', arrTime: '11:00', retDepTime: '18:00', retArrTime: '20:00', seats: 2 } }, new Date());
writer.start(candidates[1].key);
process.send?.('checkpoint-durable');
setInterval(() => {}, 1000);
