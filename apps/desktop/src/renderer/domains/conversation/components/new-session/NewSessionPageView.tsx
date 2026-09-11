import { CurrentScenarioActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "@shared/lib/utils";
import { useThemeComponent } from "@vetta/theme-sdk";
import type { NewSessionHeroIdentity } from "@vetta/theme-ui";
import { NewSessionPageLayoutView } from "@vetta/theme-ui/chat";
import {
	PANEL_REVEAL_DURATION,
	PANEL_REVEAL_EASE,
	PANEL_REVEAL_TRANSITION,
} from "../command-panel/constants";
import { NewSessionBackground } from "./NewSessionBackground";
import { NewSessionHero } from "./NewSessionHero";
import { NewSessionContextBlock } from "./NewSessionContextBlock";
import type { NewSessionContextBlockModel } from "./useNewSessionContextBlock";
import { NewSessionOptionsRow } from "./NewSessionOptionsRow";
import { NewSessionProjectSelector } from "./project-selector/NewSessionProjectSelector";
import type { ProjectOption, ProjectSelection } from "./project-selector/project-selection";
import { shouldStackProjectSelector } from "./options-row-layout";
import { useSlotWidth } from "./useSlotWidth";
import { DefaultInputBarConnector } from "../input-bar/DefaultInputBarConnector";
import type { SendInteractionContext } from "../input-bar/types";
import { useActiveSessionRuntimeIds } from "@shared/workspace/active-session-runtime";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import { TeamComposerConnector } from "../../connectors/team/TeamComposerConnector";
import type { TeamChatActions, TeamChatViewModel } from "../../connectors/team/teamChatModel";
import { isTeamTarget, type NewSessionTargetKey } from "./target";


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
	/** 选中的智能体/团队身份；null 时 hero 展示问候语。 */
	heroIdentity: NewSessionHeroIdentity | null;
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
	targetKey: NewSessionTargetKey | null;
	onSelectTarget: (targetKey: NewSessionTargetKey | null) => void;
	teamComposer: { readonly model: TeamChatViewModel | null; readonly actions: TeamChatActions | null };
	/** 插件上下文区：由选中的目标或输入框里提到的能力唤起。 */
	contextBlock: NewSessionContextBlockModel;
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
	heroIdentity,
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
	targetKey,
	onSelectTarget,
	contextBlock,
	teamComposer,
	subtitle,
}: NewSessionPageViewProps): JSX.Element {
	const activeRuntimeIds = useActiveSessionRuntimeIds();
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
	// 选项行放不下三枚 chip 时，把项目选择器挪到输入框下方。测的是 hero 插槽而非窗口宽度：
	// 侧边栏/活动面板展开同样会压窄这一列。未测量（width === null）先按宽版渲染，
	// 与装饰件相反——这一枚是功能入口，宁可多测一帧位置也不能有一帧点不到。
	const optionsSlot = useSlotWidth();
	const stackProjectSelector = shouldStackProjectSelector(optionsSlot.width);
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
						ref={optionsSlot.ref}
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
							identity={heroIdentity}
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
							targetKey={targetKey}
							onSelectTarget={onSelectTarget}
							showProjectSelector={!stackProjectSelector}
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
						{isTeamTarget(targetKey) ? (
							teamComposer.model && teamComposer.actions ? (
								<TeamComposerConnector
									model={teamComposer.model}
									actions={teamComposer.actions}
									onExpandedChange={onCommandPanelExpandedChange}
								/>
							) : (
								<div
									role="status"
									aria-busy="true"
									className="mx-auto flex h-[136px] w-full max-w-2xl items-center justify-center rounded-xl border border-border bg-card/80 px-4 text-sm text-muted-foreground shadow-sm"
								>
									{teamComposer.model?.error ?? t("newSession.agentSelector.loading")}
								</div>
							)
						) : (
							<DefaultInputBarConnector
								onSend={onSend}
								onAbort={onAbort}
								cwdOverride={cwd}
								onExpandedChange={onCommandPanelExpandedChange}
								sendPending={preparingProject ? { label: preparingLabel } : undefined}
							/>
						)}
						{/* 窄插槽下的项目选择器：跟着输入栏一起位移，横向留白与输入框卡片对齐
						    （`px-2 sm:px-4` + 内层 `max-w-2xl`），保证它的左缘压在卡片左缘上。 */}
						{stackProjectSelector && (
							<div className="px-2 sm:px-4">
								<div className="mx-auto mt-2 flex w-full max-w-2xl items-center">
									<NewSessionProjectSelector
										selection={projectSelection}
										options={projectOptions}
										takenNames={projectTakenNames}
										creating={preparingProject}
										onSelectProject={onSelectProject}
										onSelectPendingProject={onSelectPendingProject}
									/>
								</div>
							</div>
						)}
					</motion.div>
				}
				landing={
					/* 没有贡献上屏时连槽位都不给：空着也占一份下边距，输入栏会跟着挪一下。 */
					contextBlock.contexts.length === 0 ? undefined : (
					/* 插件上下文区走布局的落地槽：它跟着内容长高，留在输入栏那一格里会把
					   输入框整体往上顶。窄屏下的项目选择器仍在输入栏那格，所以它天然排在
					   「选项目」之后，不会把这一步挤到内容底下。
					   命令区展开时整块让位：那是打断式交互。 */
					<div className="px-2 sm:px-4">
						{/* `wide` 的贡献（画廊、素材墙）占页面宽度的八成：压回输入框那 672px，
						    每一项都会小到看不清。八成只在宽屏成立——窄窗口上两侧各让出一成
						    等于把本来就不够的宽度再砍一刀，所以窄屏铺满。 */}
						<div
							className={cn(
								"mx-auto w-full",
								contextBlock.contexts[0]?.contribution.width === "wide"
									? "w-full max-w-none md:w-11/12 xl:w-4/5"
									: "max-w-2xl",
							)}
						>
							<NewSessionContextBlock
								contexts={contextBlock.contexts}
								renderContext={contextBlock.renderContext}
								hidden={commandPanelExpanded}
							/>
						</div>
					</div>
					)
				}
			/>
			{/* 会话尚未创建：选中项目时活动面板按项目根取上下文；「对话」与待创建项目没有
			    可浏览目录，传 null 走空态（conversation 根是所有会话工作区的父目录，不展示）。 */}
			<CurrentScenarioActivityPanel
				workspace={createActivityWorkspace(
					activityPanelCwd ?? "new-session:unbound",
					activityPanelCwd,
					activeRuntimeIds,
				)}
			/>
		</div>
	);
}

function EmptyNewSessionBackground(): null {
	return null;
}
