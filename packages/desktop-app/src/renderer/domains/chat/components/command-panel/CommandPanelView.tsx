import { ThemeSurface } from "@vetta/theme-ui/appearance";
import { AnimatePresence, motion } from "motion/react";
import { ConnectorGrid } from "./ConnectorGrid";
import { SkillList } from "./SkillList";
import type { CommandPanelProps } from "./types";

/**
 * 命令区最大高度。
 * 它与编辑区、工具栏共处一张卡片，因此还要给短窗口留余量——纯 420 在小屏上
 * 会把整条 bar 顶到占掉大半个视口。
 */
const MAX_HEIGHT = "min(420px, 45vh)";

/** 展开 / 收缩的高度过渡：带阻尼的弹簧，避免线性 easing 的生硬感。 */
const GROW = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.7 };
const FADE = { duration: 0.12 };

/**
 * InputBar 的「展开」形态：命令区。
 *
 * 刻意不是浮层——它与编辑区同属一张输入卡片，展开只是这张卡片长高，
 * 所以两者之间既没有接缝也没有分界线，不需要去凑圆角与描边。
 *
 * 区内结构：header（固定）→ 连接器宫格 + skill 列表（同一滚动容器）→ 命令条（固定在底部）。
 * 宫格随内容滚动、向下滚时让位给 skills；否则 8 个连接器就能把可滚区压到只剩几行。
 */
export function CommandPanelView({
	open,
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
		<AnimatePresence initial={false}>
			{open && (
				<motion.div
					key="command-region"
					ref={panelRef}
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: "auto", opacity: 1 }}
					exit={{ height: 0, opacity: 0 }}
					transition={{ height: GROW, opacity: FADE }}
					className={["relative overflow-hidden rounded-t-[inherit]", className].filter(Boolean).join(" ")}
				>
					<ThemeSurface slot="chat.slashPanel" />
					<div className="relative z-10 flex flex-col" style={{ maxHeight: MAX_HEIGHT }}>
						<div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-2.5">
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

						{(commands.length > 0 || actions.length > 0) && (
							<div className="flex shrink-0 flex-nowrap items-center gap-0.5 overflow-x-auto px-3 pb-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
								{/* 一次性命令（选图 / 选附件）：无激活态，与右侧开关用分隔线隔开 */}
								{commands.map((command) => (
									<button
										key={command.id}
										type="button"
										onClick={command.onSelect}
										title={command.label}
										className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-0.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
									>
										<span className={`${command.icon} h-3.5 w-3.5 shrink-0`} />
										{command.label}
									</button>
								))}
								{commands.length > 0 && actions.length > 0 && (
									<span className="mx-1 h-4 w-px shrink-0 bg-border/70" />
								)}
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
