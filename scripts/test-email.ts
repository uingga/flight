import { sendTestEmail } from '../src/lib/utils/email-alert';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('📧 이메일 테스트 발송 중...');
    console.log(`발신: ${process.env.EMAIL_USER}`);
    console.log(`수신: ${process.env.EMAIL_TO}`);

    const success = await sendTestEmail();

    if (success) {
        console.log('✅ 테스트 이메일 발송 성공! 받은편지함을 확인하세요.');
    } else {
        console.log('❌ 테스트 이메일 발송 실패. .env 설정을 확인하세요.');
    }
}

main();
