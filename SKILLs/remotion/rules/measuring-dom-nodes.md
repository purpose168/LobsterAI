---
name: measuring-dom-nodes
description: 在 Remotion 中测量 DOM 元素尺寸
metadata:
  tags: measure, layout, dimensions, getBoundingClientRect, scale
---

# 在 Remotion 中测量 DOM 节点

Remotion 会对视频容器应用 `scale()` 变换，这会影响 `getBoundingClientRect()` 返回的值。使用 `useCurrentScale()` 可以获取正确的测量结果。

## 测量元素尺寸

```tsx
import { useCurrentScale } from "remotion";
import { useRef, useEffect, useState } from "react";

export const MyComponent = () => {
  const ref = useRef<HTMLDivElement>(null);  // 创建一个 ref 引用来访问 DOM 元素
  const scale = useCurrentScale();            // 获取当前的缩放比例
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });  // 存储元素的宽高尺寸

  useEffect(() => {
    if (!ref.current) return;                // 如果 ref 未挂载，则直接返回
    const rect = ref.current.getBoundingClientRect();  // 获取元素的边界矩形
    setDimensions({
      width: rect.width / scale,             // 除以缩放比例得到实际宽度
      height: rect.height / scale,           // 除以缩放比例得到实际高度
    });
  }, [scale]);                               // 当缩放比例变化时重新计算

  return <div ref={ref}>Content to measure</div>;  // 要测量内容的容器
};
```

