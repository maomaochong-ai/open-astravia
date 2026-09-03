import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { motion, useMotionValue, useReducedMotion } from "motion/react";
import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMascotSlot } from "./useMascotSlot";

const FERRET_VIDEO_SOURCES = {
	blink: "./new-session/ferret-blink.webm",
	crawl: "./new-session/ferret-crawl.webm",
	wave: "./new-session/ferret-wave.webm",
} as const;
const MASCOT_ACTIONS = ["blink", "wave", "crawl"] as const;
const CRAWL_DURATION_SECONDS = 10.066;
const CRAWL_START_PAUSE_SECONDS = 3;
const CENTER_POSITION = "calc(50% - 4.5rem)";
const RIGHT_POSITION = "calc(100% - 9rem)";
const MASCOT_VISIBLE_STORAGE_KEY = "vetta-new-session-mascot-visible";
const HOUR_IN_MILLISECONDS = 60 * 60 * 1_000;
const MINIMUM_ACTION_INTERVAL = HOUR_IN_MILLISECONDS;
const MAXIMUM_ACTION_INTERVAL = HOUR_IN_MILLISECONDS * 3;

type MascotAction = (typeof MASCOT_ACTIONS)[number];

interface NewSessionMascotProps {
	autoplay: boolean;
	mounted: boolean;
}

export function NewSessionMascot({ autoplay, mounted }: NewSessionMascotProps): JSX.Element {
	const { t } = useTranslation("chat");
	const reduceMotion = useReducedMotion();
	const [action, setAction] = useState<MascotAction>(() => pickRandomAction());
	const [mascotVisible, setMascotVisible] = useState(readMascotVisible);
	const [playing, setPlaying] = useState(false);
	// 页面被压窄（窗口小、活动面板/侧边栏展开）时插槽放不下素材，整块吉祥物连同显隐按钮一起不渲染。
	const slot = useMascotSlot();

	const handleComplete = useCallback(() => {
		setAction((current) => pickRandomAction(current));
		setPlaying(false);
	}, []);
	const handlePlayOnce = useCallback(() => {
		setPlaying(true);
	}, []);

	useEffect(() => {
		if (!slot.visible || !mascotVisible || !autoplay || reduceMotion || playing) return;

		const timer = window.setTimeout(() => {
			setPlaying(true);
		}, randomActionInterval());

		return () => window.clearTimeout(timer);
	}, [autoplay, mascotVisible, playing, reduceMotion, slot.visible]);

	const handleVisibilityToggle = useCallback(() => {
		setMascotVisible((current) => {
			const next = !current;
			window.localStorage.setItem(MASCOT_VISIBLE_STORAGE_KEY, String(next));
			return next;
		});
		setPlaying(false);
	}, []);

	const canPlay = slot.visible && mascotVisible && autoplay && !reduceMotion;
	const actionPlaying = canPlay && playing;

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: mounted ? 1 : 0 }}
			transition={{ duration: 0.5, delay: 0.2 }}
			// 锚在 hero 根节点上、往下越过「hero mb-3(12) + 选项行 h-7(28) + 行 mb-4(16)」共 56px，
			// 再往下 19px：素材自带底部留白，这个量让爪子底缘刚好碰到输入框顶边、不进框 → 75px。
			// 选项行尺寸变了要同步这里。
			className="pointer-events-none absolute inset-x-0 -bottom-[75px] z-30 h-20 select-none"
			ref={slot.ref}
		>
			{/* 插槽放不下素材时整块吉祥物（含显隐按钮）不渲染，容器仍在，变宽后自动恢复。 */}
			{slot.visible ? (
				<>
					<Button
						aria-label={t(
							mascotVisible ? "newSession.mascot.hideMascot" : "newSession.mascot.showMascot",
						)}
						className={cn(
							"no-drag pointer-events-auto absolute right-2 z-20 rounded-md border border-border/40 bg-background/80 text-muted-foreground backdrop-blur-sm transition-[top] duration-200",
							mascotVisible ? "-top-5" : "top-11",
						)}
						onClick={handleVisibilityToggle}
						size="icon-xs"
						variant="ghost"
					>
						<span
							aria-hidden
							className={cn(
								"icon-[solar--alt-arrow-down-linear] h-3 w-3 transition-transform duration-200",
								mascotVisible && "rotate-180",
							)}
						/>
					</Button>

					{!mascotVisible ? null : actionPlaying ? (
						action === "crawl" ? (
							<CrawlPass onComplete={handleComplete} />
						) : (
							<video
								aria-hidden="true"
								autoPlay
								className="pointer-events-none absolute right-0 -bottom-6 h-36 w-36 object-contain object-center"
								draggable={false}
								muted
								onEnded={handleComplete}
								playsInline
								preload="auto"
								src={FERRET_VIDEO_SOURCES[action]}
							/>
						)
					) : (
						<>
							<video
								aria-hidden="true"
								// 三个素材首帧的地线实测一致（底部留白 169/576 ≈ 渲染后 42px），
								// 统一偏移：容器底在输入框顶下 19px（容器 -bottom-[75px] − 56px 行高），
								// 42-19≈23px → -bottom-6 时爪子刚好贴边。按动作分档会让随机初始动作
								// 在「悬空/进框」之间跳。
								className="pointer-events-none absolute right-0 -bottom-6 h-36 w-36 object-contain object-center"
								draggable={false}
								muted
								playsInline
								preload="auto"
								src={FERRET_VIDEO_SOURCES[action]}
							/>
							{canPlay ? (
								<Button
									aria-label={t("newSession.mascot.playOnce")}
									className={cn(
										"no-drag pointer-events-auto absolute right-0 z-10 h-20 w-36 bg-transparent p-0 hover:bg-transparent",
										"-bottom-1",
									)}
									onClick={handlePlayOnce}
									variant="ghost"
								>
									<span className="sr-only">{t("newSession.mascot.playOnce")}</span>
								</Button>
							) : null}
						</>
					)}
				</>
			) : null}
		</motion.div>
	);
}

