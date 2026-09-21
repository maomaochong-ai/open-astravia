import { memo, useCallback, useEffect, useRef, useState, type JSX } from "react";
import { AnimatePresence, motion, useAnimation } from "motion/react";

type AvatarMood = "idle" | "left" | "right" | "think" | "blink" | "bounce" | "sleep";

const ACTIVE_MOODS: AvatarMood[] = ["left", "right", "think", "blink", "bounce", "sleep"];

const HOLD_MS: Record<Exclude<AvatarMood, "idle">, number> = {
	left: 700,
	right: 700,
	think: 900,
	blink: 320,
	bounce: 760,
	sleep: 1500,
};

interface SizeConfig {
	wrapper: string;
	wrapperPx: number;
	body: string;
	eye: string;
	gap: string;
	shadow: string;
	bubble: string;
	glowInset: string;
	glowBlur: string;
	factor: number;
}

const SIZES: Record<"sm" | "md" | "lg", SizeConfig> = {
	sm: {
		wrapper: "h-5 w-5",
		wrapperPx: 20,
		body: "h-5 w-5 rounded-md",
		eye: "h-[3px] w-[3px]",
		gap: "gap-[3px]",
		shadow: "shadow-[0_2px_6px_-2px_var(--primary)]",
		bubble: "h-1.5 w-1.5 -right-1 -top-1",
		glowInset: "-inset-1",
		glowBlur: "blur-[6px]",
		factor: 1,
	},
	md: {
		wrapper: "h-10 w-10",
		wrapperPx: 40,
		body: "h-10 w-10 rounded-[12px]",
		eye: "h-1.5 w-1.5",
		gap: "gap-1.5",
		shadow: "shadow-[0_6px_18px_-6px_var(--primary)]",
		bubble: "h-2 w-2 -right-1 -top-1",
		glowInset: "-inset-2",
		glowBlur: "blur-[12px]",
		factor: 2,
	},
	lg: {
		wrapper: "h-16 w-16",
		wrapperPx: 64,
		body: "h-16 w-16 rounded-[20px]",
		eye: "h-2.5 w-2.5",
		gap: "gap-2.5",
		shadow: "shadow-[0_12px_32px_-8px_var(--primary)]",
		bubble: "h-3 w-3 -right-1.5 -top-1.5",
		glowInset: "-inset-3",
		glowBlur: "blur-[18px]",
		factor: 3,
	},
};

interface BotAvatarProps {
	/** When true, plays an idle "streaming" glow halo and triggers random gestures. */
	active?: boolean;
	/** When true, randomly cycles gestures regardless of `active`. Useful on Welcome. */
	autoplay?: boolean;
	/**
	 * Screensaver-style pacing: the avatar jumps to random positions within its
	 * parent container, pausing at each position to play a random gesture.
	 * DESIGN.md §5.3 exception — decorative continuous bouncing is intentional.
	 */
	pacing?: boolean;
	size?: "sm" | "md" | "lg";
	className?: string;
	/** Optional click override; default: trigger a random gesture. */
	onClick?: () => void;
	title?: string;
}

