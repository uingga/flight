
import fs from 'fs';
import path from 'path';
import { getRegionByCity } from '../src/lib/utils/region-mapper';

const dataDir = path.resolve(process.cwd(), 'data');

async function migrate() {
    console.log('항공권 지역 정보 업데이트 시작...');

    const files = fs.readdirSync(dataDir).filter(file => file.endsWith('.json'));

    for (const file of files) {
        const filePath = path.join(dataDir, file);
        console.log(`파일 처리 중: ${file}`);

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);

            if (data.flights && Array.isArray(data.flights)) {
                let updatedCount = 0;

                data.flights = data.flights.map((flight: any) => {
                    const region = getRegionByCity(flight.arrival.city);
                    if (region && region !== '기타') updatedCount++;
                    return {
                        ...flight,
                        region: region
                    };
                });

                fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                console.log(`  -> ${updatedCount}개 항목에 지역 정보 추가됨`);
            } else if (Array.isArray(data)) {
                // 배열인 경우 (혹시 모를 구조)
                const updated = data.map((flight: any) => ({
                    ...flight,
                    region: getRegionByCity(flight.arrival?.city || '')
                }));
                fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
                console.log(`  -> ${updated.length}개 항목 처리됨`);
            }

        } catch (error) {
            console.error(`  -> 실패: ${file}`, error);
        }
    }

    console.log('모두 완료되었습니다!');
}

migrate();
