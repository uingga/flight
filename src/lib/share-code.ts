const SHARE_PREFIXES = [
    ['modetour-ASIA-', 'm'],
    ['hanatour-', 'h'],
    ['ybtour-', 'y'],
    ['online-', 'o'],
    ['ttang-', 't'],
    ['mrt-', 'r'],
] as const;

export function encodeShareId(flightId: string): string {
    const matched = SHARE_PREFIXES.find(([prefix]) => flightId.startsWith(prefix));
    if (!matched) return `x${flightId}`;
    const [prefix, code] = matched;
    return `${code}${flightId.slice(prefix.length)}`;
}

export function decodeShareCode(shareCode: string): string | null {
    if (!shareCode) return null;
    if (shareCode.startsWith('x')) return shareCode.slice(1) || null;
    const matched = SHARE_PREFIXES.find(([, code]) => code === shareCode[0]);
    if (!matched) return null;
    const [prefix] = matched;
    return `${prefix}${shareCode.slice(1)}`;
}
