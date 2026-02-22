---
name: tailwind
description: 在 Remotion 中使用 TailwindCSS。
metadata:
---

如果项目中已安装 TailwindCSS，您可以并且应该在 Remotion 中使用它。

不要使用 `transition-*` 或 `animate-*` 类 - 始终使用 `useCurrentFrame()` 钩子来实现动画。

在 Remotion 项目中必须先安装并启用 Tailwind - 使用 WebFetch 获取 https://www.remotion.dev/docs/tailwind 以查看说明。