import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { AchievementUsageStats } from "@preload/api";
import { cn } from "@shared/lib/utils";
import {
	AchievementCurtains,
	AchievementTitle,
} from "@vetta/theme-ui/settings";
import type { Achievement } from "../achievements";
import { ACHIEVEMENT_SCENE_LAYOUT } from "../achievement-scene-layout";
import { ACHIEVEMENT_UI_ASSETS } from "../achievement-ui-assets";
import { AchievementDescriptionCard } from "./AchievementDescriptionCard";
import { AchievementNavigationButton } from "./AchievementNavigationButton";

interface DragState {
	pointerId: number;
	startX: number;
	startScrollLeft: number;
	moved: boolean;
}

interface AchievementCarouselProps {
	achievements: readonly Achievement[];
	currentIndex: number;
	focusSizeEnabled: boolean;
	subtitleKey: string;
	usageStats: AchievementUsageStats;
}

const SNAP_DELAY_MS = 140;
const MIN_SNAP_DURATION_MS = 420;
const MAX_SNAP_DURATION_MS = 650;
const NAVIGATION_DURATION_MS = 240;

type ScrollMode = "instant" | "snap" | "navigation";

function easeInOutCubic(progress: number): number {
	return progress < 0.5
		? 4 * progress * progress * progress
		: 1 - ((-2 * progress + 2) ** 3) / 2;
}

function easeOutCubic(progress: number): number {
	return 1 - (1 - progress) ** 3;
}

