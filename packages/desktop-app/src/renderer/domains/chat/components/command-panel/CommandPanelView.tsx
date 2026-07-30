import { ThemeSurface } from "@vetta/theme-ui/appearance";
import { AnimatePresence, motion } from "motion/react";
import { ConnectorGrid } from "./ConnectorGrid";
import { SkillList } from "./SkillList";
import type { CommandPanelProps } from "./types";

/** 面板总高：宫格 + 列表 + 底部固定动作条都要塞进来，320 太挤。 */
const MAX_HEIGHT = 420;

/**
 * 聊天输入框上方的命令面板。
 *
 * 结构：header（固定）→ 连接器宫格 + skill 列表（同一滚动容器）→ 动作条（固定在底部）。
 * 宫格随内容滚动，向下滚时让位给 skills；只有 header 与动作条不随滚动，
 * 否则 8 个连接器的宫格会把可滚区压到只剩几行。
 */
export function CommandPanelView({
	open,
	placement,
	filter,
	items,
	activeIndex,
	connectors,
	connectorColumns,
	commands,
	actions,
	labels,
	panelRef,
	className,
	onHoverItem,
	onSelectItem,
	onSelectConnector,
}: CommandPanelProps): JSX.Element {
	const filtering = filter.length > 0;
	return (
		<AnimatePresence>
			{open && (
				<motion.div
					ref={panelRef}
					initial={{ opacity: 0, y: placement === "top" ? 8 : -8, scaleY: 0.96 }}
					animate={{ opacity: 1, y: 0, scaleY: 1 }}
					exit={{ opacity: 0, y: placement === "top" ? 8 : -8, scaleY: 0.96 }}
					transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
					className={[
						"absolute inset-x-0 z-50 overflow-visible rounded-2xl border border-border bg-card",
						placement === "top" ? "bottom-full mb-1.5 origin-bottom" : "top-full mt-1.5 origin-top",
						className,
					]
						.filter(Boolean)
						.join(" ")}
					style={{ maxHeight: MAX_HEIGHT }}
				>
					<ThemeSurface slot="chat.slashPanel" />
					<div
						className="relative z-10 flex flex-col overflow-hidden rounded-[inherit]"
						style={{ maxHeight: MAX_HEIGHT }}
					>
						<div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
							<span className="icon-[solar--slash-circle-linear] h-4 w-4 text-muted-foreground/50" />
							<span className="text-[12px] font-medium text-muted-foreground/50">{labels.header}</span>
							{filtering && (
								<span className="ml-auto text-[11px] text-muted-foreground/50">{labels.resultCount}</span>
							)}
						</div>

						<div className="min-h-0 flex-1 overflow-y-auto">
							{/* 过滤态隐藏宫格：此时用户在找 skill，键盘导航也只走列表 */}
							{!filtering && (
								<ConnectorGrid
									items={connectors}
									columns={connectorColumns}
									title={labels.connectorsSection}
									onSelect={onSelectConnector}
								/>
							)}
							<SkillList
								items={items}
								activeIndex={activeIndex}
								labels={labels}
								filtering={filtering}
								onHover={onHoverItem}
								onSelect={onSelectItem}
							/>
						</div>

						{actions.length > 0 && (
							<div className="flex shrink-0 flex-nowrap items-center gap-0.5 overflow-x-auto border-t border-border px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
								{actions.map((action) => (
									<button
										key={action.id}
										type="button"
										onClick={action.onToggle}
										title={action.label}
										className={[
											"flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-0.5 text-[12px] font-medium transition-colors",
											action.active
												? "bg-primary/10 text-primary"
												: "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
										].join(" ")}
									>
										{action.icon ? (
											<span className="flex h-3.5 w-3.5 items-center justify-center">{action.icon}</span>
										) : null}
										{action.label}
									</button>
								))}
							</div>
						)}
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
