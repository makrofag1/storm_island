// Zero-dependency static file server (alternative to `npx serve` / `python -m http.server`).
// Usage: node server.mjs [port] [--https]
// Dev extras: logs requests from other devices (e.g. a phone on the LAN) and relays their browser
// errors / console output to this terminal via POST /__log, so mobile problems can be diagnosed.
// --https: serves over TLS with a self-signed certificate (created with openssl on first start) —
// WebXR (VR on a Meta Quest) only works on secure pages, and a LAN http:// address is not one.
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { networkInterfaces, tmpdir } from 'node:os';

const root = resolve('.');
const args = process.argv.slice(2);
const https = args.includes('--https');
const port = Number(args.find((a) => /^\d+$/.test(a))) || (https ? 5174 : 5173);
const lanIPs = () => Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')).map((a) => a.address);

/** Self-signed certificate for localhost + this PC's LAN addresses (re-created when they change). */
function certificate() {
  const dir = join(root, '.cert');
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...lanIPs().map((ip) => 'IP:' + ip)].join(',');
  const keyF = join(dir, 'key.pem'), certF = join(dir, 'cert.pem'), sanF = join(dir, 'san.txt');
  if (!existsSync(certF) || !existsSync(keyF) || !existsSync(sanF) || readFileSync(sanF, 'utf8') !== san) {
    mkdirSync(dir, { recursive: true });
    // openssl from PATH, $OPENSSL, or the copy bundled with Git for Windows (wherever Git is installed)
    const candidates = [process.env.OPENSSL, 'openssl'].filter(Boolean);
    try {
      const git = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
      const gitRoot = resolve(git, '..', '..');
      candidates.push(join(gitRoot, 'mingw64', 'bin', 'openssl.exe'), join(gitRoot, 'usr', 'bin', 'openssl.exe'));
    } catch { /* no git */ }
    candidates.push('C:/Program Files/Git/mingw64/bin/openssl.exe', 'C:/Program Files/Git/usr/bin/openssl.exe');
    let ok = false;
    for (const bin of candidates) {
      try {
        execFileSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyF, '-out', certF, '-days', '825',
          '-subj', '/CN=Storm Island dev server', '-addext', 'subjectAltName=' + san], { stdio: 'ignore' });
        ok = true; break;
      } catch { /* try the next location */ }
    }
    if (!ok) { console.error('Could not create a certificate: openssl not found (install Git for Windows, or put openssl on PATH).'); process.exit(1); }
    writeFileSync(sanF, san);
    console.log('Created a self-signed certificate in .cert/ for ' + san.replace(/DNS:|IP:/g, ''));
  }
  return { key: readFileSync(keyF), cert: readFileSync(certF) };
}
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// Injected into index.html only by this dev server (never part of the builds).
const DEV_LOG = `<script>(function(){
function send(t){try{var x=new XMLHttpRequest();x.open('POST','/__log');x.send(String(t).slice(0,4000))}catch(e){}}
function show(m){try{var d=document.getElementById('devlog');if(!d){d=document.createElement('div');d.id='devlog';d.style.cssText='position:fixed;left:0;right:0;top:0;z-index:99999;max-height:40vh;overflow:auto;background:rgba(150,0,0,.92);color:#fff;font:12px/1.35 monospace;padding:6px 8px;white-space:pre-wrap';d.onclick=function(){d.remove()};(document.body||document.documentElement).appendChild(d)}d.textContent+=m+'\\n'}catch(e){}}
send('boot '+navigator.userAgent+' '+innerWidth+'x'+innerHeight+' dpr='+devicePixelRatio);
addEventListener('error',function(e){var t=e.target;if(t&&t!==window&&/^data:/.test(t.src||t.href||''))return;var m=t&&t!==window&&(t.src||t.href)?'load failed: '+(t.src||t.href):'error: '+e.message+' @'+(e.filename||'')+':'+(e.lineno||'')+':'+(e.colno||'')+(e.error&&e.error.stack?'\\n'+e.error.stack:'');send(m);show(m)},true);
addEventListener('unhandledrejection',function(e){var r=e.reason,m='rejection: '+(r&&(r.stack||r.message)||r);send(m);show(m)});
['error','warn','info'].forEach(function(k){var o=console[k];console[k]=function(){var s=[].map.call(arguments,function(a){return a&&a.stack?a.stack:typeof a==='object'?(function(){try{return JSON.stringify(a)}catch(_){return String(a)}})():String(a)}).join(' ');send(k+': '+s);if(k==='error')show(s);return o.apply(console,arguments)}});
addEventListener('pagehide',function(){send('pagehide')});
})();</script>`;

const isLocal = (a) => /^(::1|127\.|::ffff:127\.)/.test(a || '');

const handler = async (req, res) => {
  const remote = req.socket.remoteAddress;
  if (req.method === 'POST' && req.url === '/__shot' && isLocal(remote)) {
    // dev only: save a canvas screenshot (data URL) sent by the page, for debugging hidden windows
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const m = /^data:image\/(png|jpeg);base64,(.*)$/s.exec(Buffer.concat(chunks).toString('utf8'));
      if (!m) { res.writeHead(400); res.end(); return; }
      const dir = join(tmpdir(), 'storm-island-shots');
      await mkdir(dir, { recursive: true });
      const f = join(dir, `shot-${Date.now()}.${m[1] === 'png' ? 'png' : 'jpg'}`);
      await writeFile(f, Buffer.from(m[2], 'base64'));
      res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(f);
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/__log') {
    let body = '';
    req.on('data', (c) => { if (body.length < 8000) body += c; });
    req.on('end', () => { console.log(`[client ${remote}] ${body}`); res.writeHead(204); res.end(); });
    return;
  }
  let status = 200;
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { status = 403; res.writeHead(403); res.end(); return; }
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    let data = await readFile(file);
    if (file === join(root, 'index.html')) data = data.toString('utf8').replace('<script type="importmap">', DEV_LOG + '\n  <script type="importmap">');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    status = 404;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } finally {
    if (!isLocal(remote)) console.log(`[${remote}] ${req.method} ${req.url} -> ${status}`);
  }
};

(https ? createHttpsServer(certificate(), handler) : createServer(handler))
  .on('connection', (sock) => { if (!isLocal(sock.remoteAddress)) console.log(`[${sock.remoteAddress}] TCP connection opened`); })
  .on('clientError', (err, sock) => {
    if (err.code === 'ECONNRESET') return;
    if (https) { if (!/ssl|tls|certificate/i.test(err.message || '')) console.log(`[${sock.remoteAddress}] bad request (${err.code || err.message})`); }
    else console.log(`[${sock.remoteAddress}] bad request (${err.code || err.message}) — e.g. the browser tried https:// on this http-only port`);
    if (sock.writable) sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  })
  .listen(port, () => {
  const proto = https ? 'https' : 'http';
  console.log(`Storm Island running at ${proto}://localhost:${port}`);
  for (const ip of lanIPs()) console.log(`  on your network: ${proto}://${ip}:${port}`);
  if (https) console.log('  Self-signed certificate: the browser (e.g. Meta Quest Browser) warns once — choose Advanced -> Proceed. VR (WebXR) works on these https:// addresses.');
});
