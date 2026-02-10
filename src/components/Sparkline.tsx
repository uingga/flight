'use client';

interface SparklineProps {
    data: number[];
    width?: number;
    height?: number;
    color?: string;
}

export default function Sparkline({ data, width = 80, height = 24, color }: SparklineProps) {
    if (!data || data.length < 2) return null;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    // 가격이 내려가고 있으면 초록, 올라가면 빨강
    const trend = data[data.length - 1] - data[0];
    const lineColor = color || (trend <= 0 ? 'hsl(142, 70%, 50%)' : 'hsl(0, 70%, 60%)');
    const gradientId = `sparkGrad${data.join('')}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);

    const padding = 2;
    const innerW = width - padding * 2;
    const innerH = height - padding * 2;

    const points = data.map((v, i) => {
        const x = padding + (i / (data.length - 1)) * innerW;
        const y = padding + innerH - ((v - min) / range) * innerH;
        return `${x},${y}`;
    });

    const pathD = points.map((p, i) => (i === 0 ? `M${p}` : `L${p}`)).join(' ');

    // Area fill path
    const firstX = padding;
    const lastX = padding + innerW;
    const areaD = `${pathD} L${lastX},${height} L${firstX},${height} Z`;

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            style={{ display: 'block' }}
        >
            <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
                </linearGradient>
            </defs>
            <path d={areaD} fill={`url(#${gradientId})`} />
            <path d={pathD} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            {/* 마지막 포인트 dot */}
            <circle
                cx={parseFloat(points[points.length - 1].split(',')[0])}
                cy={parseFloat(points[points.length - 1].split(',')[1])}
                r="2"
                fill={lineColor}
            />
        </svg>
    );
}
