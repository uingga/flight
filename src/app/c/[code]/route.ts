import { NextRequest, NextResponse } from 'next/server';
import { SHARE_GROUPS } from '@/lib/share-groups';

type RouteContext = {
    params: Promise<{ code: string }>;
};

const TE31_PREFIX = 'te31-';

const TRACKED_SHARE_LINKS: Record<string, {
    groupCode: string;
    source: string;
    medium: string;
    campaign: string;
}> = {
    'blog-pqc1438': {
        groupCode: 'pqc1438',
        source: 'naver_blog',
        medium: 'content',
        campaign: 'tikitikit_drop_004',
    },
};

/** 채널별 유입과 이후 예약 행동을 분리해서 보는 짧은 공유 링크. */
export async function GET(request: NextRequest, { params }: RouteContext) {
    const { code } = await params;
    const trackedLink = TRACKED_SHARE_LINKS[code];
    const isTe31Link = code.startsWith(TE31_PREFIX);
    if (!trackedLink && !isTe31Link) {
        return NextResponse.redirect(new URL('/', request.url), 302);
    }

    const groupCode = trackedLink?.groupCode || code.slice(TE31_PREFIX.length);
    if (!SHARE_GROUPS[groupCode]) {
        return NextResponse.redirect(new URL('/', request.url), 302);
    }

    const destination = new URL(`/share-group/${encodeURIComponent(groupCode)}`, request.url);
    destination.searchParams.set('utm_source', trackedLink?.source || 'te31');
    destination.searchParams.set('utm_medium', trackedLink?.medium || 'community');
    destination.searchParams.set('utm_campaign', trackedLink?.campaign || 'tikitikit_te31');
    destination.searchParams.set('utm_content', `share_group_${groupCode}`);
    request.nextUrl.searchParams.forEach((value, key) => destination.searchParams.set(key, value));

    return NextResponse.redirect(destination, 307);
}
