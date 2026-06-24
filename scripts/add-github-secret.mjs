#!/usr/bin/env node
/**
 * 添加 GitHub Secret
 */

import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

const { decodeBase64, encodeBase64 } = util;

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const REPO = 'lovexlc/ai-dca';
const SECRET_NAME = 'VITE_POSTHOG_API_KEY';
const SECRET_VALUE = process.env.POSTHOG_API_KEY || 'your_posthog_api_key_here';

async function addGitHubSecret() {
  console.log('🔐 添加 GitHub Secret...\n');

  // 1. 获取公钥
  console.log('1️⃣ 获取仓库公钥...');
  const keyResponse = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/public-key`, {
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });

  if (!keyResponse.ok) {
    throw new Error(`获取公钥失败: ${keyResponse.status}`);
  }

  const { key_id, key } = await keyResponse.json();
  console.log(`   ✓ Key ID: ${key_id}\n`);

  // 2. 加密 Secret
  console.log('2️⃣ 加密 Secret 值...');
  const messageBytes = Buffer.from(SECRET_VALUE);
  const keyBytes = decodeBase64(key);
  const encryptedBytes = nacl.seal(messageBytes, keyBytes);
  const encrypted_value = encodeBase64(encryptedBytes);
  console.log(`   ✓ 加密完成\n`);

  // 3. 上传 Secret
  console.log(`3️⃣ 上传 Secret: ${SECRET_NAME}...`);
  const secretResponse = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/${SECRET_NAME}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      encrypted_value,
      key_id
    })
  });

  if (!secretResponse.ok) {
    const error = await secretResponse.text();
    throw new Error(`上传 Secret 失败: ${secretResponse.status}\n${error}`);
  }

  console.log(`   ✓ Secret 已添加\n`);
  console.log('✅ 完成！');
  console.log('\n下一步:');
  console.log('  1. 推送代码触发部署');
  console.log('  2. 查看 Actions: https://github.com/lovexlc/ai-dca/actions');
  console.log('  3. 部署完成后访问网站，PostHog 将自动工作');
}

addGitHubSecret().catch(err => {
  console.error('\n❌ 错误:', err.message);
  process.exit(1);
});
