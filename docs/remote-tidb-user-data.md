# 统一远端用户数据迁移

CN 与 global Web 站点使用同一 `ai-dca-user-data` API 和 TiDB 业务数据 authority。D1 只负责 Web users/sessions；浏览器 localStorage 只做迁移期缓存，不是跨站数据源。

CN entry 在渲染业务页前执行 remote bootstrap，区域切换先 flush revision/CAS 写入；shared API cookie 负责跨 origin 登录连续性。

生产发布前必须配置 `TIDB_USER_DATA_URL`、`TIDB_USER_DATA_SERVICE_TOKEN`、TiDB 连接变量和 identity-link/write-fence；本分支不部署、不迁移真实用户数据。
