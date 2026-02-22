---
name: extract-frames
description: 使用 Mediabunny 从视频的特定时间戳提取帧
metadata:
  tags: frames, extract, video, thumbnail, filmstrip, canvas
---

# 从视频中提取帧

使用 Mediabunny 从视频的特定时间戳提取帧。这对于生成缩略图、胶片条或处理单个帧非常有用。

## `extractFrames()` 函数

此函数可以复制粘贴到任何项目中。

```tsx
import {
  ALL_FORMATS,
  Input,
  UrlSource,
  VideoSample,
  VideoSampleSink,
} from "mediabunny";

type Options = {
  track: { width: number; height: number };  // 视频轨道的宽度和高度
  container: string;  // 容器格式名称
  durationInSeconds: number | null;  // 视频时长（秒）
};

export type ExtractFramesTimestampsInSecondsFn = (
  options: Options
) => Promise<number[]> | number[];

export type ExtractFramesProps = {
  src: string;  // 视频源 URL
  timestampsInSeconds: number[] | ExtractFramesTimestampsInSecondsFn;  // 时间戳数组或生成时间戳的函数
  onVideoSample: (sample: VideoSample) => void;  // 处理每个视频帧的回调函数
  signal?: AbortSignal;  // 可选的中止信号，用于取消操作
};

export async function extractFrames({
  src,
  timestampsInSeconds,
  onVideoSample,
  signal,
}: ExtractFramesProps): Promise<void> {
  // 创建输入实例，支持所有格式
  using input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(src),
  });

  // 并行获取视频时长、格式和主视频轨道
  const [durationInSeconds, format, videoTrack] = await Promise.all([
    input.computeDuration(),
    input.getFormat(),
    input.getPrimaryVideoTrack(),
  ]);

  // 检查是否存在视频轨道
  if (!videoTrack) {
    throw new Error("输入中未找到视频轨道");
  }

  // 检查是否已中止
  if (signal?.aborted) {
    throw new Error("已中止");
  }

  // 如果 timestampsInSeconds 是函数，则调用它来计算时间戳
  const timestamps =
    typeof timestampsInSeconds === "function"
      ? await timestampsInSeconds({
          track: {
            width: videoTrack.displayWidth,
            height: videoTrack.displayHeight,
          },
          container: format.name,
          durationInSeconds,
        })
      : timestampsInSeconds;

  // 如果没有时间戳，直接返回
  if (timestamps.length === 0) {
    return;
  }

  // 再次检查是否已中止
  if (signal?.aborted) {
    throw new Error("已中止");
  }

  // 创建视频样本接收器
  const sink = new VideoSampleSink(videoTrack);

  // 遍历指定时间戳的视频样本
  for await (using videoSample of sink.samplesAtTimestamps(timestamps)) {
    // 如果已中止，退出循环
    if (signal?.aborted) {
      break;
    }

    // 跳过空样本
    if (!videoSample) {
      continue;
    }

    // 调用回调函数处理视频样本
    onVideoSample(videoSample);
  }
}
```

## 基本用法

在特定时间戳提取帧：

```tsx
await extractFrames({
  src: "https://remotion.media/video.mp4",
  timestampsInSeconds: [0, 1, 2, 3, 4],  // 在第 0、1、2、3、4 秒提取帧
  onVideoSample: (sample) => {
    // 创建画布元素
    const canvas = document.createElement("canvas");
    canvas.width = sample.displayWidth;
    canvas.height = sample.displayHeight;
    const ctx = canvas.getContext("2d");
    // 将帧绘制到画布上
    sample.draw(ctx!, 0, 0);
  },
});
```

## 创建胶片条

使用回调函数根据视频元数据动态计算时间戳：

```tsx
const canvasWidth = 500;  // 画布宽度
const canvasHeight = 80;  // 画布高度
const fromSeconds = 0;  // 起始时间（秒）
const toSeconds = 10;  // 结束时间（秒）

await extractFrames({
  src: "https://remotion.media/video.mp4",
  timestampsInSeconds: async ({ track, durationInSeconds }) => {
    // 计算视频宽高比
    const aspectRatio = track.width / track.height;
    // 计算能容纳的帧数
    const amountOfFramesFit = Math.ceil(
      canvasWidth / (canvasHeight * aspectRatio)
    );
    // 计算时间段的持续时间
    const segmentDuration = toSeconds - fromSeconds;
    const timestamps: number[] = [];

    // 生成均匀分布的时间戳
    for (let i = 0; i < amountOfFramesFit; i++) {
      timestamps.push(
        fromSeconds + (segmentDuration / amountOfFramesFit) * (i + 0.5)
      );
    }

    return timestamps;
  },
  onVideoSample: (sample) => {
    console.log(`帧时间戳: ${sample.timestamp}s`);

    // 创建画布元素
    const canvas = document.createElement("canvas");
    canvas.width = sample.displayWidth;
    canvas.height = sample.displayHeight;
    const ctx = canvas.getContext("2d");
    // 将帧绘制到画布上
    sample.draw(ctx!, 0, 0);
  },
});
```

## 使用 AbortSignal 取消操作

在超时后取消帧提取：

```tsx
const controller = new AbortController();

// 5 秒后中止操作
setTimeout(() => controller.abort(), 5000);

try {
  await extractFrames({
    src: "https://remotion.media/video.mp4",
    timestampsInSeconds: [0, 1, 2, 3, 4],
    onVideoSample: (sample) => {
      using frame = sample;
      // 创建画布元素
      const canvas = document.createElement("canvas");
      canvas.width = frame.displayWidth;
      canvas.height = frame.displayHeight;
      const ctx = canvas.getContext("2d");
      // 将帧绘制到画布上
      frame.draw(ctx!, 0, 0);
    },
    signal: controller.signal,
  });

  console.log("帧提取完成！");
} catch (error) {
  console.error("帧提取已中止或失败:", error);
}
```

## 使用 Promise.race 实现超时

```tsx
const controller = new AbortController();

// 创建超时 Promise
const timeoutPromise = new Promise<never>((_, reject) => {
  const timeoutId = setTimeout(() => {
    controller.abort();  // 中止操作
    reject(new Error("帧提取在 10 秒后超时"));
  }, 10000);

  // 如果操作提前完成，清除超时定时器
  controller.signal.addEventListener("abort", () => clearTimeout(timeoutId), {
    once: true,
  });
});

try {
  await Promise.race([
    extractFrames({
      src: "https://remotion.media/video.mp4",
      timestampsInSeconds: [0, 1, 2, 3, 4],
      onVideoSample: (sample) => {
        using frame = sample;
        // 创建画布元素
        const canvas = document.createElement("canvas");
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
        const ctx = canvas.getContext("2d");
        // 将帧绘制到画布上
        frame.draw(ctx!, 0, 0);
      },
      signal: controller.signal,
    }),
    timeoutPromise,
  ]);

  console.log("帧提取完成！");
} catch (error) {
  console.error("帧提取已中止或失败:", error);
}
```
