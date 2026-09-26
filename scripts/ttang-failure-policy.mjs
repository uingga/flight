import { TTANG_PROTOCOL } from './ttang-primary-policy.mjs';

const PRE_BROWSER_REASONS = new Set([
    'dedicated_chrome_owner_unverified', 'dedicated_chrome_owner_query_timeout',
    'dedicated_chrome_owner_query_failed', 'dedicated_chrome_owner_changed',
    'dedicated_chrome_unavailable', 'dedicated_chrome_endpoint_invalid',
    'dedicated_chrome_requires_windows',
]);

// Zero observed results alone prove nothing. Require correlated evidence that
// the worker never started collection and finished cleanup. Legacy replies and
// transport failures lack this proof and retain the existing protection.
export function isTtangPreflightFailure(reply, id) {
    return typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)
        && reply?.protocol === TTANG_PROTOCOL && reply.id === id && reply.status === 'failed'
        && PRE_BROWSER_REASONS.has(reply.reason) && reply.phase === 'browser_preflight'
        && reply.siteRequestsStarted === false && reply.uncertain === false
        && reply.restricted === false && reply.cleanupConfirmed === true
        && reply.observedCount === 0 && reply.cooldown == null && reply.bundle == null;
}
