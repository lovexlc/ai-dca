const CNN_FNG_HOST = 'https://' + 'production.dataviz.cnn.io';

// CNN 接口认浏览器 UA 严格——不像 Chrome 就给 418。
const CNN_BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  origin: 'https://edition.cnn.com',
  referer: 'https://edition.cnn.com/'
};

function round(value, precision = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
}

export async function fetchTavilyNews({ key, query, maxResults = 8, days = 1 }) {
  if (!key) throw new Error('missing TAVILY_API_KEY');
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query,
      topic: 'news',
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      max_results: maxResults,
      days
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`tavily news HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data?.results) ? data.results : [];
}

// 从 URL 推出人读友好的来源名：reuters.com -> "Reuters"、finance.yahoo.com -> "Yahoo Finance"。
export function hostToSourceName(url) {
  if (!url) return '';
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
  const map = {
    'reuters.com': 'Reuters',
    'cnbc.com': 'CNBC',
    'wsj.com': 'WSJ',
    'bloomberg.com': 'Bloomberg',
    'nytimes.com': 'NYT',
    'ft.com': 'FT',
    'marketwatch.com': 'MarketWatch',
    'finance.yahoo.com': 'Yahoo Finance',
    'yahoo.com': 'Yahoo Finance',
    'barrons.com': "Barron's",
    'axios.com': 'Axios',
    'politico.com': 'Politico',
    'apnews.com': 'AP',
    'foxbusiness.com': 'Fox Business',
    'theguardian.com': 'Guardian',
    'businessinsider.com': 'Business Insider',
    'seekingalpha.com': 'Seeking Alpha',
    'investing.com': 'Investing.com',
    'forbes.com': 'Forbes',
    'fortune.com': 'Fortune',
    'theverge.com': 'The Verge',
    'techcrunch.com': 'TechCrunch',
    'arstechnica.com': 'Ars Technica',
    'morningstar.com': 'Morningstar',
    'benzinga.com': 'Benzinga',
    'cnn.com': 'CNN',
    'bbc.com': 'BBC',
    'bbc.co.uk': 'BBC',
    'reutersagency.com': 'Reuters',
    'wsj.market': 'WSJ'
  };
  if (map[host]) return map[host];
  const parts = host.split('.');
  const base = parts.length >= 2 ? parts.slice(-2).join('.') : host;
  if (map[base]) return map[base];
  return base;
}

const FNG_RATING_ZH = {
  'extreme fear': '极度恐惧',
  fear: '恐惧',
  neutral: '中性',
  greed: '贪婪',
  'extreme greed': '极度贪婪'
};

export async function fetchCnnFearGreed() {
  const url = new URL('/index/fearandgreed/graphdata', CNN_FNG_HOST);
  const res = await fetch(url, { headers: CNN_BROWSER_HEADERS, cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error('cnn fng HTTP ' + res.status);
  const data = await res.json();
  const fg = data && data.fear_and_greed;
  if (!fg || typeof fg.score !== 'number') throw new Error('cnn fng empty');
  const score = round(fg.score, 2);
  const previousClose = round(fg.previous_close, 2);
  const change = score != null && previousClose != null ? round(score - previousClose, 2) : null;
  const changePercent = previousClose ? round(((score - previousClose) / previousClose) * 100, 2) : null;
  const ratingKey = String(fg.rating || '').trim().toLowerCase();
  const ratingZh = FNG_RATING_ZH[ratingKey] || ratingKey;
  return {
    symbol: 'CNN_FNG',
    name: ratingZh ? '恐惧贪婪·' + ratingZh : '恐惧贪婪指数',
    market: 'us',
    price: score,
    previousClose,
    change,
    changePercent,
    rating: ratingKey,
    previousWeek: round(fg.previous_1_week, 2),
    previousMonth: round(fg.previous_1_month, 2),
    previousYear: round(fg.previous_1_year, 2),
    currency: '',
    exchangeTimezone: 'America/New_York',
    marketState: '',
    asOf: fg.timestamp ? new Date(fg.timestamp).toISOString() : new Date().toISOString()
  };
}
