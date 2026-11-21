// A small static file server for trying a page locally (`narrate serve`). Not for production.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

/** The file a request path points at inside `root`, or null when it is outside it or does not exist. */
export function resolveRequest(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const base = resolve(root);
  const file = resolve(join(base, normalize(decoded)));
  if (file !== base && !file.startsWith(base + sep)) return null;
  if (!existsSync(file)) return null;
  const target = statSync(file).isDirectory() ? join(file, 'index.html') : file;
  return existsSync(target) && statSync(target).isFile() ? target : null;
}

function sendFile(request, response, file) {
  const size = statSync(file).size;
  const headers = { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (!range || (!range[1] && !range[2])) {
    response.writeHead(200, { ...headers, 'Content-Length': size });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
    return;
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    return;
  }
  response.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file, { start, end }).pipe(response);
}

/** Serves `root` on localhost. Resolves with the server once it is listening. */
export function serve(root, port = 4173) {
  const server = createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    const file = resolveRequest(root, request.url ?? '/');
    if (!file) response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    else sendFile(request, response, file);
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => done(server));
  });
}
