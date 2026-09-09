import { extractTracking, type Tracking } from './threads-tracking';

// Explicit, audited relationships only. Never infer a post from a city, price or traffic count.
// Verified in the public root thread and its own reply on 2026-09-09.
export const VERIFIED_THREADS_POST_LINKS = [{
    postId: '18338163979251867',
    postPath: '/@tikitikit.kr/post/DdAzc1RD1sp',
    replyUrl: 'https://www.threads.com/@tikitikit.kr/post/DdAzdN9j4m3',
    url: 'https://tikitikit.kr/s/xmodetour-CHI-20107439',
    verifiedOn: '2026-09-09',
}] as const;

export function connectVerifiedPostLinks<T extends Tracking & {
    id: string; permalink: string; trackingIssue?: string | null;
}>(posts: T[]) {
    return posts.map(post => {
        // Fresh API evidence and ambiguous multi-link threads always take precedence.
        if (post.trackingContent || post.trackingIssue === 'multiple-links') return post;
        let path: string;
        try {
            const url = new URL(post.permalink);
            if (!['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'].includes(url.hostname)) return post;
            path = url.pathname.replace(/\/$/, '');
        } catch { return post; }
        const verified = VERIFIED_THREADS_POST_LINKS.find(item => item.postId === post.id && item.postPath === path);
        if (!verified) return post;
        return { ...post, ...extractTracking(verified.url), trackingSource: 'verified-link' as const,
            trackingVerifiedReplyUrl: verified.replyUrl };
    });
}
