---
name: transitions
description: 使用 TransitionSeries 为 Remotion 实现场景转场和叠加层效果。
metadata:
  tags: transitions, overlays, fade, slide, wipe, scenes
---

## TransitionSeries

`<TransitionSeries>` 用于排列场景，并支持两种方式来增强场景之间的切换点：

- **转场** (`<TransitionSeries.Transition>`) — 在两个场景之间实现淡入淡出、滑动、擦除等效果。由于两个场景在转场期间同时播放，因此会缩短时间轴。
- **叠加层** (`<TransitionSeries.Overlay>`) — 在切换点上渲染特效（例如光晕泄漏），不会缩短时间轴。

子元素采用绝对定位。

## 前置要求

```bash
npx remotion add @remotion/transitions
```

## 转场示例

```tsx
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneA />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition
    presentation={fade()}
    timing={linearTiming({ durationInFrames: 15 })}
  />
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneB />
  </TransitionSeries.Sequence>
</TransitionSeries>;
```

## 叠加层示例

任何 React 组件都可以用作叠加层。如需现成的特效，请参阅 **light-leaks** 规则。

```tsx
import { TransitionSeries } from "@remotion/transitions";
import { LightLeak } from "@remotion/light-leaks";

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneA />
  </TransitionSeries.Sequence>
  <TransitionSeries.Overlay durationInFrames={20}>
    <LightLeak />
  </TransitionSeries.Overlay>
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneB />
  </TransitionSeries.Sequence>
</TransitionSeries>;
```

## 混合使用转场和叠加层

转场和叠加层可以在同一个 `<TransitionSeries>` 中共存，但叠加层不能与转场或其他叠加层相邻。

```tsx
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { LightLeak } from "@remotion/light-leaks";

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneA />
  </TransitionSeries.Sequence>
  <TransitionSeries.Overlay durationInFrames={30}>
    <LightLeak />
  </TransitionSeries.Overlay>
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneB />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition
    presentation={fade()}
    timing={linearTiming({ durationInFrames: 15 })}
  />
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneC />
  </TransitionSeries.Sequence>
</TransitionSeries>;
```

## 转场属性

`<TransitionSeries.Transition>` 需要以下属性：

- `presentation` — 视觉效果（例如 `fade()`、`slide()`、`wipe()`）。
- `timing` — 控制速度和缓动效果（例如 `linearTiming()`、`springTiming()`）。

## 叠加层属性

`<TransitionSeries.Overlay>` 接受以下属性：

- `durationInFrames` — 叠加层可见的时长（正整数）。
- `offset?` — 相对于切换点中心偏移叠加层。正值表示延后，负值表示提前。默认值：`0`。

## 可用的转场类型

从各自的模块中导入转场效果：

```tsx
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { flip } from "@remotion/transitions/flip";
import { clockWipe } from "@remotion/transitions/clock-wipe";
```

## 带方向的滑动转场

```tsx
import { slide } from "@remotion/transitions/slide";

<TransitionSeries.Transition
  presentation={slide({ direction: "from-left" })}
  timing={linearTiming({ durationInFrames: 20 })}
/>;
```

方向选项：`"from-left"`、`"from-right"`、`"from-top"`、`"from-bottom"`

## 时间控制选项

```tsx
import { linearTiming, springTiming } from "@remotion/transitions";

// 线性时间控制 - 恒定速度
linearTiming({ durationInFrames: 20 });

// 弹性时间控制 - 自然运动效果
springTiming({ config: { damping: 200 }, durationInFrames: 25 });
```

## 时长计算

转场会与相邻场景重叠，因此总合成长度比所有序列时长之和**更短**。叠加层**不会**影响总时长。

例如，有两个 60 帧的序列和一个 15 帧的转场：

- 无转场时：`60 + 60 = 120` 帧
- 有转场时：`60 + 60 - 15 = 105` 帧

在其他两个序列之间添加叠加层不会改变总时长。

### 获取转场时长

使用时间控制对象的 `getDurationInFrames()` 方法：

```tsx
import { linearTiming, springTiming } from "@remotion/transitions";

const linearDuration = linearTiming({
  durationInFrames: 20,
}).getDurationInFrames({ fps: 30 });
// 返回 20

const springDuration = springTiming({
  config: { damping: 200 },
}).getDurationInFrames({ fps: 30 });
// 返回基于弹性物理计算得出的时长
```

对于没有显式指定 `durationInFrames` 的 `springTiming`，其时长取决于 `fps`，因为它需要计算弹性动画何时稳定下来。

### 计算总合成时长

```tsx
import { linearTiming } from "@remotion/transitions";

const scene1Duration = 60;  // 场景1时长
const scene2Duration = 60;  // 场景2时长
const scene3Duration = 60;  // 场景3时长

const timing1 = linearTiming({ durationInFrames: 15 });
const timing2 = linearTiming({ durationInFrames: 20 });

const transition1Duration = timing1.getDurationInFrames({ fps: 30 });  // 转场1时长
const transition2Duration = timing2.getDurationInFrames({ fps: 30 });  // 转场2时长

const totalDuration =
  scene1Duration +
  scene2Duration +
  scene3Duration -
  transition1Duration -
  transition2Duration;
// 60 + 60 + 60 - 15 - 20 = 145 帧
```
