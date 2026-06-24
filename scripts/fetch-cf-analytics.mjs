#!/usr/bin/env node
/**
 * 从 Cloudflare Workers KV 获取埋点数据并生成分析报告
 */

import { readFileSync, writeFileSync } from 'fs';

const envContent = readFileSync('.env.local', 'utf-8');
const CF_ACCOUNT_ID = envContent.match(/CF_ACCOUNT_ID=(.+)/)?.[1]?.trim();
const CF_API_TOKEN = envContent.match(/CF_API_TOKEN=(.+)/)?.[1]?.trim();
const KV_NAMESPACE_ID = 'd3d7cf8351b24070a156649fdd50790d';
const DAYS = 30;

console.log('📊 AI-DCA 埋点数据分析\n');

async function fetchNotifySettings() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/notify:settings`;

  console.log('🔍 获取客户端数据...');
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` }
  });

  if (!response.ok) {
    throw new Error(`KV 读取失败: ${response.status}`);
  }

  const data = await response.json();
  console.log(`✓ 找到 ${Object.keys(data.clients || {}).length} 个客户端\n`);
  return data;
}

function extractAllEvents(settings) {
  const clients = settings.clients || {};
  const allEvents = [];

  Object.entries(clients).forEach(([clientId, client]) => {
    const events = client.state?.recentEvents || [];
    events.forEach(e => {
      allEvents.push({ ...e, clientId });
    });
  });

  return allEvents;
}

function analyzeEvents(events) {
  const now = Date.now();
  const cutoff = now - DAYS * 24 * 60 * 60 * 1000;

  // 过滤最近 30 天的事件
  const recentEvents = events.filter(e => {
    const ts = new Date(e.createdAt || e.timestamp || 0).getTime();
    return ts > cutoff;
  });

  console.log(`📈 事件统计`);
  console.log(`  总事件数: ${events.length}`);
  console.log(`  最近 ${DAYS} 天: ${recentEvents.length}`);

  // 按事件类型统计
  const byType = {};
  recentEvents.forEach(e => {
    const type = e.eventType || 'unknown';
    byType[type] = (byType[type] || 0) + 1;
  });

  console.log('\n事件类型分布:');
  Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type.padEnd(25)} ${count.toString().padStart(6)} 次`);
    });

  // 分析 session_heartbeat
  const heartbeats = recentEvents.filter(e => e.eventType === 'session_heartbeat');

  console.log(`\n💓 心跳事件分析`);
  console.log(`  心跳总数: ${heartbeats.length}`);

  if (heartbeats.length === 0) {
    console.log('  ⚠️  未找到心跳数据\n');
    return null;
  }

  // 按 activeTab 统计
  const tabCounts = {};
  heartbeats.forEach(e => {
    const tab = e.meta?.activeTab || 'unknown';
    tabCounts[tab] = (tabCounts[tab] || 0) + 1;
  });

  const total = heartbeats.length;
  const stats = Object.entries(tabCounts)
    .map(([tab, count]) => ({
      tab,
      count,
      percentage: ((count / total) * 100).toFixed(2)
    }))
    .sort((a, b) => b.count - a.count);

  console.log('\n📊 页面使用率:');
  stats.forEach((item, i) => {
    const pct = parseFloat(item.percentage);
    const grade = pct >= 10 ? '🔥' : pct >= 5 ? '⭐' : pct >= 1 ? '✓' : '⚠️';
    console.log(`  ${(i + 1).toString().padStart(2)}. ${item.tab.padEnd(20)} ${item.percentage.padStart(6)}%  ${grade}  (${item.count.toLocaleString()} 次)`);
  });

  return { stats, total, heartbeats, recentEvents };
}

function generateReport(analysis) {
  if (!analysis) {
    return `# 埋点数据分析报告

**生成时间**: ${new Date().toISOString().slice(0, 10)}
**数据来源**: Cloudflare Workers KV
**状态**: ⚠️ 未找到有效心跳数据

---

## 说明

当前数据中没有 \`session_heartbeat\` 事件。可能原因：
1. 前端埋点未正确触发
2. 数据同步延迟
3. 用户未在最近 ${DAYS} 天内活跃

请检查前端 \`src/app/analytics.js\` 的心跳触发逻辑。
`;
  }

  const { stats, total } = analysis;
  const today = new Date().toISOString().slice(0, 10);

  let report = `# 埋点数据分析报告

**生成时间**: ${today}
**数据来源**: Cloudflare Workers KV
**数据周期**: 最近 ${DAYS} 天
**总心跳数**: ${total.toLocaleString()} 次

---

## 📊 页面使用率统计

| 排名 | 页面 (activeTab) | 心跳次数 | 使用率 | 评级 |
|------|-----------------|---------|--------|------|
`;

  stats.forEach((item, index) => {
    const rank = index + 1;
    const pct = parseFloat(item.percentage);
    const grade = pct >= 10 ? '🔥 核心' :
                  pct >= 5 ? '⭐ 重要' :
                  pct >= 1 ? '✓ 正常' : '⚠️ 低频';
    report += `| ${rank} | \`${item.tab}\` | ${item.count.toLocaleString()} | **${item.percentage}%** | ${grade} |\n`;
  });

  const top3 = stats.slice(0, 3);
  report += `\n---\n\n## 💡 核心功能（Top 3）\n\n`;
  top3.forEach((item, i) => {
    report += `${i + 1}. **${item.tab}** - ${item.percentage}% 使用率\n`;
  });

  const lowUsage = stats.filter(s => parseFloat(s.percentage) < 1);
  if (lowUsage.length > 0) {
    report += `\n## ⚠️ 低频功能（< 1%）\n\n`;
    report += `以下功能使用率低于 1%，建议评估：\n\n`;
    lowUsage.forEach(item => {
      report += `- \`${item.tab}\` - ${item.percentage}%\n`;
    });
  }

  report += `\n---\n\n## 🎯 行动建议\n\n`;
  report += `### 优化方向\n\n`;
  report += `1. **核心功能优化** - 重点优化前 3 名功能的用户体验\n`;
  report += `2. **低频功能处理** - 评估 < 1% 使用率功能的去留\n`;
  report += `3. **功能发现** - 提升中低频功能的可见性\n\n`;

  report += `### 下次检查\n\n`;
  report += `📅 **${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}**\n\n`;

  report += `---\n\n*本报告基于 Cloudflare Workers 存储的用户行为数据自动生成*\n`;

  return report;
}

async function main() {
  try {
    const settings = await fetchNotifySettings();
    const events = extractAllEvents(settings);

    console.log(`\n📦 数据提取完成`);
    console.log(`  总事件数: ${events.length}\n`);

    const analysis = analyzeEvents(events);
    const report = generateReport(analysis);

    writeFileSync('DATA_ANALYSIS_REPORT.md', report, 'utf-8');
    console.log(`\n✅ 报告已生成: DATA_ANALYSIS_REPORT.md\n`);

  } catch (error) {
    console.error('\n❌ 分析失败:', error.message);
    process.exit(1);
  }
}

main();
