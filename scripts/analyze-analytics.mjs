#!/usr/bin/env node
/**
 * 埋点数据分析脚本
 *
 * 用途：分析最近 30 天的用户行为数据，生成使用率报告
 * 运行：node scripts/analyze-analytics.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// 配置
const SYNC_API = process.env.ANALYTICS_API || 'https://api.freebacktrack.tech/api/sync';
const DAYS = parseInt(process.env.DAYS || '30', 10);
const OUTPUT_FILE = 'DATA_ANALYSIS_REPORT.md';

console.log(`📊 埋点数据分析
====================
数据周期: 最近 ${DAYS} 天
API 端点: ${SYNC_API}
输出文件: ${OUTPUT_FILE}
`);

/**
 * 从本地 localStorage 模拟数据读取（实际应该从 Worker API 获取）
 */
async function fetchAnalyticsData() {
  console.log('⚠️  注意: 此脚本需要访问生产环境的埋点数据');
  console.log('请按以下步骤操作：\n');

  console.log('方法 1: 从浏览器导出本地数据');
  console.log('----------------------------');
  console.log('1. 打开网站（已登录状态）');
  console.log('2. 打开浏览器控制台（F12）');
  console.log('3. 运行以下代码：\n');
  console.log('```javascript');
  console.log('const events = JSON.parse(localStorage.getItem("aiDcaAnalyticsEvents_v1") || "[]");');
  console.log('const data = { events, exportedAt: new Date().toISOString() };');
  console.log('const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });');
  console.log('const url = URL.createObjectURL(blob);');
  console.log('const a = document.createElement("a");');
  console.log('a.href = url;');
  console.log('a.download = "analytics-export.json";');
  console.log('a.click();');
  console.log('```\n');
  console.log('4. 将下载的文件放到项目根目录');
  console.log('5. 重新运行此脚本\n');

  console.log('方法 2: 从 Cloudflare Workers 查询');
  console.log('-----------------------------------');
  console.log('1. 登录 Cloudflare Dashboard');
  console.log('2. 进入 Workers & Pages > notify');
  console.log('3. 使用 wrangler cli 查询：');
  console.log('   wrangler d1 execute notify-db --command "SELECT * FROM client_settings LIMIT 10"');
  console.log('4. 或通过 Worker API 端点获取数据\n');

  // 尝试读取本地导出文件
  try {
    const localData = readFileSync('analytics-export.json', 'utf-8');
    const parsed = JSON.parse(localData);
    console.log(`✅ 成功读取本地数据: ${parsed.events?.length || 0} 条事件\n`);
    return parsed.events || [];
  } catch (err) {
    console.error('❌ 未找到 analytics-export.json\n');
    return [];
  }
}

/**
 * 分析 session_heartbeat 事件
 */
function analyzeHeartbeats(events) {
  const now = Date.now();
  const cutoff = now - DAYS * 24 * 60 * 60 * 1000;

  const heartbeats = events.filter(e =>
    e.eventType === 'session_heartbeat' &&
    new Date(e.createdAt).getTime() > cutoff
  );

  console.log(`📈 心跳事件分析`);
  console.log(`总计: ${heartbeats.length} 条`);
  console.log(`时间范围: ${new Date(cutoff).toISOString().slice(0, 10)} 至今\n`);

  // 按 activeTab 统计
  const tabCounts = {};
  heartbeats.forEach(e => {
    const tab = e.meta?.activeTab || 'unknown';
    tabCounts[tab] = (tabCounts[tab] || 0) + 1;
  });

  // 计算使用率
  const total = heartbeats.length;
  const stats = Object.entries(tabCounts)
    .map(([tab, count]) => ({
      tab,
      count,
      percentage: ((count / total) * 100).toFixed(2)
    }))
    .sort((a, b) => b.count - a.count);

  return { stats, total, heartbeats };
}

/**
 * 生成 Markdown 报告
 */
function generateReport(analysis) {
  const { stats, total, heartbeats } = analysis;
  const today = new Date().toISOString().slice(0, 10);

  let report = `# 埋点数据分析报告

**生成时间**: ${today}
**数据周期**: 最近 ${DAYS} 天
**总心跳数**: ${total.toLocaleString()} 次

---

## 📊 页面使用率统计

| 排名 | 页面 (activeTab) | 心跳次数 | 使用率 | 评级 |
|------|-----------------|---------|--------|------|
`;

  stats.forEach((item, index) => {
    const rank = index + 1;
    const grade = item.percentage >= 10 ? '🔥 核心' :
                  item.percentage >= 5 ? '⭐ 重要' :
                  item.percentage >= 1 ? '✓ 正常' : '⚠️ 低频';
    report += `| ${rank} | \`${item.tab}\` | ${item.count.toLocaleString()} | **${item.percentage}%** | ${grade} |\n`;
  });

  report += `\n---\n\n## 💡 分析结论\n\n`;

  const top3 = stats.slice(0, 3);
  report += `### 核心功能（前3名）\n\n`;
  top3.forEach((item, i) => {
    report += `${i + 1}. **${item.tab}** - ${item.percentage}% 使用率\n`;
  });

  const lowUsage = stats.filter(s => parseFloat(s.percentage) < 1);
  if (lowUsage.length > 0) {
    report += `\n### ⚠️ 低频功能（< 1%）\n\n`;
    report += `以下功能使用率低于 1%，建议评估是否保留：\n\n`;
    lowUsage.forEach(item => {
      report += `- \`${item.tab}\` - ${item.percentage}%\n`;
    });
  }

  report += `\n---\n\n## 🎯 下一步行动\n\n`;
  report += `- [ ] 优化核心功能体验（前 3 名）\n`;
  report += `- [ ] 评估低频功能去留（< 1%）\n`;
  report += `- [ ] 30 天后重新分析（${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}）\n`;

  return report;
}

/**
 * 主函数
 */
async function main() {
  const events = await fetchAnalyticsData();

  if (events.length === 0) {
    console.log('⚠️  无数据，退出分析');
    process.exit(1);
  }

  const analysis = analyzeHeartbeats(events);

  console.log('📋 页面使用率:');
  analysis.stats.forEach((item, i) => {
    console.log(`  ${i + 1}. ${item.tab.padEnd(20)} ${item.percentage.padStart(6)}%  (${item.count} 次)`);
  });
  console.log('');

  const report = generateReport(analysis);
  writeFileSync(OUTPUT_FILE, report, 'utf-8');

  console.log(`✅ 报告已生成: ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('❌ 分析失败:', err);
  process.exit(1);
});
