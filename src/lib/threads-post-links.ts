import { extractTracking, type Tracking } from './threads-tracking';

// Explicit, audited relationships only. Never infer a post from a city, price or traffic count.
// Each record includes its own verification date and, where available, reply permalink.
import registry from './threads-post-links.json';

export interface VerifiedThreadsLink {
    postId: string | null; postPath: string; replyUrl?: string; url: string; verifiedOn: string;
}
export const VERIFIED_THREADS_POST_LINKS: readonly VerifiedThreadsLink[] = registry;

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
        const verified = VERIFIED_THREADS_POST_LINKS.find(item => (item.postId === null || item.postId === post.id) && item.postPath === path);
        if (!verified) return post;
        return { ...post, ...extractTracking(verified.url), trackingSource: 'verified-link' as const,
            trackingVerifiedReplyUrl: verified.replyUrl };
    });
}
