import { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// AI 답변엔진(ChatGPT·Claude·Perplexity·Google AI 등)의 크롤러.
// 와일드카드 규칙만으로도 허용되지만, 명시해 두면 차단 의도가 없음이 분명해지고
// 훗날 개별 봇 정책을 바꿀 때 이 목록만 수정하면 된다. (AEO/GEO 0단계, 2026-08)
const AI_CRAWLERS = [
    'GPTBot',            // OpenAI 모델 학습(검색 노출과는 별도)
    'OAI-SearchBot',     // ChatGPT 검색 색인
    'ChatGPT-User',      // ChatGPT 실시간 브라우징
    'ClaudeBot',         // Anthropic 크롤러
    'Claude-User',       // Claude 실시간 조회
    'PerplexityBot',     // Perplexity 색인
    'Perplexity-User',   // Perplexity 실시간 조회
    'Google-Extended',   // Google Gemini 학습
    'CCBot',             // Common Crawl (다수 모델의 학습 원천)
];

export default function robots(): MetadataRoute.Robots {
    const disallow = ['/api/', '/admin/', '/preview/'];
    return {
        rules: [
            ...AI_CRAWLERS.map(userAgent => ({ userAgent, allow: '/', disallow })),
            {
                userAgent: '*',
                allow: '/',
                disallow,
            },
        ],
        sitemap: `${SITE_URL}/sitemap.xml`,
    };
}
