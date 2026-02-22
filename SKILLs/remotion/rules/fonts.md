---
name: fonts
description: 在 Remotion 中加载 Google 字体和本地字体
metadata:
  tags: fonts, google-fonts, typography, text
---

# 在 Remotion 中使用字体

## 使用 @remotion/google-fonts 加载 Google 字体

这是使用 Google 字体的推荐方式。它具有类型安全性，并且会自动阻塞渲染直到字体准备就绪。

### 前提条件

首先，需要安装 @remotion/google-fonts 包。
如果尚未安装，请使用以下命令：

```bash
npx remotion add @remotion/google-fonts # 如果项目使用 npm
bunx remotion add @remotion/google-fonts # 如果项目使用 bun
yarn remotion add @remotion/google-fonts # 如果项目使用 yarn
pnpm exec remotion add @remotion/google-fonts # 如果项目使用 pnpm
```

```tsx
import { loadFont } from "@remotion/google-fonts/Lobster";

const { fontFamily } = loadFont(); // 加载字体并获取字体族名称

export const MyComposition = () => {
  return <div style={{ fontFamily }}>Hello World</div>; // 应用字体样式
};
```

建议仅指定所需的字重和子集以减小文件大小：

```tsx
import { loadFont } from "@remotion/google-fonts/Roboto";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700"], // 指定需要的字重
  subsets: ["latin"],      // 指定需要的子集
});
```

### 等待字体加载

如果需要知道字体何时准备就绪，请使用 `waitUntilDone()`：

```tsx
import { loadFont } from "@remotion/google-fonts/Lobster";

const { fontFamily, waitUntilDone } = loadFont(); // 解构获取 waitUntilDone 方法

await waitUntilDone(); // 等待字体加载完成
```

## 使用 @remotion/fonts 加载本地字体

对于本地字体文件，请使用 `@remotion/fonts` 包。

### 前提条件

首先，安装 @remotion/fonts：

```bash
npx remotion add @remotion/fonts # 如果项目使用 npm
bunx remotion add @remotion/fonts # 如果项目使用 bun
yarn remotion add @remotion/fonts # 如果项目使用 yarn
pnpm exec remotion add @remotion/fonts # 如果项目使用 pnpm
```

### 加载本地字体

将字体文件放在 `public/` 文件夹中，然后使用 `loadFont()`：

```tsx
import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

await loadFont({
  family: "MyFont",                          // 字体族名称
  url: staticFile("MyFont-Regular.woff2"),    // 字体文件路径
});

export const MyComposition = () => {
  return <div style={{ fontFamily: "MyFont" }}>Hello World</div>; // 应用字体
};
```

### 加载多个字重

使用相同的字体族名称分别加载每个字重：

```tsx
import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

await Promise.all([
  loadFont({
    family: "Inter",                         // 字体族名称
    url: staticFile("Inter-Regular.woff2"),   // 常规字重文件
    weight: "400",                           // 字重值
  }),
  loadFont({
    family: "Inter",                         // 相同的字体族名称
    url: staticFile("Inter-Bold.woff2"),      // 粗体字重文件
    weight: "700",                           // 字重值
  }),
]);
```

### 可用选项

```tsx
loadFont({
  family: "MyFont",                    // 必填：在 CSS 中使用的名称
  url: staticFile("font.woff2"),       // 必填：字体文件 URL
  format: "woff2",                     // 可选：根据扩展名自动检测
  weight: "400",                       // 可选：字体粗细
  style: "normal",                     // 可选：normal 或 italic
  display: "block",                    // 可选：字体显示行为
});
```

## 在组件中使用

在组件的顶层调用 `loadFont()`，或者在早期导入的单独文件中调用：

```tsx
import { loadFont } from "@remotion/google-fonts/Montserrat";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700"], // 指定字重
  subsets: ["latin"],      // 指定子集
});

export const Title: React.FC<{ text: string }> = ({ text }) => {
  return (
    <h1
      style={{
        fontFamily,          // 应用字体族
        fontSize: 80,        // 设置字体大小
        fontWeight: "bold",  // 设置字体粗细
      }}
    >
      {text}
    </h1>
  );
};
```
