const fs = require('fs');
let content = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

const oldCode = `<a href={naverUrl} target="_blank" rel="noopener noreferrer" className={styles.compareLink} title="\u{B124}\u{C774}\u{BC84} \u{D56D}\u{ACF5}\u{AD8C}\u{C5D0}\u{C11C} \u{BE44}\u{AD50}"
                                                                onClick={() => gtag.trackCompareClick('naver', \`\${normalizeCity(flight.departure.city)}-\${normalizeCity(flight.arrival.city)}\`, flight.price)}
                                                            >
                                                                \u{B124}\u{C774}\u{BC84} \u{AC00}\u{ACA9}\u{BE44}\u{AD50} \u{203A}
                                                            </a>`;

const newCode = `<button className={styles.compareLink} title="\u{B124}\u{C774}\u{BC84} \u{D56D}\u{ACF5}\u{AD8C}\u{C5D0}\u{C11C} \u{BE44}\u{AD50}"
                                                                onClick={() => {
                                                                    gtag.trackCompareClick('naver', \`\${normalizeCity(flight.departure.city)}-\${normalizeCity(flight.arrival.city)}\`, flight.price);
                                                                    setNaverDisclaimer({ url: naverUrl, route: \`\${normalizeCity(flight.departure.city)} \u{2192} \${normalizeCity(flight.arrival.city)}\` });
                                                                }}
                                                            >
                                                                \u{B124}\u{C774}\u{BC84} \u{AC00}\u{ACA9}\u{BE44}\u{AD50} \u{203A}
                                                            </button>`;

if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    fs.writeFileSync('src/components/Dashboard.tsx', content);
    console.log('SUCCESS: Replaced naver <a> with <button>');
} else {
    // Try without \r
    const oldNorm = oldCode.replace(/\r/g, '');
    const contentNorm = content.replace(/\r\n/g, '\n');
    if (contentNorm.includes(oldNorm)) {
        content = content.replace(new RegExp(oldCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\r?\n/g, '\\r?\\n')), newCode);
        fs.writeFileSync('src/components/Dashboard.tsx', content);
        console.log('SUCCESS: Replaced (normalized line endings)');
    } else {
        console.log('FAILED: Could not find target string');
        // Debug: show surrounding
        const idx = content.indexOf('네이버 가격비교');
        if (idx > -1) {
            console.log('Found "네이버 가격비교" at index', idx);
            console.log('Context:', JSON.stringify(content.substring(idx - 200, idx + 100)));
        }
    }
}