export const BotAvatar = memo(function BotAvatar({
	active = false,
	autoplay = false,
	pacing = false,
	size = "sm",
	className = "",
	onClick,
	title = "戳一下",
}: BotAvatarProps): JSX.Element {
	const cfg = SIZES[size];
	const [mood, setMood] = useState<AvatarMood>("idle");
	const [, forceTick] = useState(0);
	const lastPlayedRef = useRef<AvatarMood>("idle");

	// --- Pacing state ---
	const [pacingDirection, setPacingDirection] = useState<"left" | "right" | "idle">("idle");
	const containerWidthRef = useRef(0);
	const cycleRef = useRef<ReturnType<typeof setTimeout>[]>([]);
	const pacingRef = useRef(false);
	pacingRef.current = pacing;
	const currentXRef = useRef(0);
	const bounceControls = useAnimation();

	const containerRefCallback = useCallback((el: HTMLDivElement | null) => {
		if (!el) return;
		const parent = el.parentElement;
		if (!parent) return;
		containerWidthRef.current = parent.clientWidth;
		const ro = new ResizeObserver((entries) => {
			for (const entry of entries) {
				containerWidthRef.current = entry.contentRect.width;
			}
		});
		ro.observe(parent);
	}, []);

	const shouldSchedule = !pacing && (active || autoplay);

	const pickRandomMood = useCallback((): AvatarMood => {
		const choices = ACTIVE_MOODS.filter((m) => m !== lastPlayedRef.current);
		return choices[Math.floor(Math.random() * choices.length)] ?? "blink";
	}, []);

	const triggerMood = useCallback((m: AvatarMood) => {
		lastPlayedRef.current = m;
		setMood(m);
		forceTick((t) => t + 1);
	}, []);

	useEffect(() => {
		if (mood === "idle") return;
		const id = setTimeout(() => setMood("idle"), HOLD_MS[mood]);
		return () => clearTimeout(id);
	}, [mood]);

	useEffect(() => {
		if (!shouldSchedule || mood !== "idle") return;
		const id = setTimeout(
			() => triggerMood(pickRandomMood()),
			280 + Math.random() * 420,
		);
		return () => clearTimeout(id);
	}, [shouldSchedule, mood, triggerMood, pickRandomMood]);

	useEffect(() => {
		if (!shouldSchedule) setMood("idle");
	}, [shouldSchedule]);

	// --- Pacing cycle: screensaver-style random jumping ---
	const f = cfg.factor;
	useEffect(() => {
		if (!pacing) return;

		const jump = async () => {
			if (!pacingRef.current) return;
			const maxOff = Math.max(0, containerWidthRef.current - cfg.wrapperPx);
			const target = maxOff > 0 ? Math.random() * maxOff : 0;
			const currentX = currentXRef.current;
			const distance = Math.abs(target - currentX);
			setPacingDirection(target > currentX ? "right" : "left");

			// 抛物线踱步：x 线性补间，y 同时做 bounce
			const hopDuration = Math.min(0.9, 0.35 + distance / 400);
			await bounceControls.start({
				x: target,
				y: [0, -12 * f, 0],
				transition: {
					x: { duration: hopDuration, ease: "easeInOut" },
					y: { duration: hopDuration, ease: "easeOut", times: [0, 0.5, 1] },
				},
			} as Parameters<typeof bounceControls.start>[0]);
			currentXRef.current = target;

			// Clear direction after landing
			const t1 = setTimeout(() => setPacingDirection("idle"), 300);

			// Pick and play random mood
			const choices = ACTIVE_MOODS.filter((m) => m !== lastPlayedRef.current);
			const m = (choices[Math.floor(Math.random() * choices.length)] ?? "blink") as Exclude<AvatarMood, "idle">;
			lastPlayedRef.current = m;
			setMood(m);
			forceTick((t) => t + 1);

			// Schedule next jump after mood finishes
			const t2 = setTimeout(() => {
				if (pacingRef.current) void jump();
			}, HOLD_MS[m] + 800 + Math.random() * 400);

			cycleRef.current.push(t1, t2);
		};

		void jump();

		return () => {
			for (const id of cycleRef.current) clearTimeout(id);
			cycleRef.current = [];
		};
	}, [pacing, cfg.wrapperPx, f]); // eslint-disable-line react-hooks/exhaustive-deps

	// Reset position when pacing is disabled
	useEffect(() => {
		if (!pacing) {
			currentXRef.current = 0;
			bounceControls.set({ x: 0, y: 0 });
			setPacingDirection("idle");
		}
	}, [pacing]); // eslint-disable-line react-hooks/exhaustive-deps

	const handleClick = useCallback(() => {
		if (onClick) {
			onClick();
			return;
		}
		triggerMood(pickRandomMood());
	}, [onClick, triggerMood, pickRandomMood]);

	const dirRotate = pacingDirection === "right" ? 8 : pacingDirection === "left" ? -8 : 0;
	const headAnim = (() => {
		switch (mood) {
			case "left":
				return { rotate: -10 + dirRotate, scale: 1, y: 0, scaleX: 1, scaleY: 1 };
			case "right":
				return { rotate: 10 + dirRotate, scale: 1, y: 0, scaleX: 1, scaleY: 1 };
			case "think":
				return {
					rotate: dirRotate !== 0 ? dirRotate : [0, 5, -5, 0],
					y: [0, -1.5 * f, 0, -1 * f, 0],
					scaleX: 1,
					scaleY: 1,
				};
			case "blink":
				return { rotate: dirRotate, scale: [1, 0.96, 1], y: 0 };
			case "bounce":
				return {
					rotate: dirRotate,
					y: [0, -8 * f, 0, -2 * f, 0],
					scaleX: [1, 0.92, 1.28, 0.96, 1],
					scaleY: [1, 1.18, 0.72, 1.08, 1],
				};
			case "sleep":
				return {
					rotate: -6 + dirRotate,
					y: [0, -0.5 * f, 0, -0.5 * f, 0],
					scaleX: 1,
					scaleY: 1,
				};
			default:
				return { rotate: dirRotate, scale: 1, y: 0, scaleX: 1, scaleY: 1 };
		}
	})();

	const eyesShift = mood === "left" ? -1.4 * f : mood === "right" ? 1.4 * f : 0;
	const eyesScaleY =
		mood === "blink"
			? [1, 0.1, 1]
			: mood === "sleep"
				? [1, 0.1, 0.1, 0.1, 1]
				: 1;
	const showThoughtBubble = mood === "think";
	const showSleepZ = mood === "sleep";

	const button = (
		<button
			type="button"
			onClick={handleClick}
			title={title}
			className={`no-drag relative flex shrink-0 items-center justify-center focus:outline-none ${cfg.wrapper} ${className}`}
		>
			{active && (
				<motion.span
					aria-hidden
					className={`absolute ${cfg.glowInset} rounded-[20px] bg-primary/30 ${cfg.glowBlur}`}
					animate={{ opacity: [0.35, 0.65, 0.35], scale: [0.95, 1.05, 0.95] }}
					transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
				/>
			)}
			<motion.div
				className={`relative flex items-center justify-center ${cfg.body} bg-gradient-to-br from-primary to-primary/85 text-primary-foreground ${cfg.shadow}`}
				animate={headAnim}
				transition={{
					type:
						mood === "think" || mood === "blink" || mood === "bounce" || mood === "sleep"
							? "tween"
							: "spring",
					stiffness: 280,
					damping: 16,
					duration:
						mood === "bounce"
							? 0.7
							: mood === "sleep"
								? 1.4
								: mood === "think"
									? 0.8
									: mood === "blink"
										? 0.32
										: undefined,
					ease: mood === "bounce" ? "easeOut" : "easeInOut",
					times: mood === "bounce" ? [0, 0.28, 0.55, 0.8, 1] : undefined,
				}}
				style={{ transformOrigin: mood === "bounce" ? "50% 100%" : "50% 50%" }}
			>
				<div className={`flex items-center ${cfg.gap}`}>
					{/* Multi-keyframe scaleY (blink/sleep) must use tween — spring only allows 2 keyframes.
					    默认白眼；黑白主题深色经 .bot-avatar-eye 覆盖为灰。 */}
					<motion.span
						className={`bot-avatar-eye block rounded-full bg-white ${cfg.eye}`}
						animate={{ x: eyesShift, scaleY: eyesScaleY }}
						transition={{
							type: mood === "blink" || mood === "sleep" ? "tween" : "spring",
							stiffness: 380,
							damping: 22,
							duration:
								mood === "blink" ? 0.3 : mood === "sleep" ? 1.4 : undefined,
							ease: "easeInOut",
						}}
					/>
					<motion.span
						className={`bot-avatar-eye block rounded-full bg-white ${cfg.eye}`}
						animate={{ x: eyesShift, scaleY: eyesScaleY }}
						transition={{
							type: mood === "blink" || mood === "sleep" ? "tween" : "spring",
							stiffness: 380,
							damping: 22,
							duration:
								mood === "blink" ? 0.3 : mood === "sleep" ? 1.4 : undefined,
							ease: "easeInOut",
						}}
					/>
				</div>
			</motion.div>
			<AnimatePresence>
				{showThoughtBubble && (
					<motion.span
						aria-hidden
						className={`pointer-events-none absolute rounded-full bg-primary/70 ${cfg.bubble}`}
						initial={{ opacity: 0, scale: 0.4, y: 0 }}
						animate={{
							opacity: [0, 1, 0],
							scale: [0.4, 1, 0.7],
							y: [-1 * f, -5 * f, -8 * f],
						}}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.9, ease: "easeOut" }}
					/>
				)}
				{showSleepZ && (
					<motion.span
						key="sleep-z"
						aria-hidden
						className="pointer-events-none absolute select-none font-bold leading-none text-primary/75"
						style={{
							right: -2 * f,
							top: -2 * f,
							fontSize: size === "lg" ? 13 : size === "md" ? 10 : 7,
						}}
						initial={{ opacity: 0, scale: 0.4, y: 0 }}
						animate={{
							opacity: [0, 1, 1, 0],
							scale: [0.4, 1, 1.05, 0.8],
							y: [0, -3 * f, -7 * f, -11 * f],
							x: [0, 1 * f, -1 * f, 1 * f],
						}}
						// 退场必须自带有限 transition：否则会继承下方的 repeat: Infinity，
						// 退场永远结束不了，「z」不卸载并一直以 60fps 驱动整窗重绘。
						exit={{ opacity: 0, transition: { duration: 0.2 } }}
						transition={{
							duration: 1.4,
							ease: "easeOut",
							repeat: Infinity,
							repeatDelay: 0.1,
						}}
					>
						z
					</motion.span>
				)}
			</AnimatePresence>
		</button>
	);

	if (!pacing) return button;

	return (
		<motion.div
			ref={containerRefCallback}
			className="relative flex items-center"
			animate={bounceControls}
		>
			{button}
		</motion.div>
	);
});
