import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accumulateMetadata } from 'next/dist/lib/metadata/resolve-metadata';
import {
    HOME_SHARE_DESCRIPTION,
    HOME_SHARE_IMAGE,
    HOME_SHARE_TITLE,
    homeShareMetadata,
} from '../src/lib/home-share-metadata';
import { SITE_URL } from '../src/lib/site';

async function main() {
    const image = readFileSync(`public${HOME_SHARE_IMAGE}`);
    assert.equal(image.subarray(1, 4).toString(), 'PNG');
    const dimensions = { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
    const ogImage = (homeShareMetadata.openGraph!.images as { width: number; height: number }[])[0];
    assert.equal(ogImage.width, dimensions.width);
    assert.equal(ogImage.height, dimensions.height);

    const source = readFileSync('src/app/page.tsx', 'utf8');
    assert.match(source, /generateMetadata\(\)/);
    assert.match(source, /\.\.\.homeShareMetadata/);
    assert.doesNotMatch(source, /getFeaturedFlight/);

    const paths = ['/', '/?dep=%EC%9D%B8%EC%B2%9C', '/?dep=부산&arr=오사카&date=2026-10-01'];
    for (const pathname of paths) {
        const result = await accumulateMetadata([
            [{ metadataBase: new URL(SITE_URL), openGraph: { images: ['/opengraph-image'] } }, null, null],
            [homeShareMetadata, { openGraph: [{ url: '/opengraph-image', width: 1200, height: 630 }] }, null],
        ], { pathname, trailingSlash: false });
        assert.equal(result.openGraph!.title.absolute, HOME_SHARE_TITLE);
        assert.equal(result.openGraph!.description, HOME_SHARE_DESCRIPTION);
        assert.equal(String((result.openGraph!.images![0] as { url: URL }).url), new URL(HOME_SHARE_IMAGE, SITE_URL).href);
        assert.equal(String((result.twitter!.images![0] as { url: URL }).url), new URL(HOME_SHARE_IMAGE, SITE_URL).href);
    }
    const shareSource = readFileSync('src/app/share/[id]/page.tsx', 'utf8');
    assert.match(shareSource, /\/api\/og/);
    assert.doesNotMatch(shareSource, /homeShareMetadata/);
    console.log('PASS: homepage/filter OG, Twitter, PNG dimensions, file-metadata precedence, separate flight share');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
