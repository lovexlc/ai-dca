# 账户自动同步变更检测计划

## 目标
- 登录后不再无条件上传本地数据。
- 本地数据实际发生变化时才自动上传。
- 拉取逻辑保留自动拉取，但只有「云端数据内容不同」且「云端更新时间晚于本地数据更新时间」时才覆盖本地。

## 步骤清单
- [done] 定位账号同步入口、自动上传监听和整包备份数据结构。
- [done] 在同步核心中加入本地数据签名与本地更新时间。
- [done] 改造登录后的初始拉取/上传判断。
- [done] 改造自动上传监听，避免启动时无条件上传和恢复时回传。
- [done] 运行 ESLint / diff check，并提交推送。
- [todo] 等待 GitHub Pages 部署成功。

## 关键决策
- 本地数据签名基于当前可同步 localStorage payload 的确定性 JSON 字符串生成。
- 本地更新时间只在可同步 key 的值真正变化时更新。
- 恢复云端数据时暂停自动上传监听，避免 restore 过程触发回传。
- 当缺少历史本地更新时间时：如果本地有可同步数据，先把当前时间作为本地基线，避免旧云端误覆盖；如果本地为空，则允许云端恢复。

## 验证记录
- `npx eslint src/app/cloudSync.js src/components/account-menu.jsx`：通过，0 errors。
- 签名 smoke：同 payload 不同 key 顺序签名一致，payload 内容变化签名变化。
- `git diff --check -- src/app/cloudSync.js src/components/account-menu.jsx docs/account-sync-change-detection-plan.md`：通过。
