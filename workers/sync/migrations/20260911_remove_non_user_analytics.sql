-- 产品埋点只保留真实用户操作。
-- 清除通知 Worker 历史产生的切换扫描、触发和送达事件。
DELETE FROM analytics_events
WHERE session_id = 'notify-worker'
   OR id LIKE 'worker:switch\_%' ESCAPE '\'
   OR type IN (
     'switch_worker_run',
     'switch_notification_triggered',
     'switch_notification_delivery'
   );

-- 管理看板常用过滤和聚合索引。
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_date
  ON analytics_events (type, event_date);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_date
  ON analytics_events (user_id, event_date);
CREATE INDEX IF NOT EXISTS idx_analytics_events_visitor_date
  ON analytics_events (visitor_id, event_date);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created
  ON analytics_events (created_at DESC);
