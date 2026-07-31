import { motion } from "motion/react";
import { cn } from "@shared/lib/utils";
import { useThemeComponent } from "@vetta/theme-sdk";
import type {
	NewSessionHeroProps,
	NewSessionSceneActionState,
	NewSessionSceneCarouselLabels,
	NewSessionSceneItem,
} from "@vetta/theme-ui";
import { GuideBadgeSwiper } from "../GuideBadgeSwiper";
import { AgentModeIconToggle } from "./AgentModeIconToggle";
import { easeOut } from "./constants";
import { NewSessionMascot } from "./NewSessionMascot";

interface NewSessionHeroHostProps {
	avatarAutoplay: boolean;
	greetingTitle: string;
	mounted: boolean;
	subtitle: string;
}

// 场景轮播已从新会话页下线；hero 的场景相关 props 仍属于主题公共契约，
// 这里传恒定空值让默认实现与第三方主题都渲染不出场景。
const EMPTY_SCENES: readonly NewSessionSceneItem[] = [];
const EMPTY_SCENE_ACTIONS: Readonly<Record<string, NewSessionSceneActionState>> = {};
const EMPTY_SCENE_LABELS: NewSessionSceneCarouselLabels = { installPrompt: "", next: "", previous: "" };
function noopSceneClick(): void {}

/** Host 入口：解析主题 override，补齐 i18n labels 后交给 public props contract。 */
export function NewSessionHero({
	avatarAutoplay,
	greetingTitle,
	mounted,
	subtitle,
}: NewSessionHeroHostProps): JSX.Element {
	const ThemedHero = useThemeComponent("chat.newSessionHero", DefaultNewSessionHero);

	return (
		<ThemedHero
			avatarAutoplay={avatarAutoplay}
			greetingTitle={greetingTitle}
			mounted={mounted}
			onSceneClick={noopSceneClick}
			reserveSceneSlot={false}
			sceneActions={EMPTY_SCENE_ACTIONS}
			sceneLabels={EMPTY_SCENE_LABELS}
			scenes={EMPTY_SCENES}
			selected={null}
			subtitle={subtitle}
		/>
	);
}

export function DefaultNewSessionHero({
	avatarAutoplay,
	className,
	greetingTitle,
	mounted,
	onSceneClick: _onSceneClick,
	reserveSceneSlot: _reserveSceneSlot,
	sceneActions: _sceneActions,
	sceneLabels: _sceneLabels,
	scenes: _scenes,
	selected: _selected,
	subtitle,
	...props
}: NewSessionHeroProps): JSX.Element {
	return (
		<div className={cn("relative mb-3 flex w-full max-w-2xl flex-col items-start", className)} {...props}>
			<motion.div
				initial={{ opacity: 0, y: 12 }}
				animate={{ opacity: mounted ? 1 : 0, y: mounted ? 0 : 12 }}
				transition={{ duration: 0.5, ease: easeOut }}
				className="flex w-full flex-col items-start"
			>
				{/* 欢迎语上方：引导 badge 轮播 + 工作/编程模式切换 */}
				<GuideBadgeSwiper mounted={mounted} />
				<div className="mb-2 flex items-center">
					<AgentModeIconToggle />
				</div>

				{/* 标题块：问候语 + 副标题（吉祥物改为绝对定位，见下） */}
				<div className="flex w-full min-w-0 flex-col">
					<motion.h1
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.5, delay: 0.1, ease: easeOut }}
						className="min-w-0 truncate bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-[24px] font-semibold tracking-[-0.02em] text-transparent"
					>
						{greetingTitle}
					</motion.h1>
					<motion.p
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ duration: 0.5, delay: 0.2 }}
						className="mt-1 text-[12px] text-muted-foreground/70"
					>
						{subtitle}
					</motion.p>
				</div>
			</motion.div>

			{/* 吉祥物脱离文档流下移，视觉上趴在输入栏顶边上 */}
			<NewSessionMascot autoplay={avatarAutoplay} mounted={mounted} />
		</div>
	);
}
