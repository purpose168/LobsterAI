import {loadFont} from '@remotion/google-fonts/Inter';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';

// 加载 Google 字体
const {fontFamily} = loadFont();

// 定义颜色常量
const COLOR_BAR = '#D4AF37'; // 柱状图颜色（金色）
const COLOR_TEXT = '#ffffff'; // 文本颜色（白色）
const COLOR_MUTED = '#888888'; // 次要文本颜色（灰色）
const COLOR_BG = '#0a0a0a'; // 背景颜色（深黑色）
const COLOR_AXIS = '#333333'; // 坐标轴颜色（深灰色）

// 理想合成尺寸：1280x720

// 标题组件：显示图表标题
const Title: React.FC<{children: React.ReactNode}> = ({children}) => (
	<div style={{textAlign: 'center', marginBottom: 40}}>
		<div style={{color: COLOR_TEXT, fontSize: 48, fontWeight: 600}}>
			{children}
		</div>
	</div>
);

// Y轴组件：显示垂直刻度值
const YAxis: React.FC<{steps: number[]; height: number}> = ({
	steps,
	height,
}) => (
	<div
		style={{
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'space-between',
			height,
			paddingRight: 16,
		}}
	>
		{steps
			.slice()
			.reverse()
			.map((step) => (
				<div
					key={step}
					style={{
						color: COLOR_MUTED,
						fontSize: 20,
						textAlign: 'right',
					}}
				>
					{step.toLocaleString()}
				</div>
			))}
	</div>
);

// 柱状图组件：显示单个柱子
const Bar: React.FC<{
	height: number; // 柱子高度
	progress: number; // 动画进度（0-1）
}> = ({height, progress}) => (
	<div
		style={{
			flex: 1,
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'flex-end',
		}}
	>
		<div
			style={{
				width: '100%',
				height,
				backgroundColor: COLOR_BAR,
				borderRadius: '8px 8px 0 0',
				opacity: progress,
			}}
		/>
	</div>
);

// X轴组件：显示柱状图和底部标签
const XAxis: React.FC<{
	children: React.ReactNode; // 柱状图子元素
	labels: string[]; // X轴标签数组
	height: number; // 图表高度
}> = ({children, labels, height}) => (
	<div style={{flex: 1, display: 'flex', flexDirection: 'column'}}>
		<div
			style={{
				display: 'flex',
				alignItems: 'flex-end',
				gap: 16,
				height,
				borderLeft: `2px solid ${COLOR_AXIS}`,
				borderBottom: `2px solid ${COLOR_AXIS}`,
				paddingLeft: 16,
			}}
		>
			{children}
		</div>
		<div
			style={{
				display: 'flex',
				gap: 16,
				paddingLeft: 16,
				marginTop: 12,
			}}
		>
			{labels.map((label) => (
				<div
					key={label}
					style={{
						flex: 1,
						textAlign: 'center',
						color: COLOR_MUTED,
						fontSize: 20,
					}}
				>
					{label}
				</div>
			))}
		</div>
	</div>
);

export const MyAnimation = () => {
	const frame = useCurrentFrame(); // 获取当前帧
	const {fps, height} = useVideoConfig(); // 获取视频配置（帧率和高度）

	// 图表数据：2024年黄金价格
	const data = [
		{month: '1月', price: 2039},
		{month: '3月', price: 2160},
		{month: '5月', price: 2327},
		{month: '7月', price: 2426},
		{month: '9月', price: 2634},
		{month: '11月', price: 2672},
	];

	// 计算图表参数
	const minPrice = 2000; // 最低价格
	const maxPrice = 2800; // 最高价格
	const priceRange = maxPrice - minPrice; // 价格范围
	const chartHeight = height - 280; // 图表高度
	const yAxisSteps = [2000, 2400, 2800]; // Y轴刻度值

	return (
		<AbsoluteFill
			style={{
				backgroundColor: COLOR_BG,
				padding: 60,
				display: 'flex',
				flexDirection: 'column',
				fontFamily,
			}}
		>
			<Title>2024年黄金价格</Title>

			<div style={{display: 'flex', flex: 1}}>
				<YAxis steps={yAxisSteps} height={chartHeight} />
				<XAxis height={chartHeight} labels={data.map((d) => d.month)}>
					{data.map((item, i) => {
						// 计算每个柱子的动画进度
						const progress = spring({
							frame: frame - i * 5 - 10, // 延迟动画，每个柱子依次出现
							fps,
							config: {damping: 18, stiffness: 80}, // 弹簧动画配置
						});

						// 根据价格和动画进度计算柱子高度
						const barHeight =
							((item.price - minPrice) / priceRange) * chartHeight * progress;

						return (
							<Bar key={item.month} height={barHeight} progress={progress} />
						);
					})}
				</XAxis>
			</div>
		</AbsoluteFill>
	);
};
