// @ts-nocheck
// 모두투어 스크래퍼 링크 테스트 (path alias 우회)
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// tsconfig paths 우회: @/ → ./src/
const origResolve = import.meta.resolve;

const { scrapeModetour } = await import('./src/lib/scrapers/modetour.ts');

const flights = await scrapeModetour();
console.log(`\n총 ${flights.length}개 모두투어 항공편`);
console.log('\n--- 링크 샘플 (처음 5개) ---');
flights.slice(0, 5).forEach(f => {
    console.log(`${f.departure.city} -> ${f.arrival.city}`);
    console.log(`  ${f.link}`);
    console.log();
});
