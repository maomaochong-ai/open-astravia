import type { SkillInfo } from "@preload/api";
import { ThemeSurface } from "@vetta/theme-ui/appearance";
import { useThemeComponent } from "@vetta/theme-sdk";
import { AnimatePresence, motion } from "motion/react";
import { useSkillPickerModel } from "../../hooks/useSkillPickerModel";
import { SkillList } from "./SkillList";
import type { SkillListLabels } from "./types";

export interface SkillPickerPanelViewProps {
	open: boolean;
	placement: "top" | "bottom";
	filter: string;
	items: readonly SkillInfo[];
	activeIndex: number;
	labels: SkillListLabels & { header: string; resultCount: string };
	panelRef: React.RefObject<HTMLDivElement | null>;
	className?: string;
	onHoverItem: (index: number) => void;
	onSelectItem: (skill: SkillInfo) => void;
}

const MAX_HEIGHT = 320;

/**
 * 批量任务 / 自动化 dialog 用的纯 skill/场景 选择器。
 *
 * 刻意不带连接器宫格与动作条：那些开关（知识检索、插件 input action）读的是聊天
 * 会话态，在 dialog 里既不生效也无从生效，摆出来就是误导。
 */
export function SkillPickerPanelView({
	open,
	placement,
	filter,
	items,
	activeIndex,
	labels,
	panelRef,
	className,
	onHoverItem,
	onSelectItem,
}: SkillPickerPanelViewProps): JSX.Element {
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
							{filter.length > 0 && (
								<span className="ml-auto text-[11px] text-muted-foreground/50">{labels.resultCount}</span>
							)}
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto">
							<SkillList
								items={items}
								activeIndex={activeIndex}
								labels={labels}
								filtering={filter.length > 0}
								onHover={onHoverItem}
								onSelect={onSelectItem}
							/>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

export interface SkillPickerPanelProps {
	open: boolean;
	onClose: () => void;
	onSelect: (skill: SkillInfo) => void;
	filter: string;
	placement?: "top" | "bottom";
	cwd?: string;
	className?: string;
}

export function SkillPickerPanel(props: SkillPickerPanelProps): JSX.Element {
	const model = useSkillPickerModel(props);
	const ThemedSkillPickerPanelView = useThemeComponent("chat.skillPickerView", SkillPickerPanelView);
	return <ThemedSkillPickerPanelView {...model.viewProps} />;
}
