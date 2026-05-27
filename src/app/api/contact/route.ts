import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
    try {
        const { name, email, message } = await request.json();

        // 입력 검증
        if (!message || message.trim().length === 0) {
            return NextResponse.json({ error: '문의 내용을 입력해주세요.' }, { status: 400 });
        }
        if (message.length > 2000) {
            return NextResponse.json({ error: '문의 내용은 2000자 이내로 작성해주세요.' }, { status: 400 });
        }

        // 이메일 설정 - GMAIL_APP_PASS 우선, EMAIL_PASS 폴백
        const emailUser = process.env.GMAIL_USER || process.env.EMAIL_USER;
        const emailPass = (process.env.GMAIL_APP_PASS || process.env.EMAIL_PASS || '').replace(/\s/g, '');

        if (!emailUser || !emailPass) {
            console.error('이메일 환경변수가 설정되지 않았습니다.');
            return NextResponse.json({ error: '서버 설정 오류입니다.' }, { status: 500 });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: emailUser,
                pass: emailPass,
            },
        });

        const html = `
            <h2>📬 티키티킷 문의</h2>
            <table border="0" cellpadding="8" style="border-collapse: collapse; font-size: 14px;">
                <tr><td><strong>이름:</strong></td><td>${name || '미입력'}</td></tr>
                <tr><td><strong>이메일:</strong></td><td>${email || '미입력'}</td></tr>
                <tr><td><strong>시간:</strong></td><td>${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td></tr>
            </table>
            <hr>
            <h3>문의 내용</h3>
            <p style="white-space: pre-wrap; background: #f9f9f9; padding: 16px; border-radius: 8px;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
            <hr>
            <p style="color: #999; font-size: 12px;">티키티킷 웹사이트에서 발송된 문의입니다.</p>
        `;

        await transporter.sendMail({
            from: `"티키티킷 문의" <${emailUser}>`,
            to: 'uingga@gmail.com',
            replyTo: email || undefined,
            subject: `[티키티킷 문의] ${name || '익명'}: ${message.substring(0, 50)}`,
            html,
        });

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        console.error('문의 이메일 발송 실패:', error);
        return NextResponse.json({ error: '전송에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
    }
}
