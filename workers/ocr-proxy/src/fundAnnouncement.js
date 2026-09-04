const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36';

export async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeAnnouncement(item = {}, code = '') {
  const artCode = String(item.ID || item.ART_CODE || item.art_code || '').trim();
  const title = String(item.TITLE || item.title || '').trim();
  const publishDate = String(item.PUBLISHDATE || item.PUBLISHDATEDesc || item.publish_date || '').trim();
  return {
    code: String(code || '').trim(),
    artCode,
    title,
    publishDate,
    sourceUrl: artCode ? `https://fundf10.eastmoney.com/jjgg_${code}_${artCode}.html` : null
  };
}

export async function fetchFundAnnouncementList({ code, type = 0, pageIndex = 1, pageSize = 20, timeoutMs = 5000 } = {}) {
  const fundCode = String(code || '').trim();
  if (!/^\d{6}$/.test(fundCode)) throw new Error('invalid fund code');
  const url = 'https://api.fund.eastmoney.com/f10/JJGG?fundcode=' + encodeURIComponent(fundCode)
    + '&pageIndex=' + encodeURIComponent(pageIndex)
    + '&pageSize=' + encodeURIComponent(pageSize)
    + '&type=' + encodeURIComponent(type)
    + '&_=' + Date.now();
  const response = await fetchWithTimeout(url, {
    headers: {
      'user-agent': DESKTOP_UA,
      referer: 'https://fundf10.eastmoney.com/',
      accept: 'application/json, text/plain, */*'
    }
  }, timeoutMs);
  if (!response.ok) throw new Error(`announcement list http ${response.status}`);
  const payload = await response.json();
  const items = Array.isArray(payload?.Data) ? payload.Data : [];
  return items.map((item) => ({ raw: item, ...normalizeAnnouncement(item, fundCode) }));
}

export async function fetchFundAnnouncementContent({ artCode, code = '', timeoutMs = 7000 } = {}) {
  const id = String(artCode || '').trim();
  if (!id) throw new Error('missing artCode');
  const url = 'https://np-cnotice-fund.eastmoney.com/api/content/ann?art_code=' + encodeURIComponent(id)
    + '&client_source=web_fund&page_index=1';
  const response = await fetchWithTimeout(url, {
    headers: {
      'user-agent': DESKTOP_UA,
      referer: 'https://fundf10.eastmoney.com/',
      accept: 'application/json, text/plain, */*'
    }
  }, timeoutMs);
  if (!response.ok) throw new Error(`announcement content http ${response.status}`);
  const payload = await response.json();
  const data = payload?.data || {};
  const noticeContent = typeof data.notice_content === 'string' ? data.notice_content : '';
  const pdfFallback = `https://pdf.dfcfw.com/pdf/H2_${id}_1.pdf`;
  return {
    code: String(code || '').trim(),
    artCode: id,
    noticeContent,
    attachUrl: data.attach_url_web || data.attach_url || pdfFallback,
    sourceUrl: data.source_url || pdfFallback,
    raw: data
  };
}
