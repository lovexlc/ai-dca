/**
 * PostHog 集成模块
 *
 * 将现有埋点数据同步到 PostHog
 */

import posthog from 'posthog-js';

let initialized = false;

/**
 * 初始化 PostHog
 */
export function initPostHog() {
  if (typeof window === 'undefined') return;
  if (initialized) return;

  // 从环境变量或配置读取
  const apiKey = window.__POSTHOG_API_KEY__ || import.meta.env.VITE_POSTHOG_API_KEY || 'phc_placeholder';
  const host = window.__POSTHOG_HOST__ || import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com';

  // 如果是占位符，不初始化
  if (apiKey === 'phc_placeholder') {
    console.log('[PostHog] 未配置 API Key，跳过初始化');
    return;
  }

  try {
    posthog.init(apiKey, {
      api_host: host,
      // 配置选项
      autocapture: false, // 关闭自动捕获，使用我们的埋点
      capture_pageview: false, // 手动控制页面浏览
      capture_pageleave: true,
      session_recording: {
        enabled: false // 默认关闭会话录制
      },
      persistence: 'localStorage',
      disable_session_recording: true,
      // 性能优化
      loaded: (ph) => {
        console.log('[PostHog] 初始化成功');
        initialized = true;
      }
    });
  } catch (error) {
    console.error('[PostHog] 初始化失败:', error);
  }
}

/**
 * 识别用户
 */
export function identifyUser(userId, properties = {}) {
  if (!initialized || !posthog) return;

  posthog.identify(userId, properties);
}

/**
 * 追踪事件
 */
export function trackEvent(eventName, properties = {}) {
  if (!initialized || !posthog) return;

  posthog.capture(eventName, properties);
}

/**
 * 追踪页面浏览
 */
export function trackPageView(properties = {}) {
  if (!initialized || !posthog) return;

  posthog.capture('$pageview', properties);
}

/**
 * 设置用户属性
 */
export function setUserProperties(properties = {}) {
  if (!initialized || !posthog) return;

  posthog.setPersonProperties(properties);
}

/**
 * 重置用户（登出时）
 */
export function resetUser() {
  if (!initialized || !posthog) return;

  posthog.reset();
}

/**
 * 获取 PostHog 实例（用于高级功能）
 */
export function getPostHog() {
  return initialized ? posthog : null;
}
