'use strict';

/**
 * 静态资源：安全路径解析 + ETag/304 + gzip/brotli 压缩缓存。
 *
 * 移动端通过 WebView 加载，弱网下压缩收益明显；
 * ETag 让二次打开不再整包重传。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('./config');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// 只有文本类值得压缩（图片已经压过）
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg)/;

// 压缩结果缓存：key = 路径 + 尺寸 + mtime + 编码
const cache = new Map();
const CACHE_LIMIT = 96;
let cacheBytes = 0;
const CACHE_MAX_BYTES = 24 * 1024 * 1024;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  // 简易 LRU：重插到末尾
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cachePut(key, buf) {
  if (buf.length > 4 * 1024 * 1024) return;
  if (cache.has(key)) {
    cacheBytes -= cache.get(key).length;
    cache.delete(key);
  }
  cache.set(key, buf);
  cacheBytes += buf.length;
  while (cacheBytes > CACHE_MAX_BYTES && cache.size > 1) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).length;
    cache.delete(oldest);
  }
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).length;
    cache.delete(oldest);
  }
}

function parseAccepts(header) {
  const h = String(header || '');
  return {
    br: /\bbr\b/.test(h),
    gzip: /\bgzip\b/.test(h),
  };
}

function resolveSafe(urlPath) {
  let p;
  try {
    p = decodeURIComponent(String(urlPath || '/').split('?')[0]);
  } catch {
    return { error: 400 };
  }
  if (p === '/' || p === '') p = '/index.html';
  if (p.indexOf('\0') >= 0) return { error: 400 };

  const file = path.resolve(config.PUBLIC_DIR, '.' + (p.startsWith('/') ? p : '/' + p));
  if (file !== config.PUBLIC_DIR && !file.startsWith(config.PUBLIC_DIR + path.sep)) {
    return { error: 403 };
  }
  return { file };
}

function serve(req, res) {
  const { file, error } = resolveSafe(req.url);

  if (error) {
    res.writeHead(error, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end(error === 403 ? 'forbidden' : 'bad request');
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }

    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';

    // 条件请求
    const inm = req.headers['if-none-match'];
    if (inm && inm === etag) {
      res.writeHead(304, { etag, 'cache-control': cacheControl(ext) });
      return res.end();
    }

    const isHtml = ext === '.html';
    const canCompress = COMPRESSIBLE.test(type) && st.size > 1024;
    const accepts = parseAccepts(req.headers['accept-encoding']);
    const enc = canCompress ? (accepts.br ? 'br' : accepts.gzip ? 'gzip' : '') : '';

    const headers = {
      'content-type': type,
      'cache-control': cacheControl(ext),
      etag,
      'x-content-type-options': 'nosniff',
    };
    if (enc) {
      headers['content-encoding'] = enc;
      headers.vary = 'Accept-Encoding';
    }

    const key = file + '|' + st.size + '|' + Math.floor(st.mtimeMs) + '|' + enc;

    if (enc) {
      const cached = cacheGet(key);
      if (cached) {
        headers['content-length'] = String(cached.length);
        res.writeHead(200, headers);
        return res.end(req.method === 'HEAD' ? undefined : cached);
      }
    }

    fs.readFile(file, (e2, raw) => {
      if (e2) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('read error');
      }

      if (!enc) {
        headers['content-length'] = String(raw.length);
        res.writeHead(200, headers);
        return res.end(req.method === 'HEAD' ? undefined : raw);
      }

      const finish = (buf) => {
        cachePut(key, buf);
        headers['content-length'] = String(buf.length);
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : buf);
      };

      if (enc === 'br') {
        zlib.brotliCompress(raw, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
          },
        }, (e3, buf) => {
          if (e3) {
            // 压缩失败就退回原始内容
            delete headers['content-encoding'];
            headers['content-length'] = String(raw.length);
            res.writeHead(200, headers);
            return res.end(raw);
          }
          finish(buf);
        });
      } else {
        zlib.gzip(raw, { level: 6 }, (e3, buf) => {
          if (e3) {
            delete headers['content-encoding'];
            headers['content-length'] = String(raw.length);
            res.writeHead(200, headers);
            return res.end(raw);
          }
          finish(buf);
        });
      }
    });
  });
}

function cacheControl(ext) {
  if (ext === '.html') return 'no-cache';
  // 图标与字体很少变，给长缓存；其余走 ETag 协商
  if (/\.(png|jpg|jpeg|webp|ico|woff2?|ttf)$/.test(ext)) return 'public, max-age=604800';
  if (/\.(css|js|mjs)$/.test(ext)) return 'no-cache';
  return 'public, max-age=3600';
}

module.exports = { serve, MIME, cacheStats: () => ({ entries: cache.size, bytes: cacheBytes }) };
