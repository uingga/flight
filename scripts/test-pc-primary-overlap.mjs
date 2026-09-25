import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeCacheSource } from '../src/lib/merge-cache-source.mjs';
import { mergeCrawlLogHistories } from './merge-crawl-log.mjs';

test('PC primary saves its result before waiting for the matching GitHub publication',()=>{
    const script=fs.readFileSync('scripts/run-source-fallback-crawl.ps1','utf8');
    const saved=script.indexOf('Copy-Item -LiteralPath $CachePath -Destination $SessionCopy');
    const boundary=script.indexOf('if ($CurrentGeneralAt -ge $ExpectedGeneralAt)');
    const late=script.indexOf('New GitHub-failure PC fallbacks for the same slot');
    const merged=script.indexOf('foreach ($Source in $EarlySources)');
    assert.ok(saved>=0 && boundary>saved && late>boundary && merged>late);
    assert.match(script,/if \(\$AfterPolicy\.expectedAt -ne \$Policy\.expectedAt\)/);
    assert.match(script,/result copies preserved at \$SessionCopy and \$LogSessionCopy/);
    assert.doesNotMatch(script.slice(script.indexOf('if ($WaitForGeneral)'),boundary),/npx\.cmd|run-ttang-remote-primary/);
    assert.ok(script.indexOf('if (-not $Published)') < script.indexOf('Remove-Item -LiteralPath $SessionCopy'));
    assert.match(script,/publishing the saved PC-primary result only/);
});

test('early PC and post-GitHub fallback overlays preserve the general round and unrelated sources',()=>{
    const flight=(source,id)=>({source,id,price:100000,departure:{city:'서울',date:'2026-09-27'},arrival:{city:'도쿄'}});
    const general={timestamp:'2026-09-25T04:45:00Z',fullCrawlUpdatedAt:'2026-09-25T04:40:00Z',
        flights:[flight('ybtour','old-yb'),flight('hanatour','fresh-hana'),flight('ttang','old-ttang')],
        sources:{ybtour:1,hanatour:1,ttang:1},sourceUpdatedAt:{hanatour:'2026-09-25T04:39:00Z'},
        sourceCircuits:{ybtour:{nextProbeAt:'2026-09-26T04:00:00Z'}}};
    const early={timestamp:'2026-09-25T04:38:00Z',fullCrawlUpdatedAt:'2026-09-25T01:45:00Z',
        flights:[flight('ttang','new-ttang')],sourceUpdatedAt:{ttang:'2026-09-25T04:37:00Z'},
        ttangPrimary:{status:'success',lastAttemptAt:'2026-09-25T04:23:00Z'}};
    const late={timestamp:'2026-09-25T04:50:00Z',fullCrawlUpdatedAt:general.fullCrawlUpdatedAt,
        flights:[flight('ybtour','new-yb')],sourceUpdatedAt:{ybtour:'2026-09-25T04:49:00Z'},
        sourceCircuits:{ybtour:{nextProbeAt:'2026-09-26T04:00:00Z',localFallback:{status:'success'}}}};
    mergeCacheSource(general,early,'ttang');
    mergeCacheSource(general,late,'ybtour');
    assert.equal(general.fullCrawlUpdatedAt,'2026-09-25T04:40:00Z');
    assert.deepEqual(general.flights.map(f=>f.id),['fresh-hana','new-ttang','new-yb']);
    assert.equal(general.sourceUpdatedAt.hanatour,'2026-09-25T04:39:00Z');
    assert.equal(general.sourceUpdatedAt.ttang,'2026-09-25T04:37:00Z');
    assert.equal(general.sourceUpdatedAt.ybtour,'2026-09-25T04:49:00Z');
    assert.equal(general.sourceCircuits.ybtour.localFallback.status,'success');

    const entry=(timestamp,sites)=>({timestamp,sites,alerts:[]});
    const start={entries:[entry('2026-09-25T04:40:00Z',{hanatour:{scraped:42}})]};
    const earlyLog={entries:[entry('2026-09-25T04:38:00Z',{ttang:{scraped:128}})]};
    const lateLog={entries:[entry('2026-09-25T04:50:00Z',{ybtour:{scraped:190}})]};
    const first=mergeCrawlLogHistories(start,earlyLog,['ttang'],Date.parse('2026-09-25T05:00:00Z')).history;
    const result=mergeCrawlLogHistories(first,lateLog,['ybtour'],Date.parse('2026-09-25T05:00:00Z')).history;
    assert.deepEqual(result.entries.map(item=>Object.keys(item.sites)[0]),['ttang','hanatour','ybtour']);
});
