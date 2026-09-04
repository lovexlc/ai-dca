import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SITE_ORIGIN_CN,
  DEFAULT_SITE_ORIGIN_GLOBAL,
  REGION_CN,
  REGION_GLOBAL,
  buildRegionTargetUrl,
  detectRegionFromEnvironment,
  normalizeOrigin,
  parseTraceCountryCode,
  readSiteRegionConfig,
  regionFromCountryCode,
  regionFromTimeZone,
  resolveRegionBanner
} from '../src/app/regionEnvironment.js';

const config = readSiteRegionConfig({
  VITE_SITE_ORIGIN_CN: 'https://cn.example.com',
  VITE_SITE_ORIGIN_GLOBAL: 'global.example.com'
});

test('normalizeOrigin 自动补全协议、保留端口、去掉尾部路径', () => {
  assert.equal(normalizeOrigin('global.example.com'), 'https://global.example.com');
  assert.equal(normalizeOrigin('https://cn.example.com/'), 'https://cn.example.com');
  assert.equal(
    normalizeOrigin('http://cn.freebacktrack.tech:5000/'),
    'http://cn.freebacktrack.tech:5000'
  );
  assert.equal(normalizeOrigin(''), '');
});

test('国家码与时区可识别地区', () => {
  assert.equal(regionFromCountryCode('cn'), REGION_CN);
  assert.equal(regionFromCountryCode('US'), REGION_GLOBAL);
  assert.equal(regionFromCountryCode(''), '');
  assert.equal(regionFromTimeZone('Asia/Shanghai'), REGION_CN);
  assert.equal(regionFromTimeZone('Asia/Taipei'), REGION_GLOBAL);
});

test('识别优先级：override > 国家码 > 记忆 > 时区 > 语言', () => {
  assert.equal(
    detectRegionFromEnvironment({ override: 'global', countryCode: 'CN', timeZone: 'Asia/Shanghai' }),
    REGION_GLOBAL
  );
  assert.equal(
    detectRegionFromEnvironment({ countryCode: 'CN', storedRegion: 'global' }),
    REGION_CN
  );
  assert.equal(
    detectRegionFromEnvironment({ timeZone: 'America/New_York', languages: ['zh-CN'] }),
    REGION_GLOBAL
  );
  assert.equal(detectRegionFromEnvironment({ languages: ['zh-CN', 'en'] }), REGION_CN);
  assert.equal(detectRegionFromEnvironment({}), '');
});

test('跳转链接保留 path / query / hash', () => {
  assert.equal(
    buildRegionTargetUrl('https://cn.example.com', 'https://global.example.com/markets?tab=us#top'),
    'https://cn.example.com/markets?tab=us#top'
  );
  assert.equal(buildRegionTargetUrl('', 'https://global.example.com/'), '');
});

test('国内访客在海外站点时展示中文横幅', () => {
  const banner = resolveRegionBanner({
    region: REGION_CN,
    config,
    currentHref: 'https://global.example.com/markets'
  });
  assert.equal(banner.region, REGION_CN);
  assert.equal(banner.targetUrl, 'https://cn.example.com/markets');
  assert.match(banner.title, /中国大陆/);
});

test('海外访客在国内站点时展示英文横幅', () => {
  const banner = resolveRegionBanner({
    region: REGION_GLOBAL,
    config,
    currentHref: 'https://cn.example.com/markets'
  });
  assert.equal(banner.region, REGION_GLOBAL);
  assert.equal(banner.targetUrl, 'https://global.example.com/markets');
});

test('已在目标域名 / 已关闭 / 地区未知时不展示', () => {
  assert.equal(
    resolveRegionBanner({ region: REGION_CN, config, currentHref: 'https://cn.example.com/' }),
    null
  );
  assert.equal(
    resolveRegionBanner({
      region: REGION_CN,
      config,
      currentHref: 'https://global.example.com/',
      dismissed: true
    }),
    null
  );
  assert.equal(resolveRegionBanner({ region: '', config, currentHref: 'https://global.example.com/' }), null);
});

test('VITE_SITE_REGION 与访客地区一致时不展示', () => {
  const cnSiteConfig = readSiteRegionConfig({
    VITE_SITE_REGION: 'cn',
    VITE_SITE_ORIGIN_CN: 'https://cn.example.com',
    VITE_SITE_ORIGIN_GLOBAL: 'https://global.example.com'
  });
  assert.equal(
    resolveRegionBanner({ region: REGION_CN, config: cnSiteConfig, currentHref: 'https://other.example.com/' }),
    null
  );
});

test('未配置目标域名时不展示', () => {
  assert.equal(
    resolveRegionBanner({
      region: REGION_CN,
      config: { siteRegion: '', cnOrigin: '', globalOrigin: '' },
      currentHref: 'https://global.example.com/'
    }),
    null
  );
});

test('默认域名：freebacktrack.tech 为海外，cn.freebacktrack.tech:5000 为国内', () => {
  const defaults = readSiteRegionConfig({});
  assert.equal(defaults.globalOrigin, 'https://freebacktrack.tech');
  assert.equal(defaults.cnOrigin, 'http://cn.freebacktrack.tech:5000');
  assert.equal(normalizeOrigin(DEFAULT_SITE_ORIGIN_GLOBAL), defaults.globalOrigin);
  assert.equal(normalizeOrigin(DEFAULT_SITE_ORIGIN_CN), defaults.cnOrigin);

  // 国内访客落在海外站：提示去国内站，且保留路径
  const toCn = resolveRegionBanner({
    region: REGION_CN,
    config: defaults,
    currentHref: 'https://freebacktrack.tech/markets?tab=cn'
  });
  assert.equal(toCn.targetUrl, 'http://cn.freebacktrack.tech:5000/markets?tab=cn');

  // 海外访客落在国内站：提示去海外站
  const toGlobal = resolveRegionBanner({
    region: REGION_GLOBAL,
    config: defaults,
    currentHref: 'http://cn.freebacktrack.tech:5000/markets'
  });
  assert.equal(toGlobal.targetUrl, 'https://freebacktrack.tech/markets');

  // 已在匹配站点（含 www.）时不提示
  assert.equal(
    resolveRegionBanner({
      region: REGION_GLOBAL,
      config: defaults,
      currentHref: 'https://www.freebacktrack.tech/'
    }),
    null
  );
  assert.equal(
    resolveRegionBanner({
      region: REGION_CN,
      config: defaults,
      currentHref: 'http://cn.freebacktrack.tech:5000/'
    }),
    null
  );
});

test('解析 Cloudflare trace 国家码', () => {
  assert.equal(parseTraceCountryCode('fl=1a\nloc=CN\ntls=TLSv1.3'), 'CN');
  assert.equal(parseTraceCountryCode('loc=us'), 'US');
  assert.equal(parseTraceCountryCode('no-loc-here'), '');
});
