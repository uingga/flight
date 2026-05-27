import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * 크롤링 경고 이메일 알림 시스템
 */

interface CrawlAlert {
    source: string;        // 스크래퍼 이름 (ybtour, ttang, etc.)
    type: 'error' | 'warning' | 'info';
    message: string;
    details?: string;
    timestamp: Date;
}

interface CrawlReport {
    success: boolean;
    totalFlights: number;
    sources: { [key: string]: number };
    alerts: CrawlAlert[];
    timestamp: Date;
}

// Gmail SMTP 설정
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

/**
 * 경고 이메일 발송
 */
export async function sendAlertEmail(report: CrawlReport): Promise<boolean> {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !process.env.EMAIL_TO) {
        console.log('⚠️ 이메일 설정이 없어 알림을 건너뜁니다.');
        return false;
    }

    // 경고가 없고 성공이면 이메일 안 보냄
    if (report.success && report.alerts.length === 0) {
        console.log('✅ 문제 없음 - 이메일 알림 건너뜀');
        return true;
    }

    const errorAlerts = report.alerts.filter(a => a.type === 'error');
    const warningAlerts = report.alerts.filter(a => a.type === 'warning');

    const subject = errorAlerts.length > 0
        ? `🚨 [땡처리 대시보드] 크롤링 오류 발생`
        : `⚠️ [땡처리 대시보드] 크롤링 경고`;

    const html = `
        <h2>땡처리 항공권 크롤링 리포트</h2>
        <p><strong>시간:</strong> ${report.timestamp.toLocaleString('ko-KR')}</p>
        <p><strong>총 수집:</strong> ${report.totalFlights}개 항공권</p>
        
        <h3>소스별 수집 현황</h3>
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
            <tr style="background: #f0f0f0;">
                <th>소스</th>
                <th>수집 수</th>
                <th>상태</th>
            </tr>
            ${Object.entries(report.sources).map(([source, count]) => `
                <tr>
                    <td>${getSourceName(source)}</td>
                    <td>${count}개</td>
                    <td>${count === 0 ? '🔴 실패' : count < 10 ? '🟡 경고' : '🟢 정상'}</td>
                </tr>
            `).join('')}
        </table>

        ${report.alerts.length > 0 ? `
            <h3>⚠️ 발생한 경고/오류</h3>
            <ul>
                ${report.alerts.map(alert => `
                    <li>
                        <strong>[${alert.type.toUpperCase()}] ${alert.source}:</strong> ${alert.message}
                        ${alert.details ? `<br><small>${alert.details}</small>` : ''}
                    </li>
                `).join('')}
            </ul>
        ` : ''}

        <hr>
        <p style="color: #666; font-size: 12px;">
            이 메일은 땡처리 항공권 대시보드 크롤링 시스템에서 자동 발송되었습니다.
        </p>
    `;

    try {
        await transporter.sendMail({
            from: `"땡처리 대시보드" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_TO,
            subject: subject,
            html: html,
        });
        console.log('📧 알림 이메일 발송 완료');
        return true;
    } catch (error) {
        console.error('❌ 이메일 발송 실패:', error);
        return false;
    }
}

/**
 * 크롤링 결과 검증 및 경고 생성
 */
export function validateCrawlResult(
    sources: { [key: string]: number },
    previousSources?: { [key: string]: number }
): CrawlAlert[] {
    const alerts: CrawlAlert[] = [];
    const timestamp = new Date();

    // 예상 최소 수집량 (지역별)
    const expectedMinimums: { [key: string]: { total: number; regions?: string[] } } = {
        ybtour: { total: 100, regions: ['일본', '아시아', '괌/사이판', '남태평양'] },
        ttang: { total: 100 },
        hanatour: { total: 30 },
        modetour: { total: 200 },
        onlinetour: { total: 50 },
    };

    for (const [source, count] of Object.entries(sources)) {
        const expected = expectedMinimums[source];

        // 0개 수집 = 오류
        if (count === 0) {
            alerts.push({
                source,
                type: 'error',
                message: `${getSourceName(source)} 데이터 수집 실패 (0개)`,
                details: 'DOM 구조 변경 또는 네트워크 오류 의심',
                timestamp,
            });
        }
        // 예상보다 현저히 낮음 = 경고
        else if (expected && count < expected.total * 0.3) {
            alerts.push({
                source,
                type: 'warning',
                message: `${getSourceName(source)} 수집량 이상 (${count}개, 예상 최소 ${expected.total}개)`,
                details: '일부 지역 또는 도시 누락 가능성',
                timestamp,
            });
        }

        // 이전 대비 50% 이상 감소 = 경고
        if (previousSources && previousSources[source]) {
            const prevCount = previousSources[source];
            if (count < prevCount * 0.5) {
                alerts.push({
                    source,
                    type: 'warning',
                    message: `${getSourceName(source)} 급격한 감소 (${prevCount} → ${count}개, -${Math.round((1 - count / prevCount) * 100)}%)`,
                    timestamp,
                });
            }
        }
    }

    return alerts;
}

/**
 * 소스 코드를 한글 이름으로 변환
 */
function getSourceName(source: string): string {
    const names: { [key: string]: string } = {
        ybtour: '노랑풍선',
        ttang: '땡처리닷컴',
        hanatour: '하나투어',
        modetour: '모두투어',
        onlinetour: '온라인투어',
    };
    return names[source] || source;
}

/**
 * 테스트용 이메일 발송
 */
export async function sendTestEmail(): Promise<boolean> {
    const testReport: CrawlReport = {
        success: true,
        totalFlights: 100,
        sources: { ybtour: 50, ttang: 50 },
        alerts: [{
            source: 'system',
            type: 'info',
            message: '테스트 이메일입니다.',
            timestamp: new Date(),
        }],
        timestamp: new Date(),
    };
    return sendAlertEmail(testReport);
}

export type { CrawlAlert, CrawlReport };
