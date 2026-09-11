/**
 * 新会话页输入框下方的风格库。
 *
 * 选画幅、写需求用户自己会做，选风格不会——多数人根本不知道有这一步，于是每份设计都长成
 * 模型的默认审美。把整套风格库摆在开工前最后一屏，是这条链路上性价比最高的一次干预。
 *
 * 点一张卡：挂到输入框上（用户看得见自己选了什么，也能反悔），**发送之后**才把这套体系
 * 的资料落进当前项目。放到发送后是因为挑挑拣拣很正常，没发就落盘会在项目里留下一堆
 * 没用上的参考资料。
 *
 * 向下无限铺开，不横向翻页：横滑要用户先知道「右边还有」，而风格库正是用户不知道自己
 * 该看的东西——铺开才看得见全貌。高度不设限，由整页滚动承担。
 *
 * 两处为滚动流畅做的取舍：
 * - **按行窗口化**，只渲染视口附近的几行；滚动回调用 rAF 合帧，窗口没变就不 setState，
 *   否则每个滚动事件都要把整面墙重渲一次。
 * - **静态只铺色板**，悬停到哪张才把那一张换成真 demo：一张 demo 是一个 iframe + 一份
 *   完整文档，几十张连排光解析就能把这一屏拖住。
 */
import type { PluginNewSessionContext } from "@vetta-org/plugin-sdk";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DesignSystemTileContent } from "../cards/DesignSystemTileContent";
import { useCatalogState } from "../design-systems/index";
import type { DesignSystem } from "../design-systems/types";
import { rememberPickedSystem } from "./picked-system";
import { STYLE_GRID_MAX_COLUMNS, styleGridMetrics, styleGridWindow } from "./style-grid-layout";

export function DesignStyleLibrary({ context }: { context: PluginNewSessionContext }): JSX.Element | null {
	const { t } = useTranslation();
	const { systems, status } = useCatalogState();
	const grid = useRef<HTMLDivElement | null>(null);
	const [picked, setPicked] = useState<string | null>(null);
	const [hovered, setHovered] = useState<string | null>(null);
	const [width, setWidth] = useState(0);
	const [range, setRange] = useState({ start: 0, end: STYLE_GRID_MAX_COLUMNS * 3 });
	/** 上一次算出的窗口：窗口没变就不进 React，滚动才不会每帧重渲。 */
	const rangeRef = useRef(range);
	const frameRef = useRef(0);

	// 列数与行高都从实测宽度换算：这一区跟着窗口伸缩，用错的行高做窗口换算会让卡片在
	// 滚动中错位。
	const metrics = useMemo(() => styleGridMetrics(width), [width]);

	useLayoutEffect(() => {
		const node = grid.current;
		if (!node) return;
		const measure = () => setWidth(node.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	const syncRange = useCallback(() => {
		const node = grid.current;
		if (!node || metrics.rowHeight <= 0) return;
		const next = styleGridWindow({
			scrolledPast: -node.getBoundingClientRect().top,
			viewportHeight: window.innerHeight,
			metrics,
			total: systems.length,
		});
		const current = rangeRef.current;
		if (next.start === current.start && next.end === current.end) return;
		rangeRef.current = next;
		setRange(next);
	}, [metrics, systems.length]);

	// 滚动的是宿主页面那个容器，插件够不着它，所以在 window 上用捕获阶段收所有祖先的
	// 滚动事件——不必知道是谁在滚，位置一律用 rect 相对视口重新算。事件本身合到下一帧
	// 处理：滚动事件的密度远高于帧率，逐个算等于白算。
	useEffect(() => {
		const onScroll = () => {
			if (frameRef.current) return;
			frameRef.current = requestAnimationFrame(() => {
				frameRef.current = 0;
				syncRange();
			});
		};
		syncRange();
		window.addEventListener("scroll", onScroll, { capture: true, passive: true });
		window.addEventListener("resize", onScroll, { passive: true });
		return () => {
			window.removeEventListener("scroll", onScroll, { capture: true });
			window.removeEventListener("resize", onScroll);
			if (frameRef.current) cancelAnimationFrame(frameRef.current);
			frameRef.current = 0;
		};
	}, [syncRange]);

	const pick = (system: DesignSystem) => {
		setPicked(system.id);
		// 记下来等发送；真正落盘由 turn-start 触发，见 picked-system。
		rememberPickedSystem(system);
		context.composer.attach({
			id: `vetta-ui-design:style:${system.id}`,
			label: system.name,
			metadata: { designSystemId: system.id },
		});
	};

	if (status !== "ready" && systems.length === 0) return null;

	const { columns, rowHeight } = metrics;
	const rowCount = Math.ceil(systems.length / columns);
	// 还没量出行高时先整份铺上：这一帧算不出窗口，宁可多画也不能留白一屏。
	const windowed = rowHeight > 0;
	const start = windowed ? Math.min(range.start, Math.max(0, (rowCount - 1) * columns)) : 0;
	const end = windowed ? Math.max(range.end, start + columns) : systems.length;
	const leadingRows = Math.floor(start / columns);
	const trailingRows = Math.max(0, rowCount - Math.ceil(end / columns));

	return (
		<div className="w-full">
			<div className="flex items-center gap-2">
				<span className="vetd-style-title-mark h-4 w-[3px] shrink-0 rounded-full" aria-hidden="true" />
				<h2 className="vetd-style-title text-[15px] font-semibold leading-none tracking-tight">
					{t("newSession.styles.title")}
				</h2>
			</div>

			<div
				ref={grid}
				className="mt-3"
				// 撑开的空行用 padding 而不是占位元素：网格里插占位会把后面的卡挤错列。
				style={{ paddingTop: leadingRows * rowHeight, paddingBottom: trailingRows * rowHeight }}
			>
				<div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
					{systems.slice(start, end).map((system) => (
						<button
							key={system.id}
							type="button"
							onClick={() => pick(system)}
							onPointerEnter={() => setHovered(system.id)}
							onPointerLeave={() => setHovered((current) => (current === system.id ? null : current))}
							onFocus={() => setHovered(system.id)}
							aria-pressed={picked === system.id}
							aria-label={t("newSession.styles.pick", { name: system.name })}
							title={t("newSession.styles.pick", { name: system.name })}
							className={`vetd-style-card flex aspect-[4/3] w-full flex-col gap-2 overflow-hidden rounded-xl p-2.5 text-left outline-none ${
								picked === system.id ? "vetd-style-card-picked" : ""
							}`}
						>
							<DesignSystemTileContent
								system={system}
								demo={hovered === system.id}
								demoActive={hovered === system.id}
							/>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
