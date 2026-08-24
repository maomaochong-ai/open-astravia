import { ActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@shared/lib/utils";
import { useThemeComponent } from "@astravia/theme-sdk";
import { NewSessionPageLayoutView, type NewSessionSelection, type NewSessionSkillItem } from "@astravia/theme-ui/chat";
import {
	PANEL_REVEAL_DURATION,
	PANEL_REVEAL_EASE,
	PANEL_REVEAL_TRANSITION,
} from "../command-panel/constants";
import { KineticGrid } from "@shared/components/ui/kinetic-grid";
import { NewSessionHero } from "./NewSessionHero";
import { SkillBadgeRow } from "./SkillBadgeRow";
import { InputBar } from "../InputBar";


/** 命令区展开时输入栏下移的距离：面板向上生长，下方留白同步收掉。 */
const PANEL_SHIFT_Y = 120;

interface NewSessionPageViewProps {
	avatarAutoplay: boolean;
	skillBadges: {
		onSelect: (skill: NewSessionSkillItem) => void;
		selected: NewSessionSelection;
		skills: readonly NewSessionSkillItem[];
	};
	className?: string;
	commandPanelExpanded: boolean;
	commandPanelShift: boolean;
	cwd: string;
	greetingTitle: string;
	isShort: boolean;
	mounted: boolean;
	onAbort: () => Promise<void>;
	onCommandPanelExpandedChange: (expanded: boolean) => void;
	onSend: () => Promise<void>;
	subtitle: string;
}

export function NewSessionPageView({
	avatarAutoplay,
	skillBadges,
	className,
	commandPanelExpanded,
	commandPanelShift,
	cwd,
	greetingTitle,
	isShort,
	mounted,
	onAbort,
	onCommandPanelExpandedChange,
	onSend,
	subtitle,
}: NewSessionPageViewProps): JSX.Element {
	const ThemedNewSessionBackground = useThemeComponent(
		"chat.newSessionBackground",
		EmptyNewSessionBackground,
	);
	const reduceMotion = useReducedMotion();
	// hero 淡出、输入栏位移、命令区揭幕三条动画同时跑，共用同一条曲线：各跑各的弹簧时
	// 长度不一致，掉帧时能明显看出它们互相在「追」。
	const shiftTransition = reduceMotion ? { duration: 0 } : PANEL_REVEAL_TRANSITION;
	// hero 仍比位移收得更快：吉祥物层级高于输入栏，淡得慢会在面板前面停留一下。
	const heroTransition = reduceMotion
		? { duration: 0 }
		: { duration: PANEL_REVEAL_DURATION * 0.6, ease: PANEL_REVEAL_EASE };

	return (
		<div className="flex h-full min-w-0 flex-1 gap-2 overflow-visible">
			<NewSessionPageLayoutView
				isShort={isShort}
				background={<KineticGrid />}
				themedBackground={<ThemedNewSessionBackground />}
				dropZone={(children) => (
					<div
						className={cn("relative flex h-full flex-1 flex-col overflow-hidden bg-background", className)}
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
							"relative z-20 flex w-full flex-col items-center",
							commandPanelExpanded && "pointer-events-none",
						)}
					>
						<NewSessionHero
							avatarAutoplay={avatarAutoplay}
							greetingTitle={greetingTitle}
							mounted={mounted}
							subtitle={subtitle}
						/>
				</motion.div>
				}
				skillBadges={
					// 面板展开会盖住徽章行，与 hero 同曲线淡出并禁用命中。
					<motion.div
						animate={{ opacity: commandPanelExpanded ? 0 : 1 }}
						transition={heroTransition}
						style={{ willChange: "opacity" }}
						className={cn("relative z-10", commandPanelExpanded && "pointer-events-none")}
					>
						<SkillBadgeRow
							onSelect={skillBadges.onSelect}
							selected={skillBadges.selected}
							skills={skillBadges.skills}
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
						<InputBar
							onSend={onSend}
							onAbort={onAbort}
							cwdOverride={cwd}
							onExpandedChange={onCommandPanelExpandedChange}
						/>
					</motion.div>
				}
			/>
			{/* 新建会话页与聊天页一致：活动面板常驻挂载，顶栏「活动面板」按钮切换其开合。
			    cwd 用路由参数（activeSession 在新建会话页被清空），保证 tab 记忆与数据库标签可用。 */}
			<ActivityPanel cwd={cwd} />
		</div>
	);
}

function EmptyNewSessionBackground(): null {
	return null;
}
