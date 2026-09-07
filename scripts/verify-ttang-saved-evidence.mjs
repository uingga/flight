// Read-only verification of a saved staging run using the current validator. No browser/network.
import fs from 'node:fs';
import path from 'node:path';
import { readTtangPartialSummary, countFreshTtangDetails, isTtangStagingReady } from './ttang-staging-validation.mjs';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--staging') throw new Error('Usage: --staging <existing-staging-directory>');
const dir = path.resolve(args[1]);
const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
const cache = JSON.parse(fs.readFileSync(path.join(dir, 'all-flights-cache.json'), 'utf8'));
const partial = readTtangPartialSummary(dir, summary.runId);
const flights = cache.flights.filter(f => f.source === 'ttang');
const counts = countFreshTtangDetails(flights, partial.startedAt, { runId: summary.runId, partialDetails: partial });
const exactSavedCountMatch = summary.ttang?.timeVerified === counts.timeVerified && summary.ttang?.seatVerified === counts.seatVerified;
const ready = isTtangStagingReady({ sourceAccepted: flights.length > 0, ...counts, partialDetails: partial }) && exactSavedCountMatch;
console.log(JSON.stringify({ evidence: 'saved_staging_revalidated_not_new_collection', runId: summary.runId,
    savedStatus: summary.status, checkpointStatus: partial.status, counts: partial.counts,
    timeVerified: counts.timeVerified, seatVerified: counts.seatVerified, exactSavedCountMatch,
    savedEvidenceValid: ready, siteRequests: 0, productionReady: false }));
process.exitCode = ready ? 0 : 1;
