---
name: timing
description: Remotion 中的插值曲线 - 线性、缓动、弹簧动画
metadata:
  tags: spring, bounce, easing, interpolation
---

使用 `interpolate` 函数可以实现简单的线性插值。

```ts title="在 100 帧内从 0 到 1"
import {interpolate} from 'remotion';

const opacity = interpolate(frame, [0, 100], [0, 1]);
```

默认情况下，数值不会被限制，因此值可能会超出 [0, 1] 范围。
以下是如何限制数值的方法：

```ts title="在 100 帧内从 0 到 1 并限制外推"
const opacity = interpolate(frame, [0, 100], [0, 1], {
  extrapolateRight: 'clamp',
  extrapolateLeft: 'clamp',
});
```

## 弹簧动画

弹簧动画具有更自然的运动效果。
它们会随时间从 0 过渡到 1。

```ts title="在 100 帧内从 0 到 1 的弹簧动画"
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';

const frame = useCurrentFrame();
const {fps} = useVideoConfig();

const scale = spring({
  frame,
  fps,
});
```

### 物理属性

默认配置为：`mass: 1, damping: 10, stiffness: 100`。
这会使动画在稳定之前产生一些弹跳效果。

配置可以像这样覆盖：

```ts
const scale = spring({
  frame,
  fps,
  config: {damping: 200},
});
```

对于没有弹跳的自然运动，推荐配置为：`{ damping: 200 }`。

以下是一些常用配置：

```tsx
const smooth = {damping: 200}; // 平滑，无弹跳（适合微妙的显示效果）
const snappy = {damping: 20, stiffness: 200}; // 干脆，最小弹跳（适合 UI 元素）
const bouncy = {damping: 8}; // 弹跳入场（适合趣味动画）
const heavy = {damping: 15, stiffness: 80, mass: 2}; // 沉重，缓慢，小幅弹跳
```

### 延迟

动画默认立即开始。
使用 `delay` 参数可以将动画延迟指定的帧数。

```tsx
const entrance = spring({
  frame: frame - ENTRANCE_DELAY,
  fps,
  delay: 20,
});
```

### 持续时间

`spring()` 具有基于物理属性的自然持续时间。
要将动画拉伸到特定持续时间，请使用 `durationInFrames` 参数。

```tsx
const spring = spring({
  frame,
  fps,
  durationInFrames: 40,
});
```

### 结合 spring() 与 interpolate()

将弹簧输出值（0-1）映射到自定义范围：

```tsx
const springProgress = spring({
  frame,
  fps,
});

// 映射到旋转角度
const rotation = interpolate(springProgress, [0, 1], [0, 360]);

<div style={{rotate: rotation + 'deg'}} />;
```

### 叠加弹簧

弹簧只返回数值，因此可以进行数学运算：

```tsx
const frame = useCurrentFrame();
const {fps, durationInFrames} = useVideoConfig();

const inAnimation = spring({
  frame,
  fps,
});
const outAnimation = spring({
  frame,
  fps,
  durationInFrames: 1 * fps,
  delay: durationInFrames - 1 * fps,
});

const scale = inAnimation - outAnimation;
```

## 缓动

可以将缓动效果添加到 `interpolate` 函数中：

```ts
import {interpolate, Easing} from 'remotion';

const value1 = interpolate(frame, [0, 100], [0, 1], {
  easing: Easing.inOut(Easing.quad),
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});
```

默认缓动为 `Easing.linear`。
还有多种其他缓动方向：

- `Easing.in` 用于开始慢然后加速
- `Easing.out` 用于开始快然后减速
- `Easing.inOut`

以及曲线（按从最线性到最弯曲排序）：

- `Easing.quad`
- `Easing.sin`
- `Easing.exp`
- `Easing.circle`

缓动方向和曲线需要组合使用以形成缓动函数：

```ts
const value1 = interpolate(frame, [0, 100], [0, 1], {
  easing: Easing.inOut(Easing.quad),
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});
```

也支持三次贝塞尔曲线：

```ts
const value1 = interpolate(frame, [0, 100], [0, 1], {
  easing: Easing.bezier(0.8, 0.22, 0.96, 0.65),
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});
```
