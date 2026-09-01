export interface NaverGraphqlSellerHints {
    fieldNames: string[];
    sellerSamples: string[];
    priceLinkedSellerSamples: string[];
}

export interface NaverSellerProbePage {
    explicitSellerNodeCount: number;
    exactPriceSellerRows: number;
    sellerSamples: string[];
    priceContextSamples: string[];
    graphql: NaverGraphqlSellerHints;
}

export interface NaverSellerProbeSummary {
    mode: 'passive_only';
    pagesInspected: number;
    pagesWithExplicitSellerNodes: number;
    pagesWithExactPriceSellerRows: number;
    graphqlSellerFieldHits: number;
    sellerSamples: string[];
    priceContextSamples: string[];
    graphqlFieldNames: string[];
    graphqlPriceLinkedSellerSamples: string[];
}

const SELLER_KEY = /seller|provider|agency|vendor|merchant|mall|\bota\b|agent/i;
const PRICE_KEY = /^(?:price|farePrice|totalPrice|fare)$/i;
const EXCLUDED_SECTION = /hotel|priceGraph|banner|flightsCards|airportDetail/i;

function uniqueLimited(values: string[], limit: number): string[] {
    return Array.from(new Set(values.map(value => value.trim()).filter(Boolean))).slice(0, limit);
}

function sellerStrings(value: unknown): string[] {
    if (typeof value === 'string') {
        const clean = value.replace(/\s+/g, ' ').trim();
        if (
            clean.length >= 2
            && clean.length <= 60
            && /[가-힣A-Za-z]/.test(clean)
            && !/\d{1,3}(?:,\d{3})+\s*원|왕복|편도|성인|결제수단|최저가/i.test(clean)
        ) {
            return [clean];
        }
        return [];
    }
    if (Array.isArray(value)) return value.flatMap(sellerStrings);
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    return ['name', 'label', 'title', 'displayName', 'providerName', 'sellerName']
        .flatMap(key => sellerStrings(record[key]));
}

/** 이미 받은 GraphQL JSON에서 판매처로 명시된 키만 진단한다. */
export function inspectNaverGraphqlSellerHints(json: unknown): NaverGraphqlSellerHints {
    const fieldNames: string[] = [];
    const sellerSamples: string[] = [];
    const priceLinkedSellerSamples: string[] = [];

    const walk = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
            value.forEach(walk);
            return;
        }
        const record = value as Record<string, unknown>;
        const localSellers: string[] = [];
        let hasDirectPrice = false;
        for (const [key, child] of Object.entries(record)) {
            if (SELLER_KEY.test(key)) {
                fieldNames.push(key);
                const samples = sellerStrings(child);
                sellerSamples.push(...samples);
                localSellers.push(...samples);
            }
            if (PRICE_KEY.test(key) && typeof child === 'number' && child > 10_000) {
                hasDirectPrice = true;
            }
        }
        if (hasDirectPrice) priceLinkedSellerSamples.push(...localSellers);
        for (const [key, child] of Object.entries(record)) {
            if (!EXCLUDED_SECTION.test(key)) walk(child);
        }
    };

    walk(json);
    return {
        fieldNames: uniqueLimited(fieldNames, 20),
        sellerSamples: uniqueLimited(sellerSamples, 10),
        priceLinkedSellerSamples: uniqueLimited(priceLinkedSellerSamples, 10),
    };
}

export function createNaverSellerProbeSummary(): NaverSellerProbeSummary {
    return {
        mode: 'passive_only',
        pagesInspected: 0,
        pagesWithExplicitSellerNodes: 0,
        pagesWithExactPriceSellerRows: 0,
        graphqlSellerFieldHits: 0,
        sellerSamples: [],
        priceContextSamples: [],
        graphqlFieldNames: [],
        graphqlPriceLinkedSellerSamples: [],
    };
}

export function appendNaverSellerProbePage(
    summary: NaverSellerProbeSummary,
    page: NaverSellerProbePage,
): NaverSellerProbeSummary {
    return {
        mode: 'passive_only',
        pagesInspected: summary.pagesInspected + 1,
        pagesWithExplicitSellerNodes: summary.pagesWithExplicitSellerNodes + (page.explicitSellerNodeCount > 0 ? 1 : 0),
        pagesWithExactPriceSellerRows: summary.pagesWithExactPriceSellerRows + (page.exactPriceSellerRows > 0 ? 1 : 0),
        graphqlSellerFieldHits: summary.graphqlSellerFieldHits + page.graphql.fieldNames.length,
        sellerSamples: uniqueLimited([...summary.sellerSamples, ...page.sellerSamples, ...page.graphql.sellerSamples], 10),
        priceContextSamples: uniqueLimited([...summary.priceContextSamples, ...page.priceContextSamples], 8),
        graphqlFieldNames: uniqueLimited([...summary.graphqlFieldNames, ...page.graphql.fieldNames], 20),
        graphqlPriceLinkedSellerSamples: uniqueLimited([
            ...summary.graphqlPriceLinkedSellerSamples,
            ...page.graphql.priceLinkedSellerSamples,
        ], 10),
    };
}
