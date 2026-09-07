// Reconstruct an audited saved run without opening Chrome or calling any website.
import fs from 'node:fs';
import path from 'node:path';
import { MODE_REMOTE_PROTOCOL, validateModeBundle } from '../src/lib/modetour-operational';
import { modeScopeKey } from '../src/lib/modetour-browser';
async function main() {
    const [dir, output, cachePath] = process.argv.slice(2);
    if (!dir || !output || !cachePath) throw new Error('paths_required');
    const read = (name:string) => JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
    const result=read('candidate.json'), plan=read('plan.json'), diagnostics=read('diagnostics.json'), continuation=read('continuation.json');
    if (result.runId !== 'b84093b0-cdad-4da7-b6e8-fea768e6a557' || continuation.parentRunId !== 'c8ff9e0b-5c9c-4bc2-9beb-d9def589b5c0'
        || diagnostics.listRequests !== 9 || result.listRequests !== 15 || result.reusedScopes !== 5) throw new Error('unexpected_import_evidence');
    const raw:Record<string,unknown[]>={};
    for(const scope of plan.scopes) { const key=modeScopeKey(scope); if(!result.failed.some((f:any)=>f.scope===key)) raw[key]=read(key.replace('/','-')+'.json'); }
    const bundle={protocol:MODE_REMOTE_PROTOCOL,capturedAt:result.capturedAt,plan,raw,result};
    const cache=JSON.parse(fs.readFileSync(cachePath,'utf8'));
    const verified=await validateModeBundle(bundle,cache.flights,cache.modetourPrimary?.scopeCounts);
    fs.writeFileSync(output,JSON.stringify(bundle),{flag:'wx'});
    console.log(JSON.stringify({raw:verified.rawCount,flights:verified.flights.length,retained:verified.retained.length,partial:verified.partial,siteRequests:0}));
}
void main().catch(e=>{console.error(e.message);process.exitCode=1;});
