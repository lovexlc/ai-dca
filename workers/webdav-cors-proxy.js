// WebDAV CORS Proxy — Cloudflare Worker
//
// 用途：给 ai-dca 纯前端的「数据同步 / 备份」tab 做 CORS 代理，
//       让浏览器能跨域访问坚果云、Nextcloud、Infomaniak 等不开 CORS 的 WebDAV。
//
// 调用格式（生产环境，路由绑定在 tools.freebacktrack.tech）：
//   https://tools.freebacktrack.tech/api/webdav/<full-target-url>
//   例：https://tools.freebacktrack.tech/api/webdav/https://dav.jianguoyun.com/dav/ai-dca-backup/ai-dca-backup.json
//
// 也兑容 workers.dev 默认子域，调用格式：
//   https://webdav-cors-proxy.<sub>.workers.dev/<full-target-url>
//
// 安全说明：
//   - 默认只放行 ALLOWED_ORIGINS 里的来源，防止被当成公共代理。
//   - 上线前请确保将前端所在的域名加到列表。
//   - Worker 不对凭据做任何处理，只是透传 Authorization 头。

const ALLOWED_ORIGINS = [
  'https://tools.freebacktrack.tech',
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173'
];

// 绑在自定义域名的路由前缀。命中时会被剔除，剩下的才是目标 URL。
// 路由模式：tools.freebacktrack.tech/api/webdav/*
const ROUTE_PREFIX = '/api/webdav/';

// WebDAV 标准上除了 HTTP 动词，还需要 PROPFIND / MKCOL / COPY / MOVE / LOCK / UNLOCK。
const ALLOWED_METHODS =
  'GET,POST,PUT,DELETE,PATCH,HEAD,OPTIONS,PROPFIND,PROPPATCH,MKCOL,COPY,MOVE,LOCK,UNLOCK';

const ALLOWED_REQUEST_HEADERS =
  'Authorization,Content-Type,Depth,Destination,Overwrite,Lock-Token,If,X-Requested-With';

const EXPOSED_RESPONSE_HEADERS =
  'Content-Type,Content-Length,ETag,Last-Modified,DAV,Location';

const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'origin',
  'referer',
  'cf-connecting-ip',
  'cf-ray',
  'cf-visitor',
  'cf-ipcountry',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip'
]);

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS,
    'Access-Control-Expose-Headers': EXPOSED_RESPONSE_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function jsonError(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';

    // Preflight
    if (request.method === 'OPTIONS') {
      if (!ALLOWED_ORIGINS.includes(origin)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // 非 preflight 但没带 Origin——直接走 postman 之类的工具，也拒绝。
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      return jsonError(403, `Origin not allowed: ${origin || '(missing)'}`, origin);
    }

    // 解析目标 URL。
    // - 在 tools.freebacktrack.tech/api/webdav/<target> 下调用时，剔掉前缀。
    // - 在 workers.dev 直调时，pathname 本身就是 /<target>，剔掉开头的 /。
    const url = new URL(request.url);
    let pathPart;
    if (url.pathname.startsWith(ROUTE_PREFIX)) {
      pathPart = url.pathname.slice(ROUTE_PREFIX.length);
    } else {
      pathPart = url.pathname.replace(/^\/+/, '');
    }
    const rawTarget = `${pathPart}${url.search}`;
    if (!/^https?:\/\//i.test(rawTarget)) {
      return jsonError(
        400,
        'Bad target URL. Call with <worker-url>/<full-target-url> (must start with http:// or https://).',
        origin
      );
    }

    // 复制请求头，过滤掉 Cloudflare/Host/Origin 等 hop-by-hop 头。
    const forwardHeaders = new Headers();
    for (const [key, value] of request.headers.entries()) {
      if (STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
      forwardHeaders.set(key, value);
    }

    let upstream;
    try {
      upstream = await fetch(rawTarget, {
        method: request.method,
        headers: forwardHeaders,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'follow'
      });
    } catch (err) {
      return jsonError(502, `Upstream fetch failed: ${err?.message || err}`, origin);
    }

    const responseHeaders = new Headers(upstream.headers);
    // 移除有毒头
    responseHeaders.delete('Access-Control-Allow-Origin');
    responseHeaders.delete('Access-Control-Allow-Credentials');
    responseHeaders.delete('Access-Control-Allow-Methods');
    responseHeaders.delete('Access-Control-Allow-Headers');
    responseHeaders.delete('Access-Control-Expose-Headers');
    // 写入统一的 CORS 头
    for (const [k, v] of Object.entries(corsHeaders(origin))) {
      responseHeaders.set(k, v);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  }
};
