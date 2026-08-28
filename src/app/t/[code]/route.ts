import { NextRequest, NextResponse } from 'next/server';
import { decodeShareCode } from '@/lib/share-code';

type RouteContext = {
    params: Promise<{ code: string }>;
};

/** Threads 전용 짧은 링크. 주소는 짧게 유지하면서 글별 사이트 행동을 GA4에 연결한다. */
export async function GET(request: NextRequest, { params }: RouteContext) {
    const { code } = await params;
    const flightId = decodeShareCode(decodeURIComponent(code));
    if (!flightId) return NextResponse.redirect(new URL('/', request.url), 302);

    const destination = new URL(`/share/${encodeURIComponent(flightId)}`, request.url);
    destination.searchParams.set('utm_source', 'threads');
    destination.searchParams.set('utm_medium', 'social');
    destination.searchParams.set('utm_campaign', 'tikitikit_threads');
    destination.searchParams.set('utm_content', `share_${code}`);
    request.nextUrl.searchParams.forEach((value, key) => destination.searchParams.set(key, value));

    return NextResponse.redirect(destination, 307);
}
