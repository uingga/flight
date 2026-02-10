import React from 'react';

export default function Logo({ className = '', size = 1.0 }: { className?: string, size?: number }) {
    const scale = size;

    return (
        <span className={`logo-container ${className}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <svg
                width={40 * scale}
                height={40 * scale}
                viewBox="0 0 40 40"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path
                    d="M36.5 4.5L20.5 14L4.5 9L36.5 4.5Z"
                    fill="url(#logo_gradient)"
                    opacity="0.9"
                />
                <path
                    d="M36.5 4.5L20.5 14L25 35L36.5 4.5Z"
                    fill="url(#logo_gradient_dark)"
                />
                <path
                    d="M20.5 14L18 20L25 35L20.5 14Z"
                    fill="url(#logo_gradient)"
                    opacity="0.8"
                />
                <defs>
                    <linearGradient id="logo_gradient" x1="4.5" y1="9" x2="36.5" y2="35" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#3B82F6" />
                        <stop offset="1" stopColor="#8B5CF6" />
                    </linearGradient>
                    <linearGradient id="logo_gradient_dark" x1="36.5" y1="4.5" x2="25" y2="35" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#2563EB" />
                        <stop offset="1" stopColor="#7C3AED" />
                    </linearGradient>
                </defs>
            </svg>
            <span style={{
                fontFamily: 'var(--font-pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif)',
                fontWeight: 900,
                fontSize: `${2.2 * scale}rem`,
                letterSpacing: '-0.03em',
                color: '#111827',
                lineHeight: 1
            }}>
                플리토
            </span>
        </span>
    );
}
