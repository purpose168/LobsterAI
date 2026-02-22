---
name: parameters
description: 通过添加 Zod schema 使视频可参数化
metadata:
  tags: parameters, zod, schema
---

要使视频可参数化，可以向 composition（组合）添加一个 Zod schema（模式）。

首先，必须安装 `zod` - 版本必须精确为 `3.22.3`。

在项目中搜索 lockfiles（锁文件），并根据包管理器运行相应的命令：

如果找到 `package-lock.json`，使用以下命令：

```bash
npm i zod@3.22.3
```

如果找到 `bun.lockb`，使用以下命令：

```bash
bun i zod@3.22.3
```

如果找到 `yarn.lock`，使用以下命令：

```bash
yarn add zod@3.22.3
```

如果找到 `pnpm-lock.yaml`，使用以下命令：

```bash
pnpm i zod@3.22.3
```

然后，可以在组件旁边定义一个 Zod schema：

```tsx title="src/MyComposition.tsx"
import {z} from 'zod';

// 定义 composition 的 schema，包含一个 title 字段
export const MyCompositionSchema = z.object({
  title: z.string(),  // 标题字段，类型为字符串
});

// 组件使用 schema 推断的类型作为 props
const MyComponent: React.FC<z.infer<typeof MyCompositionSchema>> = () => {
  return (
    <div>
      <h1>{props.title}</h1>  {/* 显示标题 */}
    </div>
  );
};
```

在根文件中，可以将 schema 传递给 composition：

```tsx title="src/Root.tsx"
import {Composition} from 'remotion';
import {MycComponent, MyCompositionSchema} from './MyComposition';

export const RemotionRoot = () => {
  return (
    <Composition 
      id="MyComposition" 
      component={MyComponent} 
      durationInFrames={100}  // 持续帧数
      fps={30}                // 每秒帧数
      width={1080}            // 视频宽度
      height={1080}           // 视频高度
      defaultProps={{title: 'Hello World'}}  // 默认 props
      schema={MyCompositionSchema}  // 传入 schema
    />
  );
};
```

现在，用户可以在侧边栏中可视化地编辑参数。

Zod 支持的所有 schema 都被 Remotion 支持。

Remotion 要求顶层类型必须是 `z.object()`，因为 React 组件的 props 集合始终是一个对象。

## 颜色选择器

要添加颜色选择器，请使用 `@remotion/zod-types` 中的 `zColor()`。

如果尚未安装，使用以下命令：

```bash
npx remotion add @remotion/zod-types # 如果项目使用 npm
bunx remotion add @remotion/zod-types # 如果项目使用 bun
yarn remotion add @remotion/zod-types # 如果项目使用 yarn
pnpm exec remotion add @remotion/zod-types # 如果项目使用 pnpm
```

然后从 `@remotion/zod-types` 导入 `zColor`：

```tsx
import {zColor} from '@remotion/zod-types';
```

然后在 schema 中使用它：

```tsx
export const MyCompositionSchema = z.object({
  color: zColor(),  // 颜色字段，将显示为颜色选择器
});
```
