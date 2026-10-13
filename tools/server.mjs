// Servidor estático mínimo (sem dependências). Serve a raiz do estúdio por HTTP para que
// as cenas carreguem lib/, assets/, áudio e JSON com fetch (em file:// isso falha).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.aiff': 'audio/aiff',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

/** Sobe o servidor em 127.0.0.1 (porta livre se port = 0). Devolve { url, port, close }. */
export function startServer({ root, port = 0 } = {}) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const resolvedRoot = path.resolve(root);
      let file = path.resolve(resolvedRoot, `.${decodeURIComponent(url.pathname)}`);
      if (file !== resolvedRoot && !file.startsWith(resolvedRoot + path.sep)) return send(res, 403, 'fora da raiz');
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) return send(res, 404, `não encontrado: ${url.pathname}`);
      const stat = fs.statSync(file);
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
      // Range é necessário para <video>/<audio> buscarem um ponto do arquivo.
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Number(range[2]) : stat.size - 1;
        res.writeHead(206, {
          'content-type': type,
          'content-length': end - start + 1,
          'content-range': `bytes ${start}-${end}/${stat.size}`,
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      send(res, 500, String(err?.stack || err));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({ url: `http://127.0.0.1:${p}`, port: p, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function send(res, code, text) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}
