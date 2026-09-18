import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerLink } from './register-threads-link';
import { connectVerifiedPostLinks, VERIFIED_THREADS_POST_LINKS } from '../src/lib/threads-post-links';

const input = { postUrl: 'https://www.threads.com/@tikitikit.kr/post/root',
    replyUrl: 'https://www.threads.com/@tikitikit.kr/post/reply',
    link: 'https://www.tikitikit.kr/t/g-sha-260917', verifiedOn: '2026-09-18', confirmed: true };

test('registration is explicit, idempotent, and refuses conflicting evidence', () => {
    const rows = registerLink([], input);
    assert.equal(registerLink(rows, input), rows);
    assert.throws(() => registerLink(rows, { ...input, link: 'https://www.tikitikit.kr/t/g-other' }), /differs/);
    assert.throws(() => registerLink([], { ...input, confirmed: false }), /Confirm/);
    assert.throws(() => registerLink([], { ...input, replyUrl: input.postUrl }), /separate/);
    assert.throws(() => registerLink([], { ...input, verifiedOn: '2026-02-30' }), /date/);
    assert.throws(() => registerLink([], { ...input, postUrl: input.postUrl.replace('tikitikit.kr', 'someone') }), /exact/);
});

test('plain landing links and foreign-source or secret query values cannot enter registry', () => {
    for (const link of ['https://www.tikitikit.kr/share-group/can-260918',
        'https://evil.example/t/x', `${input.link}?utm_source=te31`, `${input.link}?token=private`]) {
        assert.throws(() => registerLink([], { ...input, link }));
    }
    assert.equal(registerLink([], { ...input, link: `${input.link}?utm_content=custom_post` }).length, 1);
});

test('each verified recent root reconnects without inventing visits or overriding fresh ambiguity', () => {
    assert.equal(VERIFIED_THREADS_POST_LINKS.length, 6);
    for (const entry of VERIFIED_THREADS_POST_LINKS) {
        const post = { id: entry.postId || 'live-id', permalink: `https://www.threads.com${entry.postPath}`,
            trackingContent: null, shareCode: null, trackingIssue: 'replies-request-failed' };
        const linked = connectVerifiedPostLinks([post])[0];
        assert.ok(linked.trackingContent);
        assert.equal(linked.trackingIssue, 'replies-request-failed');
        assert.ok(!('attribution' in linked));
        assert.equal(connectVerifiedPostLinks([{ ...post, trackingIssue: 'multiple-links' }])[0].trackingContent, null);
        assert.equal(connectVerifiedPostLinks([{ ...post, permalink: post.permalink.replace('www.threads.com', 'evil.example') }])[0].trackingContent, null);
    }
});
