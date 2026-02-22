---
name: calculate-metadata
description: 动态设置组合的时长、尺寸和属性
metadata:
  tags: calculateMetadata, duration, dimensions, props, dynamic
---

# 使用 calculateMetadata

在 `<Composition>` 上使用 `calculateMetadata` 可以在渲染前动态设置时长、尺寸并转换属性。

```tsx
<Composition id="MyComp" component={MyComponent} durationInFrames={300} fps={30} width={1920} height={1080} defaultProps={{videoSrc: 'https://remotion.media/video.mp4'}} calculateMetadata={calculateMetadata} />
```

## 根据视频设置时长

使用 mediabunny/metadata 技能中的 `getMediaMetadata()` 函数获取视频时长：

```tsx
import {CalculateMetadataFunction} from 'remotion';
import {getMediaMetadata} from '../get-media-metadata';

const calculateMetadata: CalculateMetadataFunction<Props> = async ({props}) => {
  const {durationInSeconds} = await getMediaMetadata(props.videoSrc);

  return {
    durationInFrames: Math.ceil(durationInSeconds * 30), // 将秒转换为帧数
  };
};
```

## 匹配视频尺寸

```tsx
const calculateMetadata: CalculateMetadataFunction<Props> = async ({props}) => {
  const {durationInSeconds, dimensions} = await getMediaMetadata(props.videoSrc);

  return {
    durationInFrames: Math.ceil(durationInSeconds * 30), // 将秒转换为帧数
    width: dimensions?.width ?? 1920,                    // 使用视频宽度或默认值
    height: dimensions?.height ?? 1080,                  // 使用视频高度或默认值
  };
};
```

## 根据多个视频设置时长

```tsx
const calculateMetadata: CalculateMetadataFunction<Props> = async ({props}) => {
  const metadataPromises = props.videos.map((video) => getMediaMetadata(video.src)); // 获取所有视频的元数据
  const allMetadata = await Promise.all(metadataPromises);

  const totalDuration = allMetadata.reduce((sum, meta) => sum + meta.durationInSeconds, 0); // 计算总时长

  return {
    durationInFrames: Math.ceil(totalDuration * 30), // 将总秒数转换为帧数
  };
};
```

## 设置默认输出文件名

根据属性设置默认输出文件名：

```tsx
const calculateMetadata: CalculateMetadataFunction<Props> = async ({props}) => {
  return {
    defaultOutName: `video-${props.id}.mp4`, // 根据属性 ID 生成文件名
  };
};
```

## 转换属性

在渲染前获取数据或转换属性：

```tsx
const calculateMetadata: CalculateMetadataFunction<Props> = async ({props, abortSignal}) => {
  const response = await fetch(props.dataUrl, {signal: abortSignal}); // 使用中止信号获取数据
  const data = await response.json();

  return {
    props: {
      ...props,
      fetchedData: data, // 将获取的数据添加到属性中
    },
  };
};
```

当属性在 Studio 中发生变化时，`abortSignal` 会取消过时的请求。

## 返回值

所有字段均为可选。返回的值会覆盖 `<Composition>` 的属性：

- `durationInFrames`: 帧数
- `width`: 组合宽度（像素）
- `height`: 组合高度（像素）
- `fps`: 每秒帧数
- `props`: 传递给组件的转换后的属性
- `defaultOutName`: 默认输出文件名
- `defaultCodec`: 渲染的默认编解码器
