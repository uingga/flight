import React from 'react';

export default function Logo({ className = '', size = 1.0 }: { className?: string, size?: number }) {
    const scale = size;
    const gradientId = `logo-gradient-${React.useId().replace(/:/g, '')}`;

    return (
        <span
            className={`logo-container ${className}`}
            style={{ display: 'inline-flex', flexShrink: 0, alignItems: 'center', gap: `${3 * scale}px`, whiteSpace: 'nowrap' }}
        >
            <svg
                width={22 * scale}
                height={22 * scale}
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                style={{ flexShrink: 0, marginTop: `${-1 * scale}px` }}
            >
                <path
                    d="M3.8 11.1 L20.2 2.9 Q22 2 21.2 3.8 L13.8 20.2 Q13 22 12.0 20.3 L9.5 15.7 Q8.5 14 6.6 13.4 L3.9 12.6 Q2 12 3.8 11.1Z"
                    fill={`url(#${gradientId})`}
                    transform="rotate(8 12 12)"
                />
                <defs>
                    <linearGradient id={gradientId} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#4F46E5" />
                        <stop offset="1" stopColor="#3730A3" />
                    </linearGradient>
                </defs>
            </svg>
            <span style={{
                fontFamily: "'YeogiOttaeJalnan', sans-serif",
                fontWeight: 'normal',
                fontSize: `${1.6 * scale}rem`,
                color: '#111827',
                lineHeight: 1,
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap'
            }}>
                티키티킷
            </span>
        </span>
    );
}
