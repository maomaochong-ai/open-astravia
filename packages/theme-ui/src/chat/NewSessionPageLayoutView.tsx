import type { JSX, ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface NewSessionPageLayoutViewProps {
	readonly background: ReactNode;
	readonly dropZone: (children: ReactNode) => ReactNode;
	readonly guidingWords?: ReactNode;
	readonly hero?: ReactNode;
	readonly inputBar: ReactNode;
	readonly isShort: boolean;
	/** 输入栏下方的落地区：从输入栏正下方开始，往下要多少给多少。 */
	readonly landing?: ReactNode;
	readonly skillBadges?: ReactNode;
	readonly themedBackground?: ReactNode;
}

/** 主列上下最小留白（`py-6`）：量出来的顶部留白再小也不能压到这个值以下。 */
const MIN_GAP = 24;

/**
 * 新会话页主列布局：整块内容垂直居中（hero + 技能 + 输入 + 引导词作为一体）。
 * 防抖依赖 host 侧预留槽位与资源一次落盘，而不是把输入栏单独钉在视口中线
 * （后者会让上方 hero 把视觉重心整体顶上去）。
 *
 * 落地区从输入栏正下方开始，往下把整页用满，超出视口的部分由这层容器滚动——滚的是整页。
 *
 * 有落地区时顶部留白改成**实测定值**而不是继续靠 `justify-center`：居中是「剩余空间对半
 * 分」，而落地区一长高剩余空间就归零，上方留白会被挤没、输入栏被顶到屏幕顶上。这里量出
 * 「假如没有落地区，输入栏本该落在哪」，把那段留白钉死，于是输入栏留在原位，落地区只吃
 * 它下方的空间。没有落地区时完全不量——那条路是常态，多一次测量就多一次抖动的机会。
 */
export function NewSessionPageLayoutView({
	background,
	dropZone,
	guidingWords,
	hero,
	inputBar,
	isShort,
	landing,
	skillBadges,
	themedBackground,
}: NewSessionPageLayoutViewProps): JSX.Element {
	const scroller = useRef<HTMLDivElement | null>(null);
	const column = useRef<HTMLDivElement | null>(null);
	const [topGap, setTopGap] = useState(MIN_GAP);

	// 留白撑在独立的占位元素上，量的是主列自身高度：把 padding 加回被测元素上会让
	// 「量高度 → 改 padding → 高度又变」绕成一个环。
	const measure = useCallback(() => {
		const view = scroller.current;
		const group = column.current;
		if (!view || !group) return;
		setTopGap(Math.max(MIN_GAP, (view.clientHeight - group.offsetHeight) / 2));
	}, []);

	useLayoutEffect(() => {
		if (!landing) return;
		measure();
		// 测试环境（happy-dom）没有 ResizeObserver：量一次就够，缺了它不该把整页渲染炸掉。
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		if (scroller.current) observer.observe(scroller.current);
		if (column.current) observer.observe(column.current);
		return () => observer.disconnect();
	}, [landing, measure]);

	return (
		<>
			{dropZone(
				<>
					{background}
					{themedBackground}
					<div ref={scroller} className="no-drag relative z-[1] flex flex-1 flex-col overflow-y-auto">
						{landing ? <div aria-hidden="true" className="shrink-0" style={{ height: topGap }} /> : null}
						<div
							ref={column}
							className={`flex w-full shrink-0 flex-col items-center px-6 ${
								landing ? "pb-0 pt-0" : "min-h-full justify-center py-6"
							}`}
						>
							{hero}
							{skillBadges && (
								<div className="mx-auto w-full max-w-2xl px-2 sm:px-4">{skillBadges}</div>
							)}
							<div className="w-full">{inputBar}</div>
							{!isShort && guidingWords && (
								<div className="mx-auto w-full max-w-2xl px-2 sm:px-4">{guidingWords}</div>
							)}
						</div>
						{landing ? <div className="w-full shrink-0 px-6 pb-6">{landing}</div> : null}
					</div>
				</>,
			)}
		</>
	);
}
