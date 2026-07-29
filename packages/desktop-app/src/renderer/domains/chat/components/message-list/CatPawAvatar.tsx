import vettaAvatar from "@shared/assets/vetta-avatar.webp";
import { motion, useReducedMotion } from "motion/react";
import { memo, useCallback, useEffect, useRef, useState, type JSX } from "react";

/**
 * 消息列表猫爪头像动画。
 * 只复用 BotAvatar 里适合整图位图的肢体级手势（歪头 / 弹跳挤压 / 轻晃 / 轻点），
 * 不套用眨眼、思考泡、sleep-z 等依赖「方块+眼睛」的表现。
 */
type PawMood = "idle" | "left" | "right" | "wiggle" | "bounce" | "nudge";

const ACTIVE_MOODS: PawMood[] = ["left", "right", "wiggle", "bounce", "nudge"];

const HOLD_MS: Record<Exclude<PawMood, "idle">, number> = {
	left: 700,
	right: 700,
	wiggle: 800,
	bounce: 760,
	nudge: 420,
};

interface CatPawAvatarProps {
	/** 流式输出时开启 idle 手势循环 + 光晕。 */
	active?: boolean;
	className?: string;
}

export const CatPawAvatar = memo(function CatPawAvatar({
	active = false,
	className = "",
}: CatPawAvatarProps): JSX.Element {
	const reduceMotion = useReducedMotion();
	const [mood, setMood] = useState<PawMood>("idle");
	const [, forceTick] = useState(0);
	const lastPlayedRef = useRef<PawMood>("idle");

	const pickRandomMood = useCallback((): Exclude<PawMood, "idle"> => {
		const choices = ACTIVE_MOODS.filter((m) => m !== lastPlayedRef.current) as Exclude<
			PawMood,
			"idle"
		>[];
		return choices[Math.floor(Math.random() * choices.length)] ?? "nudge";
	}, []);

	const triggerMood = useCallback((m: Exclude<PawMood, "idle">) => {
		lastPlayedRef.current = m;
		setMood(m);
		forceTick((t) => t + 1);
	}, []);

	useEffect(() => {
		if (mood === "idle" || reduceMotion) return;
		const id = setTimeout(() => setMood("idle"), HOLD_MS[mood]);
		return () => clearTimeout(id);
	}, [mood, reduceMotion]);

	// 仅流式时自动循环；完成后保持静止（仍可点击）。
	useEffect(() => {
		if (reduceMotion || !active || mood !== "idle") return;
		const id = setTimeout(() => triggerMood(pickRandomMood()), 280 + Math.random() * 420);
		return () => clearTimeout(id);
	}, [active, mood, reduceMotion, triggerMood, pickRandomMood]);

	useEffect(() => {
		if (!active) setMood("idle");
	}, [active]);

	const handleClick = useCallback(() => {
		if (reduceMotion) return;
		triggerMood(pickRandomMood());
	}, [reduceMotion, triggerMood, pickRandomMood]);

	const anim = (() => {
		if (reduceMotion) return { rotate: 0, y: 0, scaleX: 1, scaleY: 1, scale: 1 };
		switch (mood) {
			case "left":
				return { rotate: -12, y: 0, scaleX: 1, scaleY: 1, scale: 1 };
			case "right":
				return { rotate: 12, y: 0, scaleX: 1, scaleY: 1, scale: 1 };
			case "wiggle":
				return {
					rotate: [0, 8, -8, 5, 0],
					y: [0, -1, 0, -0.5, 0],
					scaleX: 1,
					scaleY: 1,
					scale: 1,
				};
			case "bounce":
				// 与 BotAvatar bounce 同节奏的落地挤压，位图同样成立。
				return {
					rotate: 0,
					y: [0, -8, 0, -2, 0],
					scaleX: [1, 0.92, 1.28, 0.96, 1],
					scaleY: [1, 1.18, 0.72, 1.08, 1],
					scale: 1,
				};
			case "nudge":
				// 替代 blink：整图轻缩，不假装有眼睛。
				return { rotate: 0, y: 0, scale: [1, 0.9, 1.05, 1], scaleX: 1, scaleY: 1 };
			default:
				return { rotate: 0, y: 0, scaleX: 1, scaleY: 1, scale: 1 };
		}
	})();

	const isTween =
		mood === "wiggle" || mood === "bounce" || mood === "nudge";

	return (
		<button
			type="button"
			onClick={handleClick}
			aria-hidden="true"
			tabIndex={-1}
			className={`no-drag relative flex h-5 w-5 shrink-0 items-center justify-center focus:outline-none ${className}`}
		>
			{active && !reduceMotion && (
				<motion.span
					aria-hidden
					className="absolute -inset-1 rounded-md bg-primary/30 blur-[6px]"
					animate={{ opacity: [0.35, 0.65, 0.35], scale: [0.95, 1.05, 0.95] }}
					transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
				/>
			)}
			<motion.img
				src={vettaAvatar}
				alt=""
				draggable={false}
				className="relative h-5 w-5 select-none object-contain"
				animate={anim}
				transition={{
					type: isTween ? "tween" : "spring",
					stiffness: 280,
					damping: 16,
					duration: mood === "bounce" ? 0.7 : mood === "wiggle" ? 0.8 : mood === "nudge" ? 0.36 : undefined,
					ease: mood === "bounce" ? "easeOut" : "easeInOut",
					times: mood === "bounce" ? [0, 0.28, 0.55, 0.8, 1] : undefined,
				}}
				style={{ transformOrigin: mood === "bounce" ? "50% 100%" : "50% 50%" }}
			/>
		</button>
	);
});
