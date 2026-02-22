---
name: charts
description: Remotion 的图表和数据可视化模式。用于创建条形图、饼图、直方图、进度条或任何数据驱动的动画。
metadata:
  tags: charts, data, visualization, bar-chart, pie-chart, graphs
---

# Remotion 中的图表

您可以在 Remotion 中使用常规 React 代码创建条形图 - 允许使用 HTML 和 SVG，也可以使用 D3.js。

## 不使用非 `useCurrentFrame()` 驱动的动画

禁用所有第三方库的动画。
它们会在渲染过程中导致闪烁。
相反，应使用 `useCurrentFrame()` 驱动所有动画。

## 条形图动画

有关基本示例实现，请参阅 [条形图示例](assets/charts/bar-chart.tsx)。

### 交错条形

您可以像这样为条形的高度添加动画并使它们交错显示：

```tsx
const STAGGER_DELAY = 5;                          // 交错延迟帧数
const frame = useCurrentFrame();                  // 获取当前帧
const {fps} = useVideoConfig();                   // 获取视频配置中的帧率

const bars = data.map((item, i) => {
  const delay = i * STAGGER_DELAY;                // 每个条形的延迟时间
  const height = spring({                         // 使用弹簧动画计算高度
    frame,
    fps,
    delay,
    config: {damping: 200},                       // 阻尼配置
  });
  return <div style={{height: height * item.value}} />;
});
```

## 饼图动画

使用 stroke-dashoffset 为扇形片段添加动画，从 12 点钟位置开始。

```tsx
const frame = useCurrentFrame();                  // 获取当前帧
const {fps} = useVideoConfig();                   // 获取视频配置中的帧率

const progress = interpolate(frame, [0, 100], [0, 1]);  // 插值计算进度

const circumference = 2 * Math.PI * radius;       // 计算周长
const segmentLength = (value / total) * circumference; // 计算扇形片段长度
const offset = interpolate(progress, [0, 1], [segmentLength, 0]); // 计算偏移量

<circle r={radius} cx={center} cy={center} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={`${segmentLength} ${circumference}`} strokeDashoffset={offset} transform={`rotate(-90 ${center} ${center})`} />;
```
