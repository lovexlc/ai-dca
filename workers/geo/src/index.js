/* global Response */

// 访问地区识别端点。只回一个国家码 + 边缘节点信息，不记日志、不回 IP。
// Cloudflare 会在代理请求上带 cf-ipcountry 头和 request.cf.country。

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,HEAD,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400'
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 地区必须每次真实计算，不允许任何中间层缓存。
      'cache-control': 'no-store, no-cache, must-revalidate',
      ...CORS_HEADERS
    }
  });
}

// XX / T1 是 Cloudflare 对未知和 Tor 的占位值，当作“没识别出来”处理。
export function normalizeCountryCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw || raw === 'XX' || raw === 'T1') return '';
  return /^[A-Z]{2}$/.test(raw) ? raw : '';
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ ok: false, error: 'method not allowed' }, 405);
    }

    const cf = request.cf || {};
    const country = normalizeCountryCode(request.headers.get('cf-ipcountry') || cf.country);

    return json({
      ok: true,
      country,
      colo: String(cf.colo || ''),
      timezone: String(cf.timezone || ''),
      generatedAt: new Date().toISOString()
    });
  }
};
