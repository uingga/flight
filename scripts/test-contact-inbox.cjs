const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { NextRequest } = require('next/server');
const calls = [];
function load(file) {
    const filename = path.resolve(file);
    const mod = new Module(filename, module);
    mod.paths = module.paths;
    mod.require = name => {
        if (name === '@/lib/contact') return load('src/lib/contact.ts');
        if (name === '@/lib/server/supabase-rest') return { supabaseRest: async (resource, init = {}) => {
            calls.push({ resource, ...init });
            return resource.startsWith('rpc/') ? true : init.method === 'PATCH' ? [{}] : [];
        }};
        if (name === '@/lib/server/account-auth') return {
            isSameOriginRequest: req => req.headers.get('origin') === 'http://localhost',
            getRequestFingerprint: () => 'test', hashAuthValue: () => 'test',
            normalizeEmail: value => value.includes('@') ? value : null,
        };
        if (name === 'nodemailer') return { createTransport: () => ({ sendMail: async () => { throw Error('test notification failure'); } }) };
        return require(name);
    };
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
    return mod.exports;
}
function req(url, method = 'GET', body, key = 'test-admin', origin = 'http://localhost') {
    return new NextRequest('http://localhost' + url, { method, headers: { 'Content-Type': 'application/json', 'x-admin-key': key, origin }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
(async () => {
    process.env.ADMIN_KEY = 'test-admin';
    process.env.GMAIL_USER = 'test@example.com'; process.env.GMAIL_APP_PASS = 'test-only';
    const admin = load('src/app/api/admin-contacts/route.ts');
    const contact = load('src/app/api/contact/route.ts');
    assert.equal((await admin.GET(req('/api/admin-contacts', 'GET', null, 'wrong'))).status, 401);
    assert.equal(calls.length, 0);
    assert.equal((await admin.GET(req('/api/admin-contacts?id=bad'))).status, 400);
    assert.equal((await admin.GET(req('/api/admin-contacts'))).status, 200);
    assert.ok(!calls.at(-1).resource.includes('attachment'));
    assert.equal((await admin.PATCH(req('/api/admin-contacts', 'PATCH', {}, 'test-admin', 'https://evil.example'))).status, 403);
    const id = '12345678-1234-1234-1234-123456789abc';
    assert.equal((await admin.PATCH(req('/api/admin-contacts', 'PATCH', { id, status: 'resolved' }))).status, 200);
    const cleared = JSON.parse(calls.at(-1).body);
    assert.equal(cleared.email, null); assert.equal(cleared.attachment, null); assert.equal(cleared.message, '');
    assert.equal((await contact.POST(req('/api/contact', 'POST', { message: 'test', category: 'invalid' }))).status, 400);
    assert.equal((await contact.POST(req('/api/contact', 'POST', { message: 'test', attachment: 'data:image/svg+xml;base64,PHN2Zz4=' }))).status, 400);
    assert.equal((await contact.POST(req('/api/contact', 'POST', { message: 'test', attachment: 'data:image/png;base64,ZmFrZQ==' }))).status, 400);
    const result = await contact.POST(req('/api/contact', 'POST', { message: '문의 테스트', category: 'error' }));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).success, true);
    assert.ok(calls.some(call => call.resource === 'contact_inquiries' && call.method === 'POST'));
    console.log('PASS: authorization, origin, image validation, private listing, completion purge, notification failure recovery');
})().catch(error => { console.error(error); process.exit(1); });
