import { motion } from "motion/react";
import { cn } from "@shared/lib/utils";
import { useThemeComponent } from "@vetta/theme-sdk";
import { NewSessionPageLayoutView } from "@vetta/theme-ui/chat";
import { NewSessionBackground } from "./NewSessionBackground";
import { NewSessionHero } from "./NewSessionHero";
import { InputBar } from "../InputBar";
import { SessionDropZone } from "../SessionDropZone";

// 与命令区自身的高度生长同一条弹簧，两者一起动才不显得输入栏在「追」面板。
const PANEL_SHIFT = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.7 };
/** 命令区展开时输入栏下移的距离：面板向上生长，下方留白同步收掉。 */
const PANEL_SHIFT_Y = 120;
/** hero 淡出比位移更快收掉，避免吉祥物在面板前面停留。 */
const HERO_FADE = { duration: 0.15, ease: [0.22, 0.61, 0.36, 1] as const };

interface NewSessionPageViewProps {
	avatarAutoplay: boolean;
	className?: string;
	commandPanelExpanded: boolean;
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
	className,
	commandPanelExpanded,
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

	return (
		<NewSessionPageLayoutView
			isShort={isShort}
			background={<NewSessionBackground />}
			themedBackground={<ThemedNewSessionBackground />}
			dropZone={(children) => (
				<SessionDropZone
					cwdOverride={cwd}
					className={cn(
						"relative flex h-full flex-1 flex-col overflow-hidden bg-background",
						className,
					)}
				>
					{children}
				</SessionDropZone>
			)}
			hero={
				// 命令区向上生长会盖到 hero 上，模式切换与吉祥物会浮在面板前面挡住内容，
				// 因此展开期间把 hero 整块淡出并禁用命中。
				<motion.div
					animate={{ opacity: commandPanelExpanded ? 0 : 1 }}
					transition={HERO_FADE}
					className={cn("flex w-full flex-col items-center", commandPanelExpanded && "pointer-events-none")}
				>
					<NewSessionHero
						avatarAutoplay={avatarAutoplay}
						greetingTitle={greetingTitle}
						mounted={mounted}
						subtitle={subtitle}
					/>
				</motion.div>
			}
			inputBar={
				<motion.div
					animate={{ y: commandPanelExpanded ? PANEL_SHIFT_Y : 0 }}
					transition={PANEL_SHIFT}
				>
					<InputBar
						onSend={onSend}
						onAbort={onAbort}
						cwdOverride={cwd}
						onExpandedChange={onCommandPanelExpandedChange}
					/>
				</motion.div>
			}
		/>
	);
}

function EmptyNewSessionBackground(): null {
	return null;
}
