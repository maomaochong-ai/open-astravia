import type { SnapDecoration, SnapGap, SnapGuide } from "./snap";

interface SnapGuidesProps extends SnapDecoration {
	/**
	 * 1 / zoom。线宽、端帽、数字都按它反向缩放，任何缩放下都是同样粗细的一根线。
	 *
	 * 刻意不复用 world 层的 `--vetd-lscale`：那个变量有 `min(…, 8)` 的上限（标题栏
	 * 缩到一定程度就不再放大了），而引导线一旦细过 1 屏幕像素就等于没画。
	 */
	scale: number;
}

/** 缝隙标注两端的端帽半长（屏幕像素）。 */
const CAP = 4;

/**
 * 吸附引导线与缝隙标注。挂在 world 层内（跟着画布平移缩放），只在拖拽期间存在。
 *
 * z-20 是必需的：FrameView 的根节点没有 z-index，同级后画虽然本来就在上层，但 frame
 * 内部的手柄是 z-10，不抬上去会被手柄压住。
 */
export function SnapGuides({ guides, gaps, scale }: SnapGuidesProps) {
	const thickness = scale;
	return (
		<div className="pointer-events-none absolute left-0 top-0 z-20">
			{guides.map((guide) => (
				<GuideLine key={`${guide.axis}-${guide.position}`} guide={guide} thickness={thickness} />
			))}
			{gaps.map((gap) => (
				<GapLabel key={`${gap.axis}-${gap.at}-${gap.from}`} gap={gap} scale={scale} thickness={thickness} />
			))}
		</div>
	);
}

function GuideLine({ guide, thickness }: { guide: SnapGuide; thickness: number }) {
	const vertical = guide.axis === "x";
	return (
		<div
			className="absolute bg-[var(--vetd-selected)]"
			style={
				vertical
					? {
							left: guide.position - thickness / 2,
							top: guide.from,
							width: thickness,
							height: guide.to - guide.from,
						}
					: {
							left: guide.from,
							top: guide.position - thickness / 2,
							width: guide.to - guide.from,
							height: thickness,
						}
			}
		/>
	);
}

/** 缝隙的两个端帽 + 像素数字。缝隙本身与引导线重合，不再单独画一条。 */
function GapLabel({ gap, scale, thickness }: { gap: SnapGap; scale: number; thickness: number }) {
	const vertical = gap.axis === "y";
	const middle = (gap.from + gap.to) / 2;
	const cap = CAP * scale;
	const capStyle = vertical
		? { width: cap * 2, height: thickness, left: gap.at - cap, top: 0 }
		: { width: thickness, height: cap * 2, left: 0, top: gap.at - cap };
	return (
		<>
			{[gap.from, gap.to].map((edge) => (
				<div
					key={edge}
					className="absolute bg-[var(--vetd-selected)]"
					style={{
						...capStyle,
						...(vertical ? { top: edge - thickness / 2 } : { left: edge - thickness / 2 }),
					}}
				/>
			))}
			{/* 0×0 的锚点，只用来把内层的数字钉在缝隙中点并反向缩放。 */}
			<div
				className="absolute"
				style={{
					left: vertical ? gap.at : middle,
					top: vertical ? middle : gap.at,
					transform: `scale(${scale})`,
					transformOrigin: "left top",
				}}
			>
				<span
					className="absolute whitespace-nowrap rounded-sm bg-[var(--vetd-selected)] px-1 text-[10px] leading-4 text-white"
					style={vertical ? { left: CAP + 2, top: -8 } : { left: 0, top: CAP + 2, transform: "translateX(-50%)" }}
				>
					{Math.round(gap.to - gap.from)}
				</span>
			</div>
		</>
	);
}
