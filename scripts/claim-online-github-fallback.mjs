import fs from 'node:fs';
import { claimOnlineGithubFallback } from './online-github-fallback-policy.mjs';

const file='data/all-flights-cache.json';
try {
    const cache=JSON.parse(fs.readFileSync(file,'utf8'));
    const claimed=claimOnlineGithubFallback({cache,expectedAt:process.env.CRAWL_EXPECTED_AT,
        runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT});
    fs.writeFileSync(file,JSON.stringify(claimed,null,2));
    if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'claimed=true\n');
    console.log('OnlineTour GitHub fallback slot claimed; no site request yet.');
} catch {
    if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'claimed=false\n');
    console.log('OnlineTour fallback not eligible; no site request.');
}
