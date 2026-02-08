
import fetch from 'node-fetch';

async function checkUrl(url: string, name: string) {
    console.log(`\n--- Checking ${name} ---`);
    console.log(`URL: ${url}`);
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                // 'Referer': 'https://m.modetour.com/flights/discount-flight', // Try enabling/disabling this
            },
            redirect: 'follow'
        });

        console.log(`Status: ${response.status} ${response.statusText}`);
        console.log(`Final URL: ${response.url}`);

        const text = await response.text();
        const titleMatch = text.match(/<title>(.*?)<\/title>/i);
        console.log(`Page Title: ${titleMatch ? titleMatch[1] : 'No title found'}`);

        if (text.includes('비정상적인 접근') || text.includes('잘못된 경로')) {
            console.error('❌ "비정상적인 접근" error detected in content!');
        } else if (text.includes('예약') || text.includes('상세')) {
            console.log('✅ Page seems valid (contains keywords).');
        } else {
            console.log('⚠️ Page content unclear.');
        }

    } catch (error) {
        console.error(`Error fetching ${url}:`, error);
    }
}

async function main() {
    // 1. The link that is failing for the user
    // (Assuming id=19630063, day=5)
    await checkUrl('https://m.modetour.com/flights/discount-flight/flight-details-page?id=19630063&day=5', 'Failing Link (User Reported)');

    // 2. The link Gemini claimed to work
    await checkUrl('https://m.modetour.com/flights/discount-flight/flight-details-page?id=19498464&day=9', 'Gemini "Working" Link');

    // 3. Try PC version of failing link
    await checkUrl('https://www.modetour.com/flights/discount-flight/flight-details-page?id=19630063&day=5', 'PC Link (Failing)');
}

main();
