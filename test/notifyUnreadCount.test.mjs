import test from 'node:test';
import assert from 'node:assert/strict';

const { countUnread } = await import('../src/app/useNotifyUnreadCount.js');

const events = [
  { eventId: 'newest', createdAt: '2026-07-29T10:00:00.000Z' },
  { eventId: 'middle', createdAt: '2026-07-29T09:00:00.000Z' },
  { eventId: 'oldest', createdAt: '2026-07-29T08:00:00.000Z' }
];

test('countUnread handles the worker newest-first event order', () => {
  assert.equal(countUnread(events, 'oldest'), 2);
  assert.equal(countUnread(events, 'newest'), 0);
});

test('countUnread treats a missing last-seen event as unread history', () => {
  assert.equal(countUnread(events, 'expired-event'), 3);
  assert.equal(countUnread([], ''), 0);
});
