export const CONTACT_TYPES = {
    question: '이용 문의',
    error: '오류 제보',
    suggestion: '개선 제안',
    partnership: '제휴 문의',
} as const;
export type ContactType = keyof typeof CONTACT_TYPES;
export function isContactType(value: unknown): value is ContactType {
    return typeof value === 'string' && Object.hasOwn(CONTACT_TYPES, value);
}
export const CONTACT_IMAGE_LIMIT = 1024 * 1024;
export function validContactImage(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > Math.ceil(CONTACT_IMAGE_LIMIT / 3) * 4 + 40) return false;
    return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
