/**
 * 分析活跃的通知用户
 *
 * 统计指标：
 * - 最近 7 天有通知活动的用户（活跃）
 * - 最近 30 天有通知活动的用户
 * - 按平台分类统计
 */

import { buildAnalyticsSummary } from '../src/app/analytics.js';

function analyzeActiveNotifyUsers() {
  // 7天活跃
  const summary7d = buildAnalyticsSummary({ rangeDays: 7 });
  // 30天活跃
  const summary30d = buildAnalyticsSummary({ rangeDays: 30 });
  // 90天历史
  const summary90d = buildAnalyticsSummary({ rangeDays: 90 });

  console.log('='.repeat(60));
  console.log('通知功能活跃用户分析');
  console.log('='.repeat(60));
  console.log();

  console.log('📊 用户总数统计：');
  console.log(`  最近  7 天活跃：${summary7d.cards.notifyUsers} 人`);
  console.log(`  最近 30 天活跃：${summary30d.cards.notifyUsers} 人`);
  console.log(`  最近 90 天历史：${summary90d.cards.notifyUsers} 人`);
  console.log();

  console.log('📱 7天活跃用户 - 按平台分布：');
  const platforms7d = summary7d.cards.notifyPlatformUsers || {};
  console.log(`  iOS:        ${platforms7d.ios || 0} 人`);
  console.log(`  Server酱³:  ${platforms7d.serverchan3 || 0} 人`);
  console.log(`  PC:         ${platforms7d.pc || 0} 人`);
  console.log(`  未知/历史:   ${platforms7d.unknown || 0} 人`);
  console.log();

  console.log('📱 30天活跃用户 - 按平台分布：');
  const platforms30d = summary30d.cards.notifyPlatformUsers || {};
  console.log(`  iOS:        ${platforms30d.ios || 0} 人`);
  console.log(`  Server酱³:  ${platforms30d.serverchan3 || 0} 人`);
  console.log(`  PC:         ${platforms30d.pc || 0} 人`);
  console.log(`  未知/历史:   ${platforms30d.unknown || 0} 人`);
  console.log();

  console.log('📈 活跃度分析：');
  const retention = summary7d.cards.notifyUsers > 0 && summary30d.cards.notifyUsers > 0
    ? ((summary7d.cards.notifyUsers / summary30d.cards.notifyUsers) * 100).toFixed(1)
    : '0';
  console.log(`  7天/30天留存率: ${retention}%`);
  console.log();

  console.log('✅ 建议：');
  console.log(`  - 当前会收到通知的活跃用户：约 ${summary7d.cards.notifyUsers} 人（7天内有活动）`);
  console.log(`  - 近期可能流失的用户：约 ${summary30d.cards.notifyUsers - summary7d.cards.notifyUsers} 人（30天内活跃但7天内未活跃）`);
  console.log();
  console.log('='.repeat(60));
}

analyzeActiveNotifyUsers();
