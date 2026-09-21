"""Loopback-only transport, intended behind an authenticated SSH tunnel.

No listening on LAN/public interfaces, automatic tunnel creation, credential
provisioning, browser launch, or retry of uncertain state-changing requests.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('coordinator_redirect_refused')


class Client:
    def __init__(self, url, token):
        parsed = urlsplit(url)
        if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.path != '/tripcom' or parsed.query or parsed.fragment or parsed.username:
            raise ValueError('loopback_ssh_endpoint_required')
        if not isinstance(token, str) or len(token) < 32:
            raise ValueError('invalid_worker_credential')
        self.url, self.token = url, token
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def __call__(self, action, **body):
        raw = json.dumps({'action': action, **body}, ensure_ascii=False).encode()
        request = Request(self.url, data=raw, headers={
            'Authorization':'Bearer ' + self.token, 'Content-Type':'application/json'}, method='POST')
        with self.opener.open(request, timeout=15) as response:
            data = response.read(2_000_001)
            if len(data) > 2_000_000:
                raise RuntimeError('response_too_large')
            return json.loads(data)


def create_server(protocol, port=0):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Never log authorization, tickets, or request payloads.

        def do_POST(self):
            self.connection.settimeout(15)
            if self.path != '/tripcom':
                self.send_error(404)
                return
            length = self.headers.get('Content-Length','')
            if not length.isdigit() or int(length) > 2_000_000 or self.headers.get('Transfer-Encoding'):
                self.send_error(413)
                return
            raw = self.rfile.read(int(length))
            if len(raw) != int(length):
                self.send_error(400)
                return
            status, result = protocol.handle(self.headers.get('Authorization'), raw)
            encoded = json.dumps(result).encode()
            self.send_response(status)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
    return ThreadingHTTPServer(('127.0.0.1', port), Handler)
