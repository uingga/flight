// Read-only transport diagnostic. Does not attach, navigate or read page/account content.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const file = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'DevToolsActivePort');
let socket;
const startedAt = Date.now();
let httpStatus = null;
let transportCode = null;
try {
    const [port, route] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    if (!/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535
        || !/^\/devtools\/browser\/[0-9a-f-]{36}$/i.test(route)) throw new Error('invalid_discovery_file');
    await new Promise((resolve, reject) => {
        socket = new WebSocket(`ws://127.0.0.1:${port}${route}`, { handshakeTimeout: 15000, perMessageDeflate: false });
        const timer = setTimeout(() => reject(new Error('connection_permission_or_transport_timeout')), 16000);
        socket.once('open', () => { clearTimeout(timer); resolve(); });
        socket.once('unexpected-response', (request, response) => {
            clearTimeout(timer);
            httpStatus = response.statusCode;
            response.destroy(); request.destroy();
            reject(new Error('browser_handshake_http_rejected'));
        });
        socket.once('error', error => {
            clearTimeout(timer);
            transportCode = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EACCES', 'EPERM'].includes(error.code) ? error.code : null;
            const reason = error.code === 'ECONNREFUSED' ? 'browser_endpoint_not_listening'
                : error.message === 'Opening handshake has timed out' ? 'connection_permission_or_transport_timeout'
                : 'connection_not_accepted';
            reject(new Error(reason));
        });
    });
    console.log(JSON.stringify({ status: 'transport_connected', siteRequests: 0, pageActions: 0, attached: false }));
} catch (error) {
    const reason = ['invalid_discovery_file','connection_permission_or_transport_timeout','browser_endpoint_not_listening','connection_not_accepted','browser_handshake_http_rejected'].includes(error.message)
        ? error.message : 'discovery_file_unavailable';
    console.log(JSON.stringify({ status: 'not_connected', reason, httpStatus, transportCode, elapsedMs: Date.now() - startedAt, siteRequests: 0, pageActions: 0, attached: false }));
    process.exitCode = 1;
} finally { socket?.terminate(); }