interface CrawlPassProps {
	onComplete: () => void;
}

function CrawlPass({ onComplete }: CrawlPassProps): JSX.Element {
	const [returning, setReturning] = useState(false);
	const returningRef = useRef(false);
	const videoRef = useRef<HTMLVideoElement>(null);
	const animationFrameRef = useRef<number | null>(null);
	const left = useMotionValue(RIGHT_POSITION);

	const updatePosition = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;

		const duration = Number.isFinite(video.duration) ? video.duration : CRAWL_DURATION_SECONDS;
		const moveProgress = Math.min(
			1,
			Math.max(0, (video.currentTime - CRAWL_START_PAUSE_SECONDS) / (duration - CRAWL_START_PAUSE_SECONDS)),
		);
		const rightness = returningRef.current ? moveProgress : 1 - moveProgress;
		left.set(positionForRightness(rightness));

		if (!video.paused && !video.ended) {
			animationFrameRef.current = window.requestAnimationFrame(updatePosition);
		}
	}, [left]);

	const startTracking = useCallback(() => {
		if (animationFrameRef.current !== null) {
			window.cancelAnimationFrame(animationFrameRef.current);
		}
		animationFrameRef.current = window.requestAnimationFrame(updatePosition);
	}, [updatePosition]);

	useEffect(
		() => () => {
			if (animationFrameRef.current !== null) {
				window.cancelAnimationFrame(animationFrameRef.current);
			}
		},
		[],
	);

	const handleEnded = useCallback(
		(event: SyntheticEvent<HTMLVideoElement>) => {
			left.set(returningRef.current ? RIGHT_POSITION : CENTER_POSITION);
			if (returningRef.current) {
				onComplete();
				return;
			}
			returningRef.current = true;
			setReturning(true);
			event.currentTarget.currentTime = 0;
			void event.currentTarget.play();
		},
		[left, onComplete],
	);

	return (
		<motion.video
			aria-hidden="true"
			autoPlay
			// 爬行素材腿部伸展时地线更低（最深帧底部留白 ≈31.5px，静止帧 ≈42px）。
			// 用最深帧对齐输入框顶边（19+12=31），走动全程不进框；起步略悬空是有意取舍。
			className="pointer-events-none absolute -bottom-3 h-36 w-36 object-contain object-center"
			draggable={false}
			muted
			onEnded={handleEnded}
			onPlaying={startTracking}
			playsInline
			preload="auto"
			ref={videoRef}
			src={FERRET_VIDEO_SOURCES.crawl}
			style={{ left, scaleX: returning ? -1 : 1 }}
		/>
	);
}

function pickRandomAction(current?: MascotAction): MascotAction {
	const candidates = current
		? MASCOT_ACTIONS.filter((candidate) => candidate !== current)
		: MASCOT_ACTIONS;
	return candidates[Math.floor(Math.random() * candidates.length)];
}

function randomActionInterval(): number {
	return MINIMUM_ACTION_INTERVAL + Math.random() * (MAXIMUM_ACTION_INTERVAL - MINIMUM_ACTION_INTERVAL);
}

function readMascotVisible(): boolean {
	return window.localStorage.getItem(MASCOT_VISIBLE_STORAGE_KEY) !== "false";
}

function positionForRightness(rightness: number): string {
	const percentage = 50 + rightness * 50;
	const widthOffsetRem = 4.5 + rightness * 4.5;
	return `calc(${percentage}% - ${widthOffsetRem}rem)`;
}
