import path from 'node:path';

/** 운영은 data/, 격리 시험은 TIKITIKIT_DATA_DIR 아래의 복사본을 사용한다. */
export function getCrawlDataDir(): string {
    const configured = process.env.TIKITIKIT_DATA_DIR?.trim();
    return configured ? path.resolve(configured) : path.join(process.cwd(), 'data');
}
