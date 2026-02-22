---
name: trimming
description: Remotion 的裁剪模式 - 剪切动画的开头或结尾
metadata:
  tags: sequence, trim, clip, cut, offset
---

使用带有负值 `from` 的 `<Sequence>` 来裁剪动画的开头。

## 裁剪开头

负值的 `from` 会将时间向后偏移，使动画从中间某个位置开始播放：

```tsx
import { Sequence, useVideoConfig } from "remotion";

const fps = useVideoConfig();  // 获取视频帧率

<Sequence from={-0.5 * fps}>   {/* 从负 0.5 秒开始，即裁剪掉前 15 帧 */}
  <MyAnimation />
</Sequence>
```

动画会从第 15 帧的位置开始显示 - 前 15 帧被裁剪掉了。
在 `<MyAnimation>` 内部，`useCurrentFrame()` 从 15 开始而不是 0。

## 裁剪结尾

使用 `durationInFrames` 在指定时长后卸载内容：

```tsx

<Sequence durationInFrames={1.5 * fps}>  {/* 动画播放 1.5 秒后卸载 */}
  <MyAnimation />
</Sequence>
```

动画播放 45 帧，然后组件被卸载。

## 裁剪并延迟

嵌套序列可以同时裁剪开头并延迟显示时间：

```tsx
<Sequence from={30}>          {/* 外层序列：延迟 30 帧显示 */}
  <Sequence from={-15}>       {/* 内层序列：裁剪前 15 帧 */}
    <MyAnimation />
  </Sequence>
</Sequence>
```

内层序列从开头裁剪 15 帧，外层序列将结果延迟 30 帧显示。
