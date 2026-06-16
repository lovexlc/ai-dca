#!/usr/bin/env node

// K线批量保存功能测试脚本

const API_BASE = process.env.API_BASE || 'http://localhost:8787/api/markets';

async function testKlineBatchSave(market) {
  console.log(`\n🧪 测试 ${market.toUpperCase()} 市场 K线批量保存...\n`);

  try {
    const response = await fetch(`${API_BASE}/kline-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market })
    });

    const data = await response.json();

    if (data.ok) {
      console.log('✅ 任务已启动:');
      console.log(`   市场: ${data.market}`);
      console.log(`   时间: ${data.timestamp}`);
      console.log(`   消息: ${data.message}`);
    } else {
      console.error('❌ 请求失败:', data);
    }

    return data;
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    throw error;
  }
}

async function testKlineAPI(symbol, interval = '1d') {
  console.log(`\n🔍 测试获取 K线数据: ${symbol} (${interval})\n`);

  try {
    const response = await fetch(`${API_BASE}/kline/${symbol}?tf=${interval}`);
    const data = await response.json();

    if (data.candles && data.candles.length > 0) {
      console.log('✅ K线数据获取成功:');
      console.log(`   代码: ${data.symbol}`);
      console.log(`   周期: ${data.interval}`);
      console.log(`   数据点: ${data.candles.length}`);
      console.log(`   来源: ${data.source}`);
      console.log(`   更新时间: ${data.generatedAt}`);
      console.log(`   缓存状态: ${data.cached ? '缓存' : '实时'}`);

      // 显示最近几条数据
      const recent = data.candles.slice(-3);
      console.log('\n   最近3条数据:');
      recent.forEach(c => {
        console.log(`   - ${c.date}: 开${c.open} 高${c.high} 低${c.low} 收${c.close} 量${c.volume}`);
      });
    } else {
      console.warn('⚠️  未获取到数据');
    }

    return data;
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    throw error;
  }
}

async function testHealthCheck() {
  console.log('\n🏥 健康检查...\n');

  try {
    const response = await fetch(`${API_BASE}/health`);
    const data = await response.json();

    console.log('✅ Worker 状态:');
    console.log(`   名称: ${data.name}`);
    console.log(`   时间: ${data.time}`);
    console.log(`   KV: ${data.hasKv ? '✅' : '❌'}`);
    console.log(`   R2: ${data.hasR2 ? '✅' : '❌'}`);
    console.log(`   AI: ${data.hasAi ? '✅' : '❌'}`);

    return data;
  } catch (error) {
    console.error('❌ 健康检查失败:', error.message);
    throw error;
  }
}

async function runAllTests() {
  console.log('═══════════════════════════════════════════');
  console.log('  K线批量保存功能测试套件');
  console.log('═══════════════════════════════════════════');

  try {
    // 1. 健康检查
    await testHealthCheck();

    // 2. 测试获取现有K线数据
    await testKlineAPI('AAPL', '1d');
    await testKlineAPI('159513', '1d');

    // 3. 测试批量保存触发（可选，会实际执行保存）
    const shouldTriggerSave = process.argv.includes('--trigger');
    if (shouldTriggerSave) {
      console.log('\n⚠️  即将触发批量保存任务...');
      await testKlineBatchSave('us');
      await new Promise(resolve => setTimeout(resolve, 2000));
      await testKlineBatchSave('cn');
    } else {
      console.log('\n💡 提示: 使用 --trigger 参数可触发实际的批量保存任务');
    }

    console.log('\n═══════════════════════════════════════════');
    console.log('  ✅ 所有测试完成！');
    console.log('═══════════════════════════════════════════\n');

  } catch (error) {
    console.log('\n═══════════════════════════════════════════');
    console.log('  ❌ 测试失败');
    console.log('═══════════════════════════════════════════\n');
    process.exit(1);
  }
}

// 运行测试
runAllTests();
