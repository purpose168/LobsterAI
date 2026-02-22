---
name: animations
description: Remotion 基础动画技能
metadata:
  tags: animations, transitions, frames, useCurrentFrame
---

所有动画必须由 `useCurrentFrame()` 钩子驱动。
以秒为单位编写动画，并将其乘以从 `useVideoConfig()` 获取的 `fps` 值。

```tsx
import { useCurrentFrame } from "remotion";

export const FadeIn = () => {
  const frame = useCurrentFrame();  // 获取当前帧
  const { fps } = useVideoConfig(); // 获取帧率配置

  const opacity = interpolate(frame, [0, 2 * fps], [0, 1], {  // 在 2 秒内淡入
    extrapolateRight: 'clamp',  // 限制右侧外推
  });
 
  return (
    <div style={{ opacity }}>Hello World!</div>  // 应用透明度动画
  );
};
```

禁止使用 CSS transitions 或 animations - 它们无法正确渲染。
禁止使用 Tailwind 动画类名 - 它们无法正确渲染。  