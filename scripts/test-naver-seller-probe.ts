import assert from 'node:assert/strict';
import {
    appendNaverSellerProbePage,
    createNaverSellerProbeSummary,
    inspectNaverGraphqlSellerHints,
} from '../src/lib/naver-seller-probe';

const hints = inspectNaverGraphqlSellerHints({
    data: {
        offers: [
            { provider: { name: '트립닷컴' }, totalPrice: 181_600 },
            { sellerName: '마이리얼트립', farePrice: 181_600 },
            { airline: { name: '에어부산' }, price: 170_000 },
        ],
        hotel: { providerName: '호텔 판매처', price: 51_000 },
    },
});

assert.deepEqual(hints.fieldNames.sort(), ['provider', 'sellerName']);
assert.deepEqual(hints.sellerSamples.sort(), ['마이리얼트립', '트립닷컴']);
assert.deepEqual(hints.priceLinkedSellerSamples.sort(), ['마이리얼트립', '트립닷컴']);

let summary = createNaverSellerProbeSummary();
summary = appendNaverSellerProbePage(summary, {
    explicitSellerNodeCount: 2,
    exactPriceSellerRows: 1,
    sellerSamples: ['트립닷컴'],
    priceContextSamples: ['div.offer | 트립닷컴 181,600원'],
    graphql: hints,
});
summary = appendNaverSellerProbePage(summary, {
    explicitSellerNodeCount: 0,
    exactPriceSellerRows: 0,
    sellerSamples: [],
    priceContextSamples: [],
    graphql: { fieldNames: [], sellerSamples: [], priceLinkedSellerSamples: [] },
});

assert.equal(summary.mode, 'passive_only');
assert.equal(summary.pagesInspected, 2);
assert.equal(summary.pagesWithExplicitSellerNodes, 1);
assert.equal(summary.pagesWithExactPriceSellerRows, 1);
assert.deepEqual(summary.sellerSamples.sort(), ['마이리얼트립', '트립닷컴']);

console.log('✅ Naver passive seller probe tests passed');