export function AchievementCarousel({
	achievements,
	currentIndex,
	focusSizeEnabled,
	subtitleKey,
	usageStats,
}: AchievementCarouselProps): JSX.Element {
	const { t } = useTranslation("settings");
	const reduceMotion = useReducedMotion();
	const trackRef = useRef<HTMLDivElement>(null);
	const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
	const dragRef = useRef<DragState | null>(null);
	const suppressClickRef = useRef(false);
	const animationFrameRef = useRef<number | null>(null);
	const snapTimeoutRef = useRef<number | null>(null);
	const targetIndexRef = useRef(currentIndex);
	const [focusedIndex, setFocusedIndex] = useState(currentIndex);
	const [dragging, setDragging] = useState(false);

	useEffect(() => {
		const frameImages = achievements.map((achievement) => {
			const image = new Image();
			image.src = achievement.frameUrl;
			void image.decode().catch(() => undefined);
			return image;
		});

		return () => {
			for (const image of frameImages) image.src = "";
		};
	}, [achievements]);

	const stopScrolling = useCallback(() => {
		if (animationFrameRef.current !== null) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = null;
		}
		if (snapTimeoutRef.current !== null) {
			window.clearTimeout(snapTimeoutRef.current);
			snapTimeoutRef.current = null;
		}
	}, []);

	const focusAchievement = useCallback((index: number, mode: ScrollMode = "snap") => {
		const track = trackRef.current;
		const item = itemRefs.current[index];
		if (!track || !item) return;
		stopScrolling();
		targetIndexRef.current = index;
		const targetLeft = item.offsetLeft + item.offsetWidth / 2 - track.clientWidth / 2;
		if (mode === "instant") {
			track.scrollLeft = targetLeft;
			setFocusedIndex(index);
			return;
		}

		const startLeft = track.scrollLeft;
		const distance = targetLeft - startLeft;
		const duration = mode === "navigation"
			? NAVIGATION_DURATION_MS
			: Math.min(
				MAX_SNAP_DURATION_MS,
				MIN_SNAP_DURATION_MS + Math.abs(distance) * 0.35,
			);
		const easing = mode === "navigation" ? easeOutCubic : easeInOutCubic;
		const startTime = performance.now();

		const animateScroll = (time: number) => {
			const progress = Math.min((time - startTime) / duration, 1);
			track.scrollLeft = startLeft + distance * easing(progress);
			if (progress < 1) {
				animationFrameRef.current = requestAnimationFrame(animateScroll);
				return;
			}
			animationFrameRef.current = null;
			track.scrollLeft = targetLeft;
			setFocusedIndex(index);
		};

		animationFrameRef.current = requestAnimationFrame(animateScroll);
		setFocusedIndex(index);
	}, [stopScrolling]);

	const findNearestIndex = useCallback((): number => {
		const track = trackRef.current;
		if (!track) return focusedIndex;
		const center = track.scrollLeft + track.clientWidth / 2;
		let nearestIndex = 0;
		let nearestDistance = Number.POSITIVE_INFINITY;
		itemRefs.current.forEach((item, index) => {
			if (!item) return;
			const distance = Math.abs(item.offsetLeft + item.offsetWidth / 2 - center);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestIndex = index;
			}
		});
		return nearestIndex;
	}, [focusedIndex]);

	const snapToNearest = useCallback(() => {
		focusAchievement(findNearestIndex());
	}, [findNearestIndex, focusAchievement]);

	useEffect(() => {
		focusAchievement(currentIndex, "instant");
		return stopScrolling;
	}, [currentIndex, focusAchievement, stopScrolling]);

	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		const track = trackRef.current;
		if (!track || event.button !== 0) return;
		stopScrolling();
		const nearestIndex = findNearestIndex();
		targetIndexRef.current = nearestIndex;
		setFocusedIndex(nearestIndex);
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startScrollLeft: track.scrollLeft,
			moved: false,
		};
		track.setPointerCapture(event.pointerId);
		setDragging(true);
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const track = trackRef.current;
		const drag = dragRef.current;
		if (!track || !drag || drag.pointerId !== event.pointerId) return;
		if (Math.abs(event.clientX - drag.startX) > 4) {
			drag.moved = true;
			suppressClickRef.current = true;
		}
		event.preventDefault();
		track.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startX);
	};

	const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
		const track = trackRef.current;
		const drag = dragRef.current;
		if (!track || !drag || drag.pointerId !== event.pointerId) return;
		dragRef.current = null;
		if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
		setDragging(false);
		if (drag.moved) {
			requestAnimationFrame(snapToNearest);
			window.setTimeout(() => {
				suppressClickRef.current = false;
			}, 0);
		}
	};

	const focusedAchievement = achievements[focusedIndex] ?? achievements[currentIndex];
	const previousDisabled = focusedIndex === 0;
	const nextDisabled = focusedIndex === achievements.length - 1;

	return (
		<div>
			<motion.section
				className="relative mx-auto"
				style={{
					width: `calc(100% - ${ACHIEVEMENT_SCENE_LAYOUT.sceneWidthReduction}px)`,
				}}
				initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.97 }}
				animate={{ opacity: 1, y: 0, scale: 1 }}
				transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
			>
				<div
					aria-hidden="true"
					className="absolute inset-0 overflow-hidden rounded-xl border"
					style={{
						background: "linear-gradient(180deg, #8f1818 0%, #4a0d0d 48%, #210707 100%)",
						borderColor: "#b9893f",
					}}
				/>
				<AchievementCurtains layout={ACHIEVEMENT_SCENE_LAYOUT.curtain} assets={ACHIEVEMENT_UI_ASSETS.curtain} />
				<div className="relative z-10 px-4 pb-6 pt-3">
					<motion.div
						initial={reduceMotion ? false : { opacity: 0, y: -8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.35, delay: 0.08, ease: "easeOut" }}
					>
						<AchievementTitle
							title={t("achievement.title")}
							layout={ACHIEVEMENT_SCENE_LAYOUT.title}
							titleImageUrl={ACHIEVEMENT_UI_ASSETS.title}
							titleTextOffsetY={ACHIEVEMENT_SCENE_LAYOUT.titleTextOffsetY}
						/>
						<p
							className="mt-1 text-center text-[12px]"
							style={{ color: "#d7b7a2" }}
						>
							{t(subtitleKey, { defaultValue: "" })}
						</p>
						<p
							className="mt-1 text-center text-[11px]"
							style={{ color: "#b99482" }}
						>
							{t("achievement.dragHint")}
						</p>
					</motion.div>

					<div
						className="relative mt-2"
						style={{ height: ACHIEVEMENT_SCENE_LAYOUT.badgeAreaHeight }}
					>
						<motion.div
							ref={trackRef}
							className={cn(
								"no-scrollbar flex h-full items-end gap-5 overflow-x-auto px-[calc(50%-96px)] py-4 select-none",
								dragging ? "cursor-grabbing" : "cursor-grab",
							)}
							initial={reduceMotion ? false : { opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.4, delay: 0.14, ease: "easeOut" }}
							onPointerDown={handlePointerDown}
							onPointerMove={handlePointerMove}
							onPointerUp={finishDrag}
							onPointerCancel={finishDrag}
							onScroll={() => {
								if (animationFrameRef.current !== null) return;
								const nearestIndex = findNearestIndex();
								targetIndexRef.current = nearestIndex;
								setFocusedIndex(nearestIndex);
								if (dragRef.current) return;
								if (snapTimeoutRef.current !== null) {
									window.clearTimeout(snapTimeoutRef.current);
								}
								snapTimeoutRef.current = window.setTimeout(() => {
									snapTimeoutRef.current = null;
									snapToNearest();
								}, SNAP_DELAY_MS);
							}}
							onLostPointerCapture={() => {
								dragRef.current = null;
								setDragging(false);
							}}
						>
							{achievements.map((achievement, index) => {
								const reached = index <= currentIndex;
								const focused = focusSizeEnabled && index === focusedIndex;
								return (
									<div
										key={achievement.id}
										ref={(element) => {
											itemRefs.current[index] = element;
										}}
										className="flex w-48 shrink-0 flex-col items-center"
									>
										<button
											type="button"
											className="flex flex-col items-center rounded-xl border border-transparent p-2 outline-none transition-[background-color,opacity,border-color] duration-200 focus-visible:border-ring"
											style={{
												backgroundColor: focused ? "rgba(244, 213, 138, 0.12)" : undefined,
											}}
											onClick={() => {
												if (suppressClickRef.current) return;
												focusAchievement(index);
											}}
											aria-label={t(`achievement.stages.${achievement.id}.name`, {
												defaultValue: achievement.id,
											})}
										>
											<img
												src={achievement.imageUrl}
												alt=""
												draggable={false}
												className={cn(
													"object-contain transition-[width,height,filter,opacity] duration-300",
													focused ? "h-48 w-48" : "h-36 w-36",
													reached ? "grayscale-0 opacity-100" : "grayscale opacity-55",
												)}
											/>
											<span
												className="mt-2 text-center text-[13px] font-medium"
												style={{ color: reached ? "#f4e7d6" : "#ad8c7b" }}
											>
												{t(`achievement.stages.${achievement.id}.name`, {
													defaultValue: achievement.id,
												})}
											</span>
										</button>
									</div>
								);
							})}
						</motion.div>

						<motion.div
							className="pointer-events-none absolute inset-0"
							initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
							animate={{ opacity: 1, scale: 1 }}
							transition={{ duration: 0.35, delay: 0.22, ease: "easeOut" }}
						>
							<AchievementNavigationButton
								disabled={previousDisabled}
								direction="previous"
								label={t("achievement.previous")}
								onClick={() => focusAchievement(
									Math.max(0, targetIndexRef.current - 1),
									"navigation",
								)}
							/>
							<AchievementNavigationButton
								disabled={nextDisabled}
								direction="next"
								label={t("achievement.next")}
								onClick={() => focusAchievement(
									Math.min(achievements.length - 1, targetIndexRef.current + 1),
									"navigation",
								)}
							/>
						</motion.div>
					</div>
				</div>
			</motion.section>

			<motion.div
				className="mt-8"
				initial={reduceMotion ? false : { opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.4, delay: 0.28, ease: "easeOut" }}
			>
				<div className="grid">
					<AnimatePresence initial={false}>
						<motion.div
							key={`${subtitleKey}:${focusedAchievement.id}`}
							className="col-start-1 row-start-1"
							initial={reduceMotion ? false : { opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={reduceMotion ? undefined : { opacity: 0 }}
							transition={{ duration: 0.45, ease: "easeInOut" }}
						>
							<AchievementDescriptionCard
								achievement={focusedAchievement}
								current={focusedIndex === currentIndex}
								index={focusedIndex}
								total={achievements.length}
								usageStats={usageStats}
							/>
						</motion.div>
					</AnimatePresence>
				</div>
			</motion.div>
		</div>
	);
}
