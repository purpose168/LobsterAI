---
name: maps
description: 使用 Mapbox 制作地图动画
metadata:
  tags: map, map animation, mapbox
---

可以通过 Mapbox 将地图添加到 Remotion 视频中。
[Mapbox 文档](https://docs.mapbox.com/mapbox-gl-js/api/)提供了 API 参考。

## 前提条件

需要安装 Mapbox 和 `@turf/turf`。

在项目中搜索锁定文件，并根据包管理器运行正确的命令：

如果找到 `package-lock.json`，使用以下命令：

```bash
npm i mapbox-gl @turf/turf @types/mapbox-gl
```

如果找到 `bun.lock`，使用以下命令：

```bash
bun i mapbox-gl @turf/turf @types/mapbox-gl
```

如果找到 `yarn.lock`，使用以下命令：

```bash
yarn add mapbox-gl @turf/turf @types/mapbox-gl
```

如果找到 `pnpm-lock.yaml`，使用以下命令：

```bash
pnpm i mapbox-gl @turf/turf @types/mapbox-gl
```

用户需要创建一个免费的 Mapbox 账户，并通过访问 https://console.mapbox.com/account/access-tokens/ 创建访问令牌。

需要将 mapbox 令牌添加到 `.env` 文件中：

```txt title=".env"
REMOTION_MAPBOX_TOKEN==pk.your-mapbox-access-token
```

## 添加地图

以下是 Remotion 中地图的基本示例。

```tsx
import {useEffect, useMemo, useRef, useState} from 'react';
import {AbsoluteFill, useDelayRender, useVideoConfig} from 'remotion';
import mapboxgl, {Map} from 'mapbox-gl';

export const lineCoordinates = [
  [6.56158447265625, 46.059891147620725],
  [6.5691375732421875, 46.05679376154153],
  [6.5842437744140625, 46.05059898938315],
  [6.594886779785156, 46.04702502069337],
  [6.601066589355469, 46.0460718554722],
  [6.6089630126953125, 46.0365370783104],
  [6.6185760498046875, 46.018420689207964],
];

mapboxgl.accessToken = process.env.REMOTION_MAPBOX_TOKEN as string;

export const MyComposition = () => {
  const ref = useRef<HTMLDivElement>(null);
  const {delayRender, continueRender} = useDelayRender();

  const {width, height} = useVideoConfig();
  const [handle] = useState(() => delayRender('Loading map...')); // 延迟渲染，等待地图加载
  const [map, setMap] = useState<Map | null>(null);

  useEffect(() => {
    const _map = new Map({
      container: ref.current!,
      zoom: 11.53,
      center: [6.5615, 46.0598],
      pitch: 65,
      bearing: 0,
      style: '⁠mapbox://styles/mapbox/standard',
      interactive: false, // 禁用交互，动画由 Remotion 控制
      fadeDuration: 0, // 禁用淡入淡出动画
    });

    _map.on('style.load', () => {
      // 隐藏 Mapbox Standard 样式中的所有要素
      const hideFeatures = [
        'showRoadsAndTransit',
        'showRoads',
        'showTransit',
        'showPedestrianRoads',
        'showRoadLabels',
        'showTransitLabels',
        'showPlaceLabels',
        'showPointOfInterestLabels',
        'showPointsOfInterest',
        'showAdminBoundaries',
        'showLandmarkIcons',
        'showLandmarkIconLabels',
        'show3dObjects',
        'show3dBuildings',
        'show3dTrees',
        'show3dLandmarks',
        'show3dFacades',
      ];
      for (const feature of hideFeatures) {
        _map.setConfigProperty('basemap', feature, false);
      }

      _map.setConfigProperty('basemap', 'colorTrunks', 'rgba(0, 0, 0, 0)');

      _map.addSource('trace', { // 添加轨迹数据源
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: lineCoordinates,
          },
        },
      });
      _map.addLayer({ // 添加线条图层
        type: 'line',
        source: 'trace',
        id: 'line',
        paint: {
          'line-color': 'black',
          'line-width': 5,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      });
    });

    _map.on('load', () => {
      continueRender(handle); // 地图加载完成，继续渲染
      setMap(_map);
    });
  }, [handle, lineCoordinates]);

  const style: React.CSSProperties = useMemo(() => ({width, height, position: 'absolute'}), [width, height]);

  return <AbsoluteFill ref={ref} style={style} />;
};
```

以下内容在 Remotion 中很重要：

- 动画必须由 `useCurrentFrame()` 驱动，Mapbox 自带的动画应该被禁用。例如，`fadeDuration` 属性应设置为 `0`，`interactive` 应设置为 `false` 等。
- 加载地图应该使用 `useDelayRender()` 进行延迟，并且在地图加载完成之前应将其设置为 `null`。
- 包含 ref 的元素必须具有明确的宽度和高度以及 `position: "absolute"`。
- 不要添加 `_map.remove();` 清理函数。

## 绘制线条

除非我要求，否则不要为线条添加发光效果。
除非我要求，否则不要为线条添加额外的点。

## 地图样式

默认情况下，使用 `mapbox://styles/mapbox/standard` 样式。
隐藏基础地图样式中的标签。

除非我另有要求，否则移除 Mapbox Standard 样式中的所有要素。

```tsx
// 隐藏 Mapbox Standard 样式中的所有要素
const hideFeatures = [
  'showRoadsAndTransit',
  'showRoads',
  'showTransit',
  'showPedestrianRoads',
  'showRoadLabels',
  'showTransitLabels',
  'showPlaceLabels',
  'showPointOfInterestLabels',
  'showPointsOfInterest',
  'showAdminBoundaries',
  'showLandmarkIcons',
  'showLandmarkIconLabels',
  'show3dObjects',
  'show3dBuildings',
  'show3dTrees',
  'show3dLandmarks',
  'show3dFacades',
];
for (const feature of hideFeatures) {
  _map.setConfigProperty('basemap', feature, false);
}

_map.setConfigProperty('basemap', 'colorMotorways', 'transparent');
_map.setConfigProperty('basemap', 'colorRoads', 'transparent');
_map.setConfigProperty('basemap', 'colorTrunks', 'transparent');
```

## 动画相机

可以通过添加一个 `useEffect` 钩子来沿线条动画相机，该钩子根据当前帧更新相机位置。

除非我要求，否则不要在相机角度之间跳跃。

```tsx
import * as turf from '@turf/turf';
import {interpolate} from 'remotion';
import {Easing} from 'remotion';
import {useCurrentFrame, useVideoConfig, useDelayRender} from 'remotion';

const animationDuration = 20;
const cameraAltitude = 4000;
```

```tsx
const frame = useCurrentFrame();
const {fps} = useVideoConfig();
const {delayRender, continueRender} = useDelayRender();

useEffect(() => {
  if (!map) {
    return;
  }
  const handle = delayRender('Moving point...'); // 延迟渲染，等待点移动

  const routeDistance = turf.length(turf.lineString(lineCoordinates)); // 计算路线距离

  const progress = interpolate(frame / fps, [0.00001, animationDuration], [0, 1], { // 计算进度
    easing: Easing.inOut(Easing.sin),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const camera = map.getFreeCameraOptions();

  const alongRoute = turf.along(turf.lineString(lineCoordinates), routeDistance * progress).geometry.coordinates; // 沿路线的位置

  camera.lookAtPoint({
    lng: alongRoute[0],
    lat: alongRoute[1],
  });

  map.setFreeCameraOptions(camera);
  map.once('idle', () => continueRender(handle));
}, [lineCoordinates, fps, frame, handle, map]);
```

注意事项：

重要：默认保持相机朝北。
重要：对于多步动画，在所有阶段设置所有属性（缩放、位置、线条进度）以防止跳跃。覆盖初始值。

- 进度被限制为最小值，以避免线条为空，这可能导致 turf 错误
- 有关时序的更多选项，请参阅[时序](./timing.md)。
- 考虑合成的尺寸，使线条足够粗，标签字体足够大，以便在合成缩小时仍然清晰可读。

## 动画线条

### 直线（线性插值）

要动画显示在地图上呈直线的线条，请在坐标之间使用线性插值。不要使用 turf 的 `lineSliceAlong` 或 `along` 函数，因为它们使用测地线（大圆）计算，在墨卡托投影上会呈现为曲线。

```tsx
const frame = useCurrentFrame();
const {durationInFrames} = useVideoConfig();

useEffect(() => {
  if (!map) return;

  const animationHandle = delayRender('Animating line...'); // 延迟渲染，等待线条动画

  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  // 线性插值以在地图上绘制直线
  const start = lineCoordinates[0];
  const end = lineCoordinates[1];
  const currentLng = start[0] + (end[0] - start[0]) * progress;
  const currentLat = start[1] + (end[1] - start[1]) * progress;

  const lineData: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [start, [currentLng, currentLat]],
    },
  };

  const source = map.getSource('trace') as mapboxgl.GeoJSONSource;
  if (source) {
    source.setData(lineData);
  }

  map.once('idle', () => continueRender(animationHandle));
}, [frame, map, durationInFrames]);
```

### 曲线（测地线/大圆）

要动画显示两点之间遵循测地线（大圆）路径的线条，请使用 turf 的 `lineSliceAlong`。这对于显示飞行路径或地球上实际最短距离很有用。

```tsx
import * as turf from '@turf/turf';

const routeLine = turf.lineString(lineCoordinates);
const routeDistance = turf.length(routeLine); // 计算路线距离

const currentDistance = Math.max(0.001, routeDistance * progress);
const slicedLine = turf.lineSliceAlong(routeLine, 0, currentDistance); // 沿路线切片

const source = map.getSource('route') as mapboxgl.GeoJSONSource;
if (source) {
  source.setData(slicedLine);
}
```

## 标记

在适当的位置添加标签和标记。

```tsx
_map.addSource('markers', { // 添加标记数据源
  type: 'geojson',
  data: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {name: 'Point 1'},
        geometry: {type: 'Point', coordinates: [-118.2437, 34.0522]},
      },
    ],
  },
});

_map.addLayer({ // 添加圆形标记图层
  id: 'city-markers',
  type: 'circle',
  source: 'markers',
  paint: {
    'circle-radius': 40,
    'circle-color': '#FF4444',
    'circle-stroke-width': 4,
    'circle-stroke-color': '#FFFFFF',
  },
});

_map.addLayer({ // 添加标签图层
  id: 'labels',
  type: 'symbol',
  source: 'markers',
  layout: {
    'text-field': ['get', 'name'],
    'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
    'text-size': 50,
    'text-offset': [0, 0.5],
    'text-anchor': 'top',
  },
  paint: {
    'text-color': '#FFFFFF',
    'text-halo-color': '#000000',
    'text-halo-width': 2,
  },
});
```

确保它们足够大。检查合成尺寸并相应地缩放标签。
对于 1920x1080 的合成尺寸，标签字体大小应至少为 40px。

重要：保持 `text-offset` 足够小，使其靠近标记。考虑标记圆的半径。对于半径为 40 的圆，这是一个好的偏移量：

```tsx
"text-offset": [0, 0.5],
```

## 3D 建筑

要启用 3D 建筑，使用以下代码：

```tsx
_map.setConfigProperty('basemap', 'show3dObjects', true);
_map.setConfigProperty('basemap', 'show3dLandmarks', true);
_map.setConfigProperty('basemap', 'show3dBuildings', true);
```

## 渲染

渲染地图动画时，请确保使用以下标志：

```
npx remotion render --gl=angle --concurrency=1
```
