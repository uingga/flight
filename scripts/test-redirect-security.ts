import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/redirect/route';

const PRIMARY = 'https://www.hanatour.com/booking/start';
const FALLBACK = 'https://www.hanatour.com/flights/search';
const VALID_HTML = `<!doctype html><html><body>${'예약 가능한 항공권 '.repeat(80)}</body></html>`;
const originalFetch = globalThis.fetch;

function request(primary: string | null, fallback?: string): NextRequest {
    const params = new URLSearchParams();
    if (primary !== null) params.set('url', primary);
    if (fallback) params.set('fallback', fallback);
    return new NextRequest(`https://tikitikit.kr/api/redirect?${params.toString()}`);
}

function locationOf(response: Response): string | null {
    const location = response.headers.get('location');
    return location ? new URL(location).toString() : null;
}

async function withFetchMock(
    mock: typeof fetch,
    run: () => Promise<void>,
): Promise<void> {
    globalThis.fetch = mock;
    try {
        await run();
    } finally {
        globalThis.fetch = originalFetch;
    }
}

async function testInitialUrlValidation() {
    let fetchCount = 0;
    await withFetchMock((async () => {
        fetchCount += 1;
        throw new Error('fetch should not run');
    }) as typeof fetch, async () => {
        const invalidUrls = [
            null,
            'http://www.hanatour.com/booking',
            'https://www.hanatour.com:444/booking',
            'https://user@www.hanatour.com/booking',
            'https://www.hanatour.com.evil.example/booking',
            'https://127.0.0.1/internal',
        ];
        for (const invalid of invalidUrls) {
            const response = await GET(request(invalid));
            assert.equal(response.status, 400, `초기 URL을 거부해야 합니다: ${invalid}`);
        }
        assert.equal(fetchCount, 0);
    });
}

async function testAllowedRedirectChain() {
    const fetched: string[] = [];
    await withFetchMock((async (input, init) => {
        const url = new URL(input.toString());
        fetched.push(url.toString());
        assert.equal(init?.redirect, 'manual');
        assert.ok(init?.signal instanceof AbortSignal, '전체 체인에 타임아웃 신호가 있어야 합니다.');
        if (url.pathname === '/booking/start') {
            return new Response(null, { status: 302, headers: { Location: '/booking/middle' } });
        }
        if (url.pathname === '/booking/middle') {
            return new Response(null, { status: 307, headers: { Location: 'https://m.hanatour.com/booking/final' } });
        }
        return new Response(VALID_HTML, { status: 200 });
    }) as typeof fetch, async () => {
        const response = await GET(request(PRIMARY, FALLBACK));
        assert.equal(response.status, 307);
        assert.equal(locationOf(response), new URL(PRIMARY).toString());
        assert.equal(fetched.length, 3);
        assert.equal(new URL(fetched[2]).hostname, 'm.hanatour.com');
    });
}

async function testUnsafeHopUsesFallback() {
    let fetchCount = 0;
    await withFetchMock((async () => {
        fetchCount += 1;
        return new Response(null, {
            status: 302,
            headers: { Location: 'http://127.0.0.1/internal' },
        });
    }) as typeof fetch, async () => {
        const response = await GET(request(PRIMARY, FALLBACK));
        assert.equal(response.status, 307);
        assert.equal(locationOf(response), new URL(FALLBACK).toString());
        assert.equal(fetchCount, 1, '허용되지 않은 다음 홉은 서버가 요청하면 안 됩니다.');

        const noSafeFallback = await GET(request(PRIMARY, 'https://evil.example/fallback'));
        assert.equal(noSafeFallback.status, 502);
        assert.equal(fetchCount, 2);
    });
}

async function testRedirectLimit() {
    let fetchCount = 0;
    await withFetchMock((async () => {
        fetchCount += 1;
        return new Response(null, {
            status: 302,
            headers: { Location: `https://www.hanatour.com/booking/hop-${fetchCount}` },
        });
    }) as typeof fetch, async () => {
        const response = await GET(request(PRIMARY, FALLBACK));
        assert.equal(response.status, 307);
        assert.equal(locationOf(response), new URL(FALLBACK).toString());
        assert.equal(fetchCount, 6, '최초 요청과 최대 5개 리다이렉트까지만 확인해야 합니다.');
    });
}

async function testTimeoutUsesFallback() {
    await withFetchMock((async (_input, init) => {
        assert.ok(init?.signal, '타임아웃 신호가 fetch에 전달돼야 합니다.');
        throw new DOMException('probe timed out', 'TimeoutError');
    }) as typeof fetch, async () => {
        const response = await GET(request(PRIMARY, FALLBACK));
        assert.equal(response.status, 307);
        assert.equal(locationOf(response), new URL(FALLBACK).toString());
    });
}

async function testResponseSizeLimits() {
    await withFetchMock((async () => new Response(VALID_HTML, {
        status: 200,
        headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) },
    })) as typeof fetch, async () => {
        const response = await GET(request(PRIMARY, FALLBACK));
        assert.equal(response.status, 307);
        assert.equal(locationOf(response), new URL(FALLBACK).toString());
    });

    let canceled = false;
    const oversizedChunk = new TextEncoder().encode(`<!doctype html>${'x'.repeat(100_000)}`);
    await withFetchMock((async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(oversizedChunk); },
        cancel() { canceled = true; },
    }), { status: 200 })) as typeof fetch, async () => {
        const response = await GET(request(PRIMARY, FALLBACK));
        assert.equal(response.status, 307);
        assert.equal(locationOf(response), new URL(PRIMARY).toString());
        assert.equal(canceled, true, '검사 한도 이후의 응답 스트림을 취소해야 합니다.');
    });
}

async function testExpiredFareStillUsesFallback() {
    await withFetchMock((async () => new Response('<!doctype html><script>alert("유효하지 않은 fareId")</script>', {
        status: 200,
    })) as typeof fetch, async () => {
        const response = await GET(request(PRIMARY, FALLBACK));
        assert.equal(response.status, 307);
        assert.equal(locationOf(response), new URL(FALLBACK).toString());
    });
}

async function main() {
    await testInitialUrlValidation();
    await testAllowedRedirectChain();
    await testUnsafeHopUsesFallback();
    await testRedirectLimit();
    await testTimeoutUsesFallback();
    await testResponseSizeLimits();
    await testExpiredFareStillUsesFallback();
    console.log('✅ 예약 리다이렉트 SSRF·횟수·타임아웃·응답 크기·폴백 테스트 통과');
}

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
