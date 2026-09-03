import { CurrentScenarioActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "@shared/lib/utils";
import { useThemeComponent } from "@vetta/theme-sdk";
import { NewSessionPageLayoutView } from "@vetta/theme-ui/chat";
import {
	PANEL_REVEAL_DURATION,
	PANEL_REVEAL_EASE,
	PANEL_REVEAL_TRANSITION,
} from "../command-panel/constants";
import { NewSessionBackground } from "./NewSessionBackground";
import { NewSessionHero } from "./NewSessionHero";
import { NewSessionOptionsRow } from "./NewSessionOptionsRow";
import type { ProjectOption, ProjectSelection } from "./project-selector/project-selection";
import { DefaultInputBarConnector } from "../input-bar/DefaultInputBarConnector";
import type { SendInteractionContext } from "../input-bar/types";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";


/** 命令区展开时输入栏下移的距离：面板向上生长，下方留白同步收掉。 */
const PANEL_SHIFT_Y = 120;

interface NewSessionPageViewProps {
	activityPanelCwd: string | null;
	avatarAutoplay: boolean;
	className?: string;
	commandPanelExpanded: boolean;
	commandPanelShift: boolean;
	cwd: string;
	greetingTitle: string;
	isShort: boolean;
	mounted: boolean;
	onAbort: () => Promise<void>;
	onCommandPanelExpandedChange: (expanded: boolean) => void;
	onSelectPendingProject: (name: string) => void;
	onSelectProject: (cwd: string | null) => void;
	onSend: (overrideText?: string, context?: SendInteractionContext) => Promise<void>;
	preparingProject: boolean;
	projectOptions: readonly ProjectOption[];
	projectSelection: ProjectSelection;
	projectTakenNames: readonly string[];
	subtitle: string;
}

export function NewSessionPageView({
	activityPanelCwd,
	avatarAutoplay,
	className,
	commandPanelExpanded,
	commandPanelShift,
	cwd,
	greetingTitle,
	isShort,
	mounted,
	onAbort,
	onCommandPanelExpandedChange,
	onSelectPendingProject,
	onSelectProject,
	onSend,
	preparingProject,
	projectOptions,
	projectSelection,
	projectTakenNames,
	subtitle,
}: NewSessionPageViewProps): JSX.Element {
	const ThemedNewSessionBackground = useThemeComponent(
		"chat.newSessionBackground",
		EmptyNewSessionBackground,
	);
	const { t } = useTranslation("chat");
	const preparingLabel = t("newSession.projectSelector.preparing");
	const reduceMotion = useReducedMotion();
	// hero 淡出、输入栏位移、命令区揭幕三条动画同时跑，共用同一条曲线：各跑各的弹簧时
	// 长度不一致，掉帧时能明显看出它们互相在「追」。
	const shiftTransition = reduceMotion ? { duration: 0 } : PANEL_REVEAL_TRANSITION;
	// hero 仍比位移收得更快：吉祥物层级高于输入栏，淡得慢会在面板前面停留一下。
	const heroTransition = reduceMotion
		? { duration: 0 }
		: { duration: PANEL_REVEAL_DURATION * 0.6, ease: PANEL_REVEAL_EASE };

	return (
		<div className="flex h-full min-w-0 flex-1">
			<NewSessionPageLayoutView
				isShort={isShort}
				background={<NewSessionBackground />}
				themedBackground={<ThemedNewSessionBackground />}
				dropZone={(children) => (
					<div
						className={cn(
							"relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background",
							className,
						)}
					>
						{children}
					</div>
				)}
				hero={
					// 命令区向上生长会盖到 hero 上，模式切换与吉祥物会浮在面板前面挡住内容，
					// 因此展开期间把 hero 整块淡出并禁用命中。
					<motion.div
						animate={{ opacity: commandPanelExpanded ? 0 : 1 }}
						transition={heroTransition}
						// hero 是渐变标题 + 吉祥物的大块区域，不提层的话这段 opacity 动画每帧都要
						// 重绘整块。will-change 必须在动画开始前就位才有用，因此常驻。
						style={{ willChange: "opacity" }}
						className={cn(
							// 横向 padding 必须与 InputBarView 根节点的 `px-2 sm:px-4` 一致：
							// 两边都是「全宽容器 + 内层 mx-auto max-w-2xl」，窗口宽到放得下 2xl 时
							// 两者自然对齐，窄到内层被压缩时只有这层 padding 决定左缘，缺了就会
							// 出现 hero/选项行比输入框卡片更靠左的错位。
							"relative z-20 flex w-full flex-col items-center px-2 sm:px-4",
							commandPanelExpanded && "pointer-events-none",
						)}
					>
						<NewSessionHero
							avatarAutoplay={avatarAutoplay}
							greetingTitle={greetingTitle}
							mounted={mounted}
							subtitle={subtitle}
						/>
						{/* 会话前置选项（项目 / 工作模式）与 hero 同淡出：命令区向上生长时会盖到这一行。 */}
						<NewSessionOptionsRow
							creatingProject={preparingProject}
							onSelectPendingProject={onSelectPendingProject}
							onSelectProject={onSelectProject}
							options={projectOptions}
							selection={projectSelection}
							takenNames={projectTakenNames}
						/>
					</motion.div>
				}
				inputBar={
					<motion.div
						className="relative"
						animate={{ y: commandPanelShift ? PANEL_SHIFT_Y : 0 }}
						transition={shiftTransition}
					>
						{/* Drop target is the input card; cwdOverride enables drop before a session exists. */}
						<DefaultInputBarConnector
							onSend={onSend}
							onAbort={onAbort}
							cwdOverride={cwd}
							onExpandedChange={onCommandPanelExpandedChange}
							sendPending={preparingProject ? { label: preparingLabel } : undefined}
						/>
					</motion.div>
				}
			/>
			{/* 会话尚未创建：选中项目时活动面板按项目根取上下文；「对话」与待创建项目没有
			    可浏览目录，传 null 走空态（conversation 根是所有会话工作区的父目录，不展示）。 */}
			<CurrentScenarioActivityPanel
				workspace={createActivityWorkspace(
					activityPanelCwd ?? "new-session:unbound",
					activityPanelCwd,
				)}
			/>
		</div>
	);
}

function EmptyNewSessionBackground(): null {
	return null;
}
