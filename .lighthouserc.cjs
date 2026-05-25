module.exports = {
  ci: {
    collect: {
      staticDistDir: '.frontend-build',
      url: [
        '/index.html?tab=markets',
        '/index.html?tab=holdings',
        '/index.html?tab=strategyGuide',
        '/index.html?tab=notify'
      ],
      numberOfRuns: 1,
      settings: {
        formFactor: 'mobile',
        screenEmulation: {
          mobile: true,
          width: 390,
          height: 844,
          deviceScaleFactor: 2,
          disabled: false
        },
        throttlingMethod: 'simulate'
      }
    },
    assert: {
      preset: 'lighthouse:recommended',
      assertions: {
        'categories:performance': ['warn', { minScore: 0.45 }],
        'categories:accessibility': ['warn', { minScore: 0.8 }],
        'categories:best-practices': ['warn', { minScore: 0.75 }],
        'categories:seo': 'off',
        'uses-http2': 'off',
        'unused-javascript': 'off'
      }
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci'
    }
  }
};
