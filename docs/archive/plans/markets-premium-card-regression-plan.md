# 行情中心溢价大卡片回归排查计划

## 目标
排查 A 股基金溢价参数下仍显示“估算溢价”大卡片的原因，核对 commit 与 GitHub Actions 部署状态；如代码仍保留该卡片，直接删除并推送。

## 步骤清单
- done：核对 premium 相关最近 commit 与当前源码。
- done：核对 GitHub Actions Pages/验收部署状态：`9251df6` 的 Build App 与 Deploy GitHub Pages 均为 success。
- done：删除溢价模式下的 `PremiumInsightCard` 定义与说明块渲染。
- done：执行静态校验：`grep` 确认 `PremiumInsightCard`、`正在计算溢价`、`估算溢价</div>`、`溢价采用最简单` 均已不存在；`git diff --check` 通过；脚本输出 `STATIC_CHECK_OK`。
- done：提交修改：`28cb8efe83ca5dd32995529d4b49e9d549896e75`。
- todo：push 到 origin/main 并检查 Actions。

## 关键决策
- 用户已明确不需要这一大块 card；本次不再保留 `PremiumInsightCard` 渲染。
- 保留净值模式下的小型 `NavInsightCard`，因为用户反馈指向溢价模式的大卡片。

## 待确认项
- 暂无。

## 产出与验证记录
- 排查结果：`9251df6 fix: simplify premium explanation` 已由 Build App 和 Deploy GitHub Pages 成功部署，但源码仍保留溢价模式说明块；本次彻底移除溢价模式下的大卡片/说明块。
