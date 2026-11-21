// A small static file server for trying a page locally (`narrate serve`). Not for production.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True when the Host header names this machine. Anything else is another site pointing its name here. */
export function isLocalHost(host) {
  if (typeof host !== 'string') return false;
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOCAL_HOSTS.has(name.toLowerCase());
}

/**
 * The file a request path points at inside `root`, or null when it is outside it, does not exist, or
 * lies in a file or folder whose name starts with a dot (.git, .env).
 */
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
  if (relative(base, file).split(sep).some((part) => part.startsWith('.'))) return null;
  if (!existsSync(file)) return null;
  const target = statSync(file).isDirectory() ? join(file, 'index.html') : file;
  return existsSync(target) && statSync(target).isFile() ? target : null;
}

/** Streams a file (or a byte range of it). A read error ends the response instead of stopping the server. */
function pipeFile(response, file, range) {
  createReadStream(file, range)
    .on('error', (error) => {
      process.stderr.write(`narrate serve: ${file}: ${error.message}\n`);
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end();
    })
    .pipe(response);
}

function sendFile(request, response, file) {
  const size = statSync(file).size;
  const headers = { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  const wantsBody = request.method !== 'HEAD';
  if (!range || (!range[1] && !range[2])) {
    response.writeHead(200, { ...headers, 'Content-Length': size });
    if (wantsBody) pipeFile(response, file);
    else response.end();
    return;
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    return;
  }
  response.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
  if (wantsBody) pipeFile(response, file, { start, end });
  else response.end();
}

/** Answers one request. Exported for the tests. */
export function handle(root, request, response) {
  const refuse = (status, text) => response.writeHead(status, { 'Content-Type': 'text/plain' }).end(text);
  if (!isLocalHost(request.headers.host)) return refuse(403, 'this server only answers to localhost');
  if (!['GET', 'HEAD'].includes(request.method)) return refuse(405, 'GET and HEAD only');
  try {
    const file = resolveRequest(root, request.url ?? '/');
    if (!file) return refuse(404, 'not found');
    return sendFile(request, response, file);
  } catch (error) {
    process.stderr.write(`narrate serve: ${request.url}: ${error.message}\n`);
    return response.headersSent ? response.end() : refuse(500, 'could not read the file');
  }
}

/** Serves `root` on localhost. Resolves with the server once it is listening. */
export function serve(root, port = 4173) {
  const server = createServer((request, response) => handle(root, request, response));
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => done(server));
  });
}
