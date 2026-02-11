import React from 'react';

export default function Logo({ className = '', size = 1.0 }: { className?: string, size?: number }) {
    const scale = size;

    return (
        <span className={`logo-container ${className}`} style={{ display: 'inline-flex', alignItems: 'center', gap: `${4 * scale}px` }}>
            <svg
                width={32 * scale}
                height={32 * scale}
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ flexShrink: 0, marginTop: `${-4 * scale}px` }}
            >
                <path
                    d="M3.8 11.1 L20.2 2.9 Q22 2 21.2 3.8 L13.8 20.2 Q13 22 12.0 20.3 L9.5 15.7 Q8.5 14 6.6 13.4 L3.9 12.6 Q2 12 3.8 11.1Z"
                    fill="url(#logo_gradient)"
                    transform="rotate(8 12 12)"
                />
                <defs>
                    <linearGradient id="logo_gradient" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#22d3ee" />
                        <stop offset="1" stopColor="#0891b2" />
                    </linearGradient>
                </defs>
            </svg>
            <span style={{
                fontFamily: "'Balsamiq Sans', sans-serif",
                fontWeight: 700,
                fontStyle: 'italic' as const,
                fontSize: `${2.4 * scale}rem`,
                color: '#111827',
                lineHeight: 1,
                letterSpacing: '0.03em'
            }}>
                <span style={{ marginRight: '0.4px' }}>T</span>ikit
            </span>
        </span>
    );
}
