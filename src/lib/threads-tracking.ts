export interface Tracking { trackingContent: string | null; shareCode: string | null }
export interface OwnReply {
    id: string;
    text?: string;
    link_attachment_url?: string;
    is_reply_owned_by_me?: boolean;
    root_post?: { id: string };
    replied_to?: { id: string };
}

export function extractTracking(text: string): Tracking {
    for (const raw of text.match(/https?:\/\/[^\s]+/gi) || []) {
        try {
            const url = new URL(raw.replace(/[.,!;)}\]]+$/, ''));
            if (!['tikitikit.kr', 'www.tikitikit.kr'].includes(url.hostname)) continue;
            const match = url.pathname.match(/^\/(?:s|t)\/([^/]+)\/?$/);
            if (!match) continue;
            const shareCode = decodeURIComponent(match[1]);
            // /t/g-* redirects use share_group_*, not share_g-*.
            const isGroup = url.pathname.startsWith('/t/') && shareCode.startsWith('g-');
            if (isGroup && shareCode.length === 2) continue;
            return { shareCode, trackingContent: url.searchParams.get('utm_content')
                || (isGroup ? `share_group_${shareCode.slice(2)}` : `share_${shareCode}`) };
        } catch { /* A malformed URL must not break insights for the whole post. */ }
    }
    return { trackingContent: null, shareCode: null };
}

export function connectOwnReplyTracking<T extends Tracking & { id: string }>(
    posts: T[], replies: OwnReply[], complete: boolean, incompleteIssue = 'replies-unavailable',
) {
    return posts.map(post => {
        if (post.trackingContent) return { ...post, trackingReplyIds: [] as string[], trackingIssue: null };
        const candidates = replies.filter(reply => reply.is_reply_owned_by_me === true
            && (reply.root_post?.id || reply.replied_to?.id) === post.id)
            .flatMap(reply => (`${reply.text || ''}\n${reply.link_attachment_url || ''}`.match(/https?:\/\/[^\s]+/gi) || [])
                .map(url => ({ id: reply.id, ...extractTracking(url) })))
            .filter(reply => reply.trackingContent);
        const contents = new Set(candidates.map(reply => reply.trackingContent));
        // Do not guess a single link when collection is incomplete or a thread has multiple campaigns.
        const issue = contents.size > 1 ? 'multiple-links' : !complete ? incompleteIssue : null;
        const match = !issue && contents.size === 1 ? candidates[0] : null;
        return {
            ...post,
            ...(match ? { trackingContent: match.trackingContent, shareCode: match.shareCode } : {}),
            trackingReplyIds: match ? Array.from(new Set(candidates.map(reply => reply.id))) : [],
            trackingIssue: issue,
        };
    });
}
