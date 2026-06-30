import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNotificationAction,
  buildNotificationLinks
} from '../workers/notify/src/notificationLinks.js';

test('buildNotificationLinks defaults to freebacktrack web links and reserves app targets', () => {
  const links = buildNotificationLinks({}, 'fundSwitch', {
    code: '513100',
    trigger: 'switch-threshold'
  });

  assert.equal(links.target, 'fundSwitch');
  assert.equal(links.web, 'https://freebacktrack.tech/index.html?tab=fundSwitch&source=notification&code=513100&trigger=switch-threshold');
  assert.equal(links.app, '');
  assert.equal(links.miniProgram, '');
});

test('buildNotificationAction allows worker env web override', () => {
  const action = buildNotificationAction({
    NOTIFICATION_WEB_BASE_URL: 'https://example.test/app/'
  }, 'holdings', {
    code: '513100'
  });

  assert.equal(action.detailUrl, 'https://example.test/index.html?tab=holdings&source=notification&code=513100');
  assert.equal(action.url, action.detailUrl);
  assert.equal(action.links.web, action.detailUrl);
  assert.equal(action.links.app, '');
  assert.equal(action.links.miniProgram, '');
  assert.equal(action.params.code, '513100');
});
