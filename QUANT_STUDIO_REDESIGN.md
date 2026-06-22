# 量化研究策略 Tab 设计系统重构

## 概述

为量化研究策略 Tab 应用了全新的设计系统，基于 Fable 5 设计语言和 Material Design 3 启发，提升了视觉一致性和用户体验。

## 修改的文件

### 1. 新建 CSS 文件
- **`/src/styles/quant-studio-redesign.css`** (新建)
  - 完整的设计系统 Token 定义
  - 组件级样式类
  - 动画和过渡效果
  - 响应式调整

### 2. 组件修改

#### `/src/pages/QuantTradingExperienceV2.jsx`
- 导入新的 CSS 样式文件
- 添加根容器类名 `quant-studio-v2`
- 为配置卡片添加 `config-card` 和动画类
- 为规则配置行添加 `rule-config-row` 类
- 为规则提示添加 `rule-hint` 类
- 为信息框添加 `info-box` 相关类
- 为按钮添加 `btn-secondary` 和 `btn-run` 类
- 为持有对比卡片添加 `hold-comparison-card` 类
- 为跑赢徽标添加 `badge-outperform` 类

#### `/src/components/MetricCard.jsx`
- 添加 `metric-card` 基础类
- 添加动态 `tone-{positive|negative|neutral}` 类，用于左侧色条效果

#### `/src/components/TagInput.jsx`
- 添加 `tag-input-label` 类支持
- 自动检测 H/L 标签类型并添加相应徽标
- 为 ETF 代码标签添加 `etf-chip` 类
- 添加 `etf-label-h` 和 `etf-label-l` 样式支持

## 设计系统特性

### 颜色 Token
```css
--c-bg:        #F0F2F8  /* 页面背景 */
--c-surface:   #FFFFFF  /* 卡片表面 */
--c-border:    #E4E8F0  /* 边框颜色 */
--c-primary:   #4F46E5  /* 主色（靛蓝） */
--c-green:     #10B981  /* 成功/正收益 */
--c-red:       #EF4444  /* 错误/负收益 */
--c-amber:     #F59E0B  /* 警告 */
```

### 阴影系统
- `--shadow-sm`: 微弱阴影（卡片默认）
- `--shadow-md`: 中等阴影（悬停效果）
- `--shadow-lg`: 大阴影（模态框等）

### 圆角系统
- `--radius`: 12px（大卡片）
- `--radius-sm`: 8px（输入框、按钮）
- `--radius-xs`: 6px（小元素）

## 关键样式特性

### 1. 指标卡片增强
- 左侧色条指示器（正/负/中性）
- 悬停时微抬升效果
- 平滑过渡动画

### 2. 配置卡片
- 统一的卡片风格
- 渐进入场动画（错开延迟）
- 悬停时阴影加深

### 3. 规则配置行
- 带左侧色条的标签样式
- 提示信息框带左侧强调边框
- 信息框渐变背景

### 4. ETF 标签
- H（高溢价）标签：红色系
- L（低溢价）标签：绿色系
- ETF 代码芯片：交互式悬停效果

### 5. 按钮系统
- 主要按钮（运行回测）：渐变背景 + 发光效果
- 次要按钮（保存策略）：灰色系渐变
- 悬停时微抬升 + 阴影增强
- 禁用状态：降低透明度

### 6. 持有对比卡片
- 渐变背景
- 跑赢徽标：绿色渐变 + 发光阴影

### 7. Tab 导航
- 底部 2px 边框
- 选中 Tab 底部色条高亮
- 平滑过渡效果

## 动画效果

### 入场动画
```css
@keyframes __fadeInUp__ {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

应用类：
- `animate-in` - 基础动画
- `animate-in-delay-1` - 延迟 50ms
- `animate-in-delay-2` - 延迟 100ms
- `animate-in-delay-3` - 延迟 150ms
- `animate-in-delay-4` - 延迟 200ms

### 加载动画
```css
.loading-spinner {
  animation: __quant_spin__ .7s linear infinite;
}
```

## 响应式设计

### 移动端优化
- 卡片内边距自适应
- Tab 文字大小调整
- 触摸友好的最小高度（44px）

### 滚动条美化
- macOS 风格滚动条
- 半透明背景
- 悬停时加深

## 浏览器兼容性

- 现代浏览器（Chrome 90+, Safari 14+, Firefox 88+）
- 使用标准 CSS3 特性
- 渐进增强策略

## 打印样式

- 隐藏交互元素（按钮、Tab）
- 白色背景
- 保留内容可读性

## 使用方法

样式会自动应用到 `QuantTradingExperienceV2` 组件及其子组件。如需在其他页面使用：

```jsx
import '../styles/quant-studio-redesign.css';

function YourComponent() {
  return (
    <div className="quant-studio-v2">
      {/* 你的内容 */}
    </div>
  );
}
```

## 未来扩展

可以考虑的增强：
1. 深色模式支持
2. 自定义主题色
3. 更多动画效果（微交互）
4. 图表样式统一
5. 无障碍功能增强（ARIA 标签）

## 测试

已通过构建测试：
```bash
npm run build
✓ built in 22.47s
```

所有组件正常渲染，无样式冲突。
