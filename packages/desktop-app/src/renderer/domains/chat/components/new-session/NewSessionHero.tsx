import { useCallback } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "@shared/lib/utils";
import { useThemeComponent } from "@vetta/theme-sdk";
import type { NewSessionHeroProps, NewSessionSceneItem } from "@vetta/theme-ui";
import { GuideBadgeSwiper } from "../GuideBadgeSwiper";
import { AgentModeIconToggle } from "./AgentModeIconToggle";
import { DefaultSceneCarousel } from "./SceneCarousel";
import { easeOut } from "./constants";
import type { SceneActionState, SceneItem, SkillSelection } from "./types";

interface NewSessionHeroHostProps {
	avatarAutoplay: boolean;
	greetingTitle: string;
	mounted: boolean;
	onSceneClick: (scene: SceneItem) => void;
	reserveSceneSlot?: boolean;
	sceneActions: Record<string, SceneActionState>;
	scenes: SceneItem[];
	selectedSkill: SkillSelection;
	subtitle: string;
}

/** Host 入口：解析主题 override，补齐 i18n labels 后交给 public props contract。 */
export function NewSessionHero({
	avatarAutoplay,
	greetingTitle,
	mounted,
	onSceneClick,
	reserveSceneSlot = false,
	sceneActions,
	scenes,
	selectedSkill,
	subtitle,
}: NewSessionHeroHostProps): JSX.Element {
	const { t } = useTranslation("chat");
	const ThemedHero = useThemeComponent("chat.newSessionHero", DefaultNewSessionHero);
	const handleSceneClick = useCallback(
		(scene: NewSessionSceneItem) => {
			const matched = scenes.find((item) => item.name === scene.name);
			if (matched) {
				onSceneClick(matched);
			}
		},
		[onSceneClick, scenes],
	);

	return (
		<ThemedHero
			avatarAutoplay={avatarAutoplay}
			greetingTitle={greetingTitle}
			mounted={mounted}
			onSceneClick={handleSceneClick}
			reserveSceneSlot={reserveSceneSlot}
			sceneActions={sceneActions}
			sceneLabels={{
				installPrompt: t("newSession.sceneInstallPrompt"),
				next: t("newSession.sceneCarouselNext"),
				previous: t("newSession.sceneCarouselPrev"),
			}}
			scenes={scenes}
			selected={selectedSkill}
			subtitle={subtitle}
		/>
	);
}

export function DefaultNewSessionHero({
	avatarAutoplay: _avatarAutoplay,
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
	...props
}: NewSessionHeroProps): JSX.Element {
	// 继续走 carousel override，避免只覆盖 scene carousel 时被 hero 默认实现绕过。
	const ThemedSceneCarousel = useThemeComponent("chat.newSessionSceneCarousel", DefaultSceneCarousel);
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
				{/* 欢迎语上方的引导 badge 轮播 */}
				<GuideBadgeSwiper mounted={mounted} />

				{/* 标题行：问候语 + 工作模式切换，右侧新会话吉祥物 */}
				<div className="flex w-full items-center justify-between gap-4">
					<div className="flex min-w-0 flex-col">
						<div className="flex min-w-0 items-center gap-2.5">
							<motion.h1
								initial={{ opacity: 0, y: 8 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ duration: 0.5, delay: 0.1, ease: easeOut }}
								className="min-w-0 truncate bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-[24px] font-semibold tracking-[-0.02em] text-transparent"
							>
								{greetingTitle}
							</motion.h1>
							<AgentModeIconToggle />
						</div>
						<motion.p
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={{ duration: 0.5, delay: 0.2 }}
							className="mt-1 text-[12px] text-muted-foreground/70"
						>
							{subtitle}
						</motion.p>
					</div>
					<div aria-hidden="true" className="relative h-16 w-32 shrink-0">
						<span className="absolute inset-x-0 bottom-0 h-px bg-border/80" />
						<img
							alt=""
							className="relative z-10 h-full w-full select-none object-contain object-right"
							draggable={false}
							src="./new-session/ferret.webp"
						/>
					</div>
				</div>
				{showSceneCarousel && (
					<ThemedSceneCarousel
						actions={sceneActions}
						labels={sceneLabels}
						onSceneClick={onSceneClick}
						scenes={scenes}
						selected={selected}
					/>
				)}
				{showScenePlaceholder && (
					<div
						aria-hidden
						className="mt-6 w-full min-h-[5.75rem]"
					/>
				)}
			</motion.div>
		</div>
	);
}
