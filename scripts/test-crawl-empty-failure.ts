import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the actual orchestration failure branch, without importing/running the crawler.
const source = fs.readFileSync('scripts/crawl-all.ts','utf8');
const start = source.indexOf('if (fresh === undefined) {');
const end = source.indexOf('// 0건은 명백한 실패',start);
assert.ok(start > 0 && end > start);
const branch = source.slice(start,end);
for (const prevCount of [0,3]) {
    const markers: string[] = [], alerts: string[] = [];
    vm.runInNewContext(`for(let once=0;once<1;once++){${branch}}`,{
        fresh:undefined,prevCount,src:'onlinetour',scrapeFailures:{onlinetour:'unexpected_api_query'},
        integrityWarnings:alerts,keepPrevious:(_reason:string,alert:string)=>{markers.push('onlinetour');alerts.push(alert);},
    });
    assert.deepEqual(markers,['onlinetour'],'failure must be marked even without previous flights');
    assert.match(alerts[0],/unexpected_api_query/);
}
console.log('PASS actual crawl failure branch with zero and nonzero previous inventory; site requests=0');
