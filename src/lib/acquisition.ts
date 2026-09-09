import type { ReportResponse } from './ga4';
export interface AcquisitionSource { source: string; label: string; sessions: number; users: number | null; rawSources?: string[] }
export interface AcquisitionGroup { label: string; sessions: number; users: number | null; sources: AcquisitionSource[] }
export interface AcquisitionData { available: boolean; groups: AcquisitionGroup[]; sourceRows?: Array<AcquisitionSource & { categories: string[] }>; message?: string }
const missing = (s: string) => ['', '(not set)', '(none)', '(other)', '(empty)'].includes(s.trim().toLowerCase());
const host = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
const domain = (s: string, d: string) => s === d || s.endsWith('.' + d);
/** Internal agency codes are not verified referring websites. Keep their records separately. */
export const isAgencySourceCode = (source: string) => ['hanatour','modetour','myrealtrip','ybtour','ttang','onlinetour'].includes(source.trim().toLowerCase());
export function classifyAcquisition(channel: string, source: string, medium: string): string {
    const s = host(source), m = medium.trim().toLowerCase();
    if (s === '(direct)') return '직접 방문';
    if (missing(s)) return '출처 확인 불가';
    if (s === 'user_share') return '사용자 공유';
    if (s === 'te31' || domain(s, 'te31.com') || m === 'community' || s === 'travel_community') return '커뮤니티';
    if (['cpc', 'ppc', 'paidsearch', 'paid_search'].includes(m) || channel === 'Paid Search') return '검색 광고';
    if (channel === 'Paid Social') return 'SNS 광고';
    if (domain(s, 'keep.naver.com')) return '기타 외부 링크';
    if (s === 'naver_blog' || domain(s, 'blog.naver.com')) return '블로그';
    if (['chat.openai.com', 'chatgpt.com', 'perplexity.ai', 'claude.ai', 'copilot.microsoft.com', 'gemini.google.com'].some(d => domain(s, d)) || ['chatgpt', 'gemini'].includes(s) || channel === 'AI Assistant') return 'AI 서비스';
    if (['instagram.com', 'threads.net', 'threads.com', 'facebook.com', 'twitter.com', 'x.com', 't.co'].some(d => domain(s, d)) || ['instagram','threads','facebook','twitter'].includes(s) || m.includes('social') || channel === 'Organic Social') return 'SNS';
    if (m === 'email' || channel === 'Email') return '이메일';
    if (m === 'organic' || channel === 'Organic Search' || ['naver','google','bing','daum'].includes(s) || domain(s, 'search.naver.com')) return '검색';
    if (m === 'referral' || channel === 'Referral') return '기타 외부 링크';
    return '유형 미분류';
}
/** Group known aliases only; never infer a source from an unrelated domain. */
export function acquisitionSourceKey(source: string): string {
    const s = host(source);
    if (domain(s, 'keep.naver.com')) return 'keep.naver.com';
    if (s === 'naver_blog' || domain(s, 'blog.naver.com')) return 'naver_blog';
    if (s === 'naver' || domain(s, 'search.naver.com')) return 'naver';
    if (domain(s, 'chatgpt.com') || domain(s, 'chat.openai.com') || s === 'chatgpt') return 'chatgpt.com';
    if (domain(s, 'gemini.google.com') || s === 'gemini') return 'gemini.google.com';
    if (s === 'te31' || domain(s, 'te31.com')) return 'te31';
    return source;
}
export function acquisitionSourceLabel(source: string): string {
    const s = host(source);
    // Preserve historical counts and raw source; never assume these are agency visitors.
    if (isAgencySourceCode(source)) return source + ' (출처 확인 필요)';
    if (s === 'te31' || domain(s, 'te31.com')) return 'TE31';
    if (s === 'user_share') return '항공권 공유 링크';
    if (domain(s, 'keep.naver.com')) return '네이버 Keep';
    if (domain(s, 'search.naver.com') || s === 'naver') return '네이버 검색';
    if (s === 'naver_blog' || domain(s, 'blog.naver.com')) return '네이버 블로그';
    if (domain(s, 'chatgpt.com') || domain(s, 'chat.openai.com') || s === 'chatgpt') return 'ChatGPT';
    if (domain(s, 'gemini.google.com') || s === 'gemini') return 'Gemini';
    if (domain(s, 'perplexity.ai')) return 'Perplexity';
    if (domain(s, 'claude.ai')) return 'Claude';
    if (domain(s, 'copilot.microsoft.com')) return 'Copilot';
    if (s === '(direct)') return '직접 방문 · 출처 미전달';
    if (missing(s)) return '출처 정보 없음';
    return ({google:'구글 검색',bing:'빙',daum:'다음',threads:'Threads',instagram:'인스타그램'} as Record<string,string>)[s] || source;
}
export const completeAcquisitionReport = (r: ReportResponse) => !r.metadata?.dataLossFromOtherRow && !r.metadata?.subjectToThresholding && !r.metadata?.samplingMetadatas?.length && (r.rowCount ?? 0) <= (r.rows?.length ?? 0);
