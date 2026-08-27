function unwrap(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return trimmed.slice(1, -1).trim();
        }
    }
    return trimmed;
}

/**
 * web-push expects unpadded URL-safe Base64. Secret managers and copy/paste
 * flows sometimes preserve standard Base64 padding or surrounding quotes.
 */
export function normalizeVapidKey(value: string): string {
    return unwrap(value)
        .replace(/\s+/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}
