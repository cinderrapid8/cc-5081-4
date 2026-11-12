// Static file server for the demo. No dependencies.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export function createDemoServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/' || pathname === '') pathname = '/demo/index.html';
      // The demo lives under /demo; bare module paths resolve there too so a
      // relative <script src="./demo.js"> works from the page root.
      if (pathname === '/demo.js') pathname = '/demo/demo.js';
      const safe = normalize(pathname).replace(/(\.\.(\/|$))+/g, '');
      const filePath = join(root, safe);
      if (!filePath.startsWith(root)) {
        response.writeHead(403).end('forbidden');
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        'content-type': MIME[extname(filePath)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`not found: ${error.code || error.message}`);
    }
  });
}

if (process.argv[1] && fileURLToPath(new URL(import.meta.url)) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 4180;
  createDemoServer().listen(port, () => {
    console.log(`guard demo: http://localhost:${port}/`);
  });
}
