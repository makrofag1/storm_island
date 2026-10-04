// Zero-dependency static file server (alternative to `npx serve` / `python -m http.server`).
// Usage: node server.mjs [port]
// Dev extras: logs requests from other devices (e.g. a phone on the LAN) and relays their browser
// errors / console output to this terminal via POST /__log, so mobile problems can be diagnosed.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';

const root = resolve('.');
const port = Number(process.argv[2]) || 5173;
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

createServer(async (req, res) => {
  const remote = req.socket.remoteAddress;
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
})
  .on('connection', (sock) => { if (!isLocal(sock.remoteAddress)) console.log(`[${sock.remoteAddress}] TCP connection opened`); })
  .on('clientError', (err, sock) => {
    if (err.code === 'ECONNRESET') return;
    console.log(`[${sock.remoteAddress}] bad request (${err.code || err.message}) — e.g. the browser tried https:// on this http-only port`);
    if (sock.writable) sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  })
  .listen(port, () => {
  console.log(`Storm Island running at http://localhost:${port}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) console.log(`  on your network: http://${a.address}:${port}`);
  }
});
