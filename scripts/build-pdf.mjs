#!/usr/bin/env node
// Builds site/technology-radar.pdf from site/report.html using headless Chrome.
// No dependencies: a tiny static file server, Chrome's DevTools protocol over Node's built-in WebSocket (Node 22+).
//
//   node scripts/build-pdf.mjs              (CHROME_PATH overrides the browser to use)

import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(SITE, 'technology-radar.pdf');
const TIMEOUT_MS = 120000;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
};

// ---------- static server for site/ ----------
function serve() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(SITE, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath);
      if (!file.startsWith(SITE)) throw new Error('outside site');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------- Chrome ----------
function launchChrome(userDataDir) {
  const bin = process.env.CHROME_PATH || 'google-chrome';
  const chrome = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = new Promise((resolve, reject) => {
    let buf = '';
    chrome.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    chrome.on('error', reject);
    chrome.on('exit', (code) => reject(new Error(`Chrome exited early (code ${code}). ${buf.slice(-500)}`)));
  });
  return { chrome, wsUrl };
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve({ send, close: () => ws.close() }));
    ws.addEventListener('error', () => reject(new Error('Could not connect to Chrome')));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- main ----------
async function main() {
  const server = await serve();
  const pageUrl = `http://127.0.0.1:${server.address().port}/report.html`;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'radar-chrome-'));
  const { chrome, wsUrl } = launchChrome(userDataDir);
  try {
    const cdp = await connect(await wsUrl);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m, p) => cdp.send(m, p, sessionId);

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: pageUrl });

    const started = Date.now();
    for (;;) {
      const { result } = await send('Runtime.evaluate', {
        expression: 'JSON.stringify({ ready: !!window.__reportReady, error: window.__reportError || null, pages: document.querySelectorAll(".pagedjs_page").length })',
        returnByValue: true,
      });
      const state = JSON.parse(result.value || '{}');
      if (state.error) throw new Error('The report page failed: ' + state.error);
      if (state.ready) { console.log(`Report laid out: ${state.pages} pages`); break; }
      if (Date.now() - started > TIMEOUT_MS) throw new Error('Timed out waiting for the report to lay out');
      await sleep(500);
    }

    const { data } = await send('Page.printToPDF', {
      printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    });
    await writeFile(OUT, Buffer.from(data, 'base64'));
    console.log('Wrote ' + path.relative(ROOT, OUT));
    cdp.close();
  } finally {
    chrome.kill();
    server.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
