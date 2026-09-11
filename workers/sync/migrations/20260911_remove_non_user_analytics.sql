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
