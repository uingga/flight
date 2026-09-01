import { NextRequest, NextResponse } from 'next/server';
import { SHARE_GROUPS } from '@/lib/share-groups';

type RouteContext = {
    params: Promise<{ code: string }>;
};

const TE31_PREFIX = 'te31-';

/** 커뮤니티별 유입과 이후 예약 행동을 분리해서 보는 짧은 공유 링크. */
export async function GET(request: NextRequest, { params }: RouteContext) {
    const { code } = await params;
    if (!code.startsWith(TE31_PREFIX)) {
        return NextResponse.redirect(new URL('/', request.url), 302);
    }

    const groupCode = code.slice(TE31_PREFIX.length);
    if (!SHARE_GROUPS[groupCode]) {
        return NextResponse.redirect(new URL('/', request.url), 302);
    }

    const destination = new URL(`/share-group/${encodeURIComponent(groupCode)}`, request.url);
    destination.searchParams.set('utm_source', 'te31');
    destination.searchParams.set('utm_medium', 'community');
    destination.searchParams.set('utm_campaign', 'tikitikit_te31');
    destination.searchParams.set('utm_content', `share_group_${groupCode}`);
    request.nextUrl.searchParams.forEach((value, key) => destination.searchParams.set(key, value));

    return NextResponse.redirect(destination, 307);
}
