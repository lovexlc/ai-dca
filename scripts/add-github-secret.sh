#!/bin/bash
# 使用 GitHub CLI 添加 PostHog Secret
# 使用方式: POSTHOG_API_KEY=phc_xxx GH_TOKEN=ghp_xxx ./scripts/add-github-secret.sh

if [ -z "$GH_TOKEN" ] && [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ 错误: 需要设置 GH_TOKEN 或 GITHUB_TOKEN 环境变量"
    exit 1
fi

if [ -z "$POSTHOG_API_KEY" ]; then
    echo "❌ 错误: 需要设置 POSTHOG_API_KEY 环境变量"
    echo ""
    echo "使用方式:"
    echo "  POSTHOG_API_KEY=phc_xxx ./scripts/add-github-secret.sh"
    exit 1
fi

echo "🔐 添加 GitHub Secret..."
echo ""
echo "Secret: VITE_POSTHOG_API_KEY"
echo "Repo:   lovexlc/ai-dca"
echo ""

# 使用 gh CLI 添加 Secret
echo "$POSTHOG_API_KEY" | gh secret set VITE_POSTHOG_API_KEY --repo lovexlc/ai-dca

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Secret 已成功添加！"
    echo ""
    echo "下一步:"
    echo "  1. 推送代码触发部署"
    echo "  2. 查看 Actions: https://github.com/lovexlc/ai-dca/actions"
    echo "  3. 部署完成后，PostHog 将自动工作"
else
    echo ""
    echo "❌ 添加失败"
    exit 1
fi
