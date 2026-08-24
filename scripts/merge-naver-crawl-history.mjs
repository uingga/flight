import fs from 'node:fs';

const [, , targetPath, incomingPath] = process.argv;
if (!targetPath || !incomingPath) {
    console.error('Usage: node scripts/merge-naver-crawl-history.mjs <target> <incoming>');
    process.exit(1);
}

const readEntries = filePath => {
    if (!fs.existsSync(filePath)) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed?.entries) ? parsed.entries : [];
    } catch {
        return [];
    }
};

const cutoff = Date.now() - 60 * 86_400_000;
const byId = new Map();
for (const entry of [...readEntries(targetPath), ...readEntries(incomingPath)]) {
    if (!entry?.id || new Date(entry.timestamp).getTime() < cutoff) continue;
    byId.set(entry.id, entry);
}

const entries = [...byId.values()]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
fs.writeFileSync(targetPath, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
console.log(`네이버 크롤 기록 병합: ${entries.length}회`);
