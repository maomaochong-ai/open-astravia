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
 * 两行横向吸附滚动而不是换行铺开：风格库条目只增不减，铺开会把输入框顶出首屏；两行既能
 * 一眼看到足够多的样本，又把高度钉死。
 */
import type { PluginNewSessionContext } from "@vetta-org/plugin-sdk";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { DesignSystemTileContent } from "../cards/DesignSystemTileContent";
import { useCatalogState } from "../design-systems/index";
import type { DesignSystem } from "../design-systems/types";
import { rememberPickedSystem } from "./picked-system";

/** 一页滚动的比例：留一点上一页的边，用户才知道还能往回翻。 */
const PAGE_RATIO = 0.86;

export function DesignStyleLibrary({ context }: { context: PluginNewSessionContext }): JSX.Element | null {
	const { t } = useTranslation();
	const { systems, status } = useCatalogState();
	const scroller = useRef<HTMLDivElement | null>(null);
	const [picked, setPicked] = useState<string | null>(null);
	const [edges, setEdges] = useState({ start: false, end: false });

	const syncEdges = useCallback(() => {
		const node = scroller.current;
		if (!node) return;
		const max = node.scrollWidth - node.clientWidth;
		setEdges({ start: node.scrollLeft > 4, end: node.scrollLeft < max - 4 });
	}, []);

	useEffect(() => {
		syncEdges();
	}, [syncEdges]);

	const page = (direction: 1 | -1) => {
		const node = scroller.current;
		if (!node) return;
		node.scrollBy({ left: direction * node.clientWidth * PAGE_RATIO, behavior: "smooth" });
	};

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

	return (
		<div className="w-full">
			<div className="flex items-center justify-between gap-3">
				<span className="vetd-style-pill inline-flex rounded-full px-2.5 py-[5px] text-[11px] font-medium leading-none text-foreground/90">
					{t("newSession.styles.hint")}
				</span>
				<div className="flex items-center gap-1">
					<PageButton direction="prev" disabled={!edges.start} label={t("newSession.styles.prev")} onClick={() => page(-1)} />
					<PageButton direction="next" disabled={!edges.end} label={t("newSession.styles.next")} onClick={() => page(1)} />
				</div>
			</div>

			<div
				ref={scroller}
				onScroll={syncEdges}
				className="vetd-style-scroller mt-3 grid grid-flow-col grid-rows-2 gap-3 overflow-x-auto overscroll-x-contain pb-1"
			>
				{systems.map((system) => (
					<button
						key={system.id}
						type="button"
						onClick={() => pick(system)}
						aria-pressed={picked === system.id}
						aria-label={t("newSession.styles.pick", { name: system.name })}
						title={t("newSession.styles.pick", { name: system.name })}
						className={`vetd-style-card flex aspect-[4/3] w-[168px] snap-start flex-col gap-2 overflow-hidden rounded-xl p-2.5 text-left outline-none ${
							picked === system.id ? "vetd-style-card-picked" : ""
						}`}
					>
						<DesignSystemTileContent system={system} demoActive={false} />
					</button>
				))}
			</div>
		</div>
	);
}

function PageButton({
	direction,
	disabled,
	label,
	onClick,
}: {
	direction: "prev" | "next";
	disabled: boolean;
	label: string;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			title={label}
			className="vetd-style-pager flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-foreground/70 disabled:cursor-default disabled:opacity-30"
		>
			<span
				className={`h-3 w-3 ${direction === "prev" ? "icon-[solar--alt-arrow-left-linear]" : "icon-[solar--alt-arrow-right-linear]"}`}
				aria-hidden="true"
			/>
		</button>
	);
}
