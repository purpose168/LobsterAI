---
name: compositions
description: 定义组合、静态图像、文件夹、默认属性和动态元数据
metadata:
  tags: composition, still, folder, props, metadata
---

`<Composition>` 定义了可渲染视频的组件、宽度、高度、帧率和时长。

它通常放置在 `src/Root.tsx` 文件中。

```tsx
import {Composition} from 'remotion';
import {MyComposition} from './MyComposition';

export const RemotionRoot = () => {
  return <Composition id="MyComposition" component={MyComposition} durationInFrames={100} fps={30} width={1080} height={1080} />;
};
```

## 默认属性

传递 `defaultProps` 为组件提供初始值。
值必须是可 JSON 序列化的（支持 `Date`、`Map`、`Set` 和 `staticFile()`）。

```tsx
import {Composition} from 'remotion';
import {MyComposition, MyCompositionProps} from './MyComposition';

export const RemotionRoot = () => {
  return (
    <Composition
      id="MyComposition"
      component={MyComposition}
      durationInFrames={100}
      fps={30}
      width={1080}
      height={1080}
      defaultProps={
        {
          title: 'Hello World',
          color: '#ff0000',
        } satisfies MyCompositionProps
      }
    />
  );
};
```

使用 `type` 声明属性而不是 `interface`，以确保 `defaultProps` 的类型安全。

## 文件夹

使用 `<Folder>` 在侧边栏中组织组合。
文件夹名称只能包含字母、数字和连字符。

```tsx
import {Composition, Folder} from 'remotion';

export const RemotionRoot = () => {
  return (
    <>
      <Folder name="Marketing">
        <Composition id="Promo" /* ... */ />
        <Composition id="Ad" /* ... */ />
      </Folder>
      <Folder name="Social">
        <Folder name="Instagram">
          <Composition id="Story" /* ... */ />
          <Composition id="Reel" /* ... */ />
        </Folder>
      </Folder>
    </>
  );
};
```

## 静态图像

使用 `<Still>` 创建单帧图像。它不需要 `durationInFrames` 或 `fps`。

```tsx
import {Still} from 'remotion';
import {Thumbnail} from './Thumbnail';

export const RemotionRoot = () => {
  return <Still id="Thumbnail" component={Thumbnail} width={1280} height={720} />;
};
```

## 计算元数据

使用 `calculateMetadata` 根据数据动态设置尺寸、时长或属性。

```tsx
import {Composition, CalculateMetadataFunction} from 'remotion';
import {MyComposition, MyCompositionProps} from './MyComposition';

const calculateMetadata: CalculateMetadataFunction<MyCompositionProps> = async ({props, abortSignal}) => {
  const data = await fetch(`https://api.example.com/video/${props.videoId}`, {
    signal: abortSignal,
  }).then((res) => res.json());

  return {
    durationInFrames: Math.ceil(data.duration * 30),
    props: {
      ...props,
      videoUrl: data.url,
    },
  };
};

export const RemotionRoot = () => {
  return (
    <Composition
      id="MyComposition"
      component={MyComposition}
      durationInFrames={100} // 占位符，将被覆盖
      fps={30}
      width={1080}
      height={1080}
      defaultProps={{videoId: 'abc123'}}
      calculateMetadata={calculateMetadata}
    />
  );
};
```

该函数可以返回 `props`、`durationInFrames`、`width`、`height`、`fps` 以及编解码器相关的默认值。它在渲染开始前运行一次。

## 在另一个组合中嵌套组合

要在另一个组合中添加组合，可以使用带有 `width` 和 `height` 属性的 `<Sequence>` 组件来指定组合的尺寸。

```tsx
<AbsoluteFill>
  <Sequence width={COMPOSITION_WIDTH} height={COMPOSITION_HEIGHT}>
    <CompositionComponent />
  </Sequence>
</AbsoluteFill>
```
