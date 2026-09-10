import type { Metadata } from 'next';
import { SITE_URL } from './site';

export const HOME_SHARE_IMAGE = '/images/og/homepage-20260910.png';
export const HOME_SHARE_TITLE = '티키티킷';
export const HOME_SHARE_DESCRIPTION = '전국 여행사의 땡처리 항공권을 한눈에! 🚀';

// Homepage filters do not select an individual flight for the share preview.
// Dedicated /share/[id] pages retain their own flight-specific metadata.
export const homeShareMetadata: Pick<Metadata, 'openGraph' | 'twitter'> = {
    openGraph: {
        title: HOME_SHARE_TITLE,
        description: HOME_SHARE_DESCRIPTION,
        url: SITE_URL,
        siteName: HOME_SHARE_TITLE,
        images: [{
            url: HOME_SHARE_IMAGE,
            width: 1730,
            height: 909,
            alt: `${HOME_SHARE_TITLE} — ${HOME_SHARE_DESCRIPTION}`,
        }],
        locale: 'ko_KR',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: HOME_SHARE_TITLE,
        description: HOME_SHARE_DESCRIPTION,
        images: [HOME_SHARE_IMAGE],
    },
};
