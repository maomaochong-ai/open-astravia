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
 * - **按行窗口化**，只渲染视口附近的几行（见 `use-style-wall-window`）。
 * - **静态只铺色板**，悬停到哪张才把那一张换成真 demo：一张 demo 是一个 iframe + 一份
 *   完整文档，几十张连排光解析就能把这一屏拖住。
 */
import type { PluginNewSessionContext } from "@astravia-org/plugin-sdk";
import { useTranslation } from "@astravia-org/plugin-sdk";
import { useState } from "react";
import { DesignSystemTileContent } from "../cards/DesignSystemTileContent";
import { useStyleWallWindow } from "../cards/use-style-wall-window";
import { useCatalogState } from "../design-systems/index";
import type { DesignSystem } from "../design-systems/types";
import { rememberPickedSystem } from "./picked-system";

export function DesignStyleLibrary({ context }: { context: PluginNewSessionContext }): JSX.Element | null {
	const { t } = useTranslation();
	const { systems, status } = useCatalogState();
	const [picked, setPicked] = useState<string | null>(null);
	const [hovered, setHovered] = useState<string | null>(null);
	const wall = useStyleWallWindow({ total: systems.length });

	const pick = (system: DesignSystem) => {
		setPicked(system.id);
		// 记下来等发送；真正落盘由 turn-start 触发，见 picked-system。
		rememberPickedSystem(system);
		context.composer.attach({
			id: `astravia-ui-design:style:${system.id}`,
			label: system.name,
			metadata: { designSystemId: system.id },
		});
	};

	if (status !== "ready" && systems.length === 0) return null;

	const { columns } = wall.metrics;

	return (
		<div className="w-full">
			<div className="flex items-center gap-2">
				<span className="astravia-design-style-title-mark h-4 w-[3px] shrink-0 rounded-full" aria-hidden="true" />
				<h2 className="astravia-design-style-title text-[15px] font-semibold leading-none tracking-tight">
					{t("newSession.styles.title")}
				</h2>
			</div>

			<div
				ref={wall.ref}
				className="mt-3"
				// 撑开的空行用 padding 而不是占位元素：网格里插占位会把后面的卡挤错列。
				style={{ paddingTop: wall.paddingTop, paddingBottom: wall.paddingBottom }}
			>
				<div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
					{systems.slice(wall.start, wall.end).map((system) => (
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
							className={`astravia-design-style-card flex aspect-[4/3] w-full flex-col gap-2 overflow-hidden rounded-xl p-2.5 text-left outline-none ${
								picked === system.id ? "astravia-design-style-card-picked" : ""
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
