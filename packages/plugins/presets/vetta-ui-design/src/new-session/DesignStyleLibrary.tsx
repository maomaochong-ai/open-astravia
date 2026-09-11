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
 * 四列定宽向下无限铺开，不再横向翻页：横滑要用户先知道「右边还有」，而风格库正是用户
 * 不知道自己该看的东西——铺开才看得见全貌。高度不设限，由整页滚动承担。
 *
 * 条目只增不减，所以按行做窗口化：只渲染视口附近的几行。每张卡里都是一份真实渲染的
 * demo（iframe / token 色块），全量挂上去会让这一屏直接卡死。
 */
import type { PluginNewSessionContext } from "@vetta-org/plugin-sdk";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DesignSystemTileContent } from "../cards/DesignSystemTileContent";
import { useCatalogState } from "../design-systems/index";
import type { DesignSystem } from "../design-systems/types";
import { rememberPickedSystem } from "./picked-system";

/** 固定三列：这一区宽度已经定死在页面的 80%，列数再随宽度变只会让卡片忽大忽小。 */
const COLUMNS = 3;
/** 与 `gap-3` 一致；行高换算要用到，所以必须是个数字而不是只写在 class 里。 */
const GAP = 12;
/** 卡片宽高比，与 `aspect-[4/3]` 一致。 */
const ASPECT = 4 / 3;
/** 视口上下各多渲染几行：滚动时新行提前挂载，避免滑到边缘才开始画。 */
const OVERSCAN = 2;

export function DesignStyleLibrary({ context }: { context: PluginNewSessionContext }): JSX.Element | null {
	const { t } = useTranslation();
	const { systems, status } = useCatalogState();
	const grid = useRef<HTMLDivElement | null>(null);
	const [picked, setPicked] = useState<string | null>(null);
	const [rowHeight, setRowHeight] = useState(0);
	const [range, setRange] = useState({ start: 0, end: COLUMNS * 3 });

	const rowCount = Math.ceil(systems.length / COLUMNS);

	// 行高从实测宽度换算，而不是写死一个像素值：这一区跟着窗口宽度伸缩，宽度一变行高
	// 就跟着变，用错的行高做窗口换算会让卡片在滚动中错位。
	useLayoutEffect(() => {
		const node = grid.current;
		if (!node) return;
		const measure = () => {
			const width = node.clientWidth;
			if (width <= 0) return;
			const card = (width - GAP * (COLUMNS - 1)) / COLUMNS;
			setRowHeight(card / ASPECT + GAP);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	const syncRange = useCallback(() => {
		const node = grid.current;
		if (!node || rowHeight <= 0) return;
		const top = node.getBoundingClientRect().top;
		const first = Math.floor(Math.max(0, -top) / rowHeight) - OVERSCAN;
		const visibleRows = Math.ceil(window.innerHeight / rowHeight) + OVERSCAN * 2;
		const startRow = Math.max(0, first);
		setRange({
			start: startRow * COLUMNS,
			end: Math.min(systems.length, (startRow + visibleRows) * COLUMNS),
		});
	}, [rowHeight, systems.length]);

	// 滚动的是宿主页面那个容器，插件够不着它，所以在 window 上用捕获阶段收所有祖先的
	// 滚动事件——不必知道是谁在滚，位置一律用 rect 相对视口重新算。
	useEffect(() => {
		syncRange();
		window.addEventListener("scroll", syncRange, true);
		window.addEventListener("resize", syncRange);
		return () => {
			window.removeEventListener("scroll", syncRange, true);
			window.removeEventListener("resize", syncRange);
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

	// 还没量出行高时先整份铺上：这一帧算不出窗口，宁可多画也不能留白一屏。
	const windowed = rowHeight > 0;
	const start = windowed ? range.start : 0;
	const end = windowed ? range.end : systems.length;
	const leadingRows = start / COLUMNS;
	const trailingRows = Math.max(0, rowCount - Math.ceil(end / COLUMNS));

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
				<div className="grid grid-cols-3 gap-3">
					{systems.slice(start, end).map((system) => (
						<button
							key={system.id}
							type="button"
							onClick={() => pick(system)}
							aria-pressed={picked === system.id}
							aria-label={t("newSession.styles.pick", { name: system.name })}
							title={t("newSession.styles.pick", { name: system.name })}
							className={`vetd-style-card flex aspect-[4/3] w-full flex-col gap-2 overflow-hidden rounded-xl p-2.5 text-left outline-none ${
								picked === system.id ? "vetd-style-card-picked" : ""
							}`}
						>
							<DesignSystemTileContent system={system} demoActive={false} />
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
