// NIGHTHAUL — a tiny static server for playing the game locally.
// Development only; the entry itself is just the files under game/.
//
//   node serve.ts [port]     then open http://localhost:8080

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const gameDir = join(fileURLToPath(new URL('.', import.meta.url)), 'game');
const port = Number(process.argv[2] ?? 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

// Map a request path to a file inside game/, refusing anything that
// climbs out of the tree.
function resolveFile(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  const rel = clean === '' || clean === '.' ? 'index.html' : clean;
  const file = join(gameDir, rel);
  return file === gameDir || file.startsWith(gameDir + sep) ? file : null;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const file = resolveFile(url.pathname);
  if (file === null) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, () => {
  console.log(`serving game/ at http://localhost:${port}`);
});
