import { motion } from "motion/react";
import type { NewSessionHeroProps } from "@vetta/theme-ui";
import { cn } from "@vetta/ui";
import type { JSX } from "react";
import { XianxiaSceneCarousel } from "./XianxiaNewSession";

const easeOut = [0.16, 1, 0.3, 1] as const;

/**
 * 修仙主题新会话欢迎区：保留标题 / 副标题 / 场景轮播，不渲染默认 BotAvatar（避免 idle 弹跳手势）。
 */
export function XianxiaNewSessionHero({
	className,
	greetingTitle,
	mounted,
	onSceneClick,
	reserveSceneSlot = false,
	sceneActions,
	sceneLabels,
	scenes,
	selected,
	subtitle,
	// avatarAutoplay 仅默认 BotAvatar 使用，修仙主题不渲染头像。
	avatarAutoplay: _avatarAutoplay,
	...props
}: NewSessionHeroProps): JSX.Element {
	void _avatarAutoplay;
	const showSceneCarousel = scenes.length > 0;
	const showScenePlaceholder = !showSceneCarousel && reserveSceneSlot;

	return (
		<div className={cn("mb-3 flex w-full max-w-2xl flex-col items-start", className)} {...props}>
			<motion.div
				initial={{ opacity: 0, y: 12 }}
				animate={{ opacity: mounted ? 1 : 0, y: mounted ? 0 : 12 }}
				transition={{ duration: 0.5, ease: easeOut }}
				className="flex w-full flex-col items-start"
			>
				<div className="flex w-full min-w-0 flex-col">
					<motion.h1
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.5, delay: 0.1, ease: easeOut }}
						className="bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-[24px] font-semibold tracking-[-0.02em] text-transparent"
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

				{showSceneCarousel && (
					<XianxiaSceneCarousel
						actions={sceneActions}
						labels={sceneLabels}
						onSceneClick={onSceneClick}
						scenes={scenes}
						selected={selected}
					/>
				)}
				{showScenePlaceholder && <div aria-hidden className="mt-6 w-full min-h-[5.75rem]" />}
			</motion.div>
		</div>
	);
}
