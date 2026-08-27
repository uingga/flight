type FlightOgCardProps = {
    dep: string;
    arr: string;
    priceText: string;
    dateText?: string;
};

export function FlightOgCard({ dep, arr, priceText, dateText = '' }: FlightOgCardProps) {
    const routeLength = dep.length + arr.length;
    const routeFontSize = routeLength >= 13 ? 68 : routeLength >= 9 ? 78 : 90;
    const priceAmount = priceText.replace(/원$/, '');
    const priceUnit = priceText.endsWith('원') ? '원' : '';
    const priceFontSize = priceAmount.length >= 10 ? 72 : priceAmount.length >= 8 ? 80 : 88;
    const priceAffixFontSize = Math.round(priceFontSize * 0.89);

    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                background: '#f3f3f3',
                color: '#222222',
                fontFamily: 'Pretendard',
            }}
        >
            <div
                style={{
                    position: 'relative',
                    width: '1120px',
                    height: '550px',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'visible',
                    borderRadius: '30px',
                    background: '#ffffff',
                }}
            >
                <div
                    style={{
                        position: 'relative',
                        width: '100%',
                        height: '350px',
                        display: 'flex',
                        flexShrink: 0,
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxSizing: 'border-box',
                        padding: '70px 56px 0',
                    }}
                >
                    <div
                        style={{
                            position: 'absolute',
                            top: '38px',
                            right: '48px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        <svg
                            width="36"
                            height="36"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            aria-hidden="true"
                            style={{ flexShrink: 0, marginTop: '-2px' }}
                        >
                            <path
                                d="M3.8 11.1 L20.2 2.9 Q22 2 21.2 3.8 L13.8 20.2 Q13 22 12.0 20.3 L9.5 15.7 Q8.5 14 6.6 13.4 L3.9 12.6 Q2 12 3.8 11.1Z"
                                fill="url(#og-logo-gradient)"
                                transform="rotate(8 12 12)"
                            />
                            <defs>
                                <linearGradient id="og-logo-gradient" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                                    <stop stopColor="#ff385c" />
                                    <stop offset="1" stopColor="#e00b41" />
                                </linearGradient>
                            </defs>
                        </svg>
                        <span
                            style={{
                                color: '#111827',
                                fontFamily: 'YeogiOttaeJalnan',
                                fontSize: '42px',
                                fontWeight: 400,
                                lineHeight: 1,
                                letterSpacing: '0.02em',
                            }}
                        >
                            티키티킷
                        </span>
                    </div>
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: `${routeFontSize}px`, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.055em' }}>
                                {dep}
                            </span>
                            <span
                                style={{
                                    margin: '0 22px',
                                    color: '#ff385c',
                                    fontSize: '60px',
                                    lineHeight: 1,
                                    fontWeight: 700,
                                }}
                            >
                                →
                            </span>
                            <span style={{ fontSize: `${routeFontSize}px`, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.055em' }}>
                                {arr}
                            </span>
                        </div>
                        {dateText && (
                            <span
                                style={{
                                    marginTop: '22px',
                                    color: '#4b4b4b',
                                    fontSize: '64px',
                                    lineHeight: 1,
                                    fontWeight: 600,
                                    letterSpacing: '-0.03em',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {dateText}
                            </span>
                        )}
                    </div>
                </div>

                <div
                    style={{
                        position: 'relative',
                        width: '100%',
                        height: '3px',
                        display: 'flex',
                        flexShrink: 0,
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0 60px',
                    }}
                >
                    {Array.from({ length: 29 }).map((_, index) => (
                        <div
                            key={index}
                            style={{
                                width: '18px',
                                height: '3px',
                                display: 'flex',
                                borderRadius: '999px',
                                background: '#d2d2d2',
                            }}
                        />
                    ))}
                </div>

                <div
                    style={{
                        width: '100%',
                        height: '197px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 54px 2px',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', whiteSpace: 'nowrap' }}>
                        <span
                            style={{
                                marginRight: '20px',
                                fontSize: `${priceAffixFontSize}px`,
                                lineHeight: 1,
                                fontWeight: 700,
                                letterSpacing: '-0.055em',
                            }}
                        >
                            왕복
                        </span>
                        <span
                            style={{
                                color: '#ff385c',
                                fontSize: `${priceFontSize}px`,
                                lineHeight: 1,
                                fontWeight: 700,
                                letterSpacing: '-0.055em',
                            }}
                        >
                            {priceAmount || '가격 확인'}
                        </span>
                        {priceUnit && (
                            <span
                                style={{
                                    marginLeft: '9px',
                                    fontSize: `${priceAffixFontSize}px`,
                                    lineHeight: 1,
                                    fontWeight: 700,
                                    letterSpacing: '-0.055em',
                                }}
                            >
                                {priceUnit}
                            </span>
                        )}
                    </div>
                </div>

                <div
                    style={{
                        position: 'absolute',
                        top: '318px',
                        left: '0',
                        width: '34px',
                        height: '66px',
                        display: 'flex',
                        boxSizing: 'border-box',
                        borderRadius: '0 999px 999px 0',
                        background: '#f3f3f3',
                    }}
                />
                <div
                    style={{
                        position: 'absolute',
                        top: '318px',
                        right: '0',
                        width: '34px',
                        height: '66px',
                        display: 'flex',
                        boxSizing: 'border-box',
                        borderRadius: '999px 0 0 999px',
                        background: '#f3f3f3',
                    }}
                />
            </div>
        </div>
    );
}
