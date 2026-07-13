import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsIdentity, isActiveAnalyticsEvent } from '../src/app/analytics.js';

test('analytics identity prefers logged-in user and falls back to visitor', () => {
  assert.equal(analyticsIdentity({ userId: 'user-1', visitorId: 'visitor-1' }), 'user-1');
  assert.equal(analyticsIdentity({ userId: '', visitorId: 'visitor-1' }), 'visitor-1');
  assert.equal(analyticsIdentity({}), '');
});

test('active user events exclude background and passive telemetry', () => {
  assert.equal(isActiveAnalyticsEvent({ type: 'page_view' }), true);
  assert.equal(isActiveAnalyticsEvent({ type: 'page_engagement' }), true);
  assert.equal(isActiveAnalyticsEvent({ type: 'session_heartbeat' }), false);
  assert.equal(isActiveAnalyticsEvent({ type: 'notify_used' }), false);
});
