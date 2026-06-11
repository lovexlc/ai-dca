const ADS_TXT = 'google.com, pub-1376743188081698, DIRECT, f08c47fec0942fa0\n';
const TARGET_ORIGIN = 'https://tools.freebacktrack.tech';

function isAdsTxtPath(pathname = '') {
  return pathname.replace(/\/+$/, '') === '/ads.txt';
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (isAdsTxtPath(url.pathname)) {
      return new Response(ADS_TXT, {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'public, max-age=300'
        }
      });
    }

    const target = new URL(url.pathname + url.search, TARGET_ORIGIN);
    return Response.redirect(target.toString(), 301);
  }
};
