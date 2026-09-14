import { cn } from "@vetta-org/ui";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type JSX } from "react";

const DEFAULT_ROTATE_MS = 4000;
const SLIDE = { duration: 0.28, ease: [0.22, 0.61, 0.36, 1] as const };

export interface InputBarPlaceholderClassNames {
	/** 当前展示的文案节点 */
	text?: string;
}

export interface InputBarPlaceholderProps {
	/** Host 已完成 i18n 解析的文案；仅 1 条时不轮播 */
	texts: readonly string[];
	/** 输入框无任何字符时展示（含空格即应 false，与原生 placeholder 一致） */
	visible: boolean;
	/** 多条文案时是否自动上下切换（suggestion / thinking 等静态态应关） */
	rotating?: boolean;
	/** 轮播间隔，默认 4000ms */
	intervalMs?: number;
	className?: string;
	classNames?: InputBarPlaceholderClassNames;
}

/**
 * 输入框占位文案纯视图：覆盖在 textarea 上，不可选中、不拦截点击。
 * 文案与是否轮播由 host model 决定；本组件不访问 store / i18n。
 */
export function InputBarPlaceholder({
	texts,
	visible,
	rotating = true,
	intervalMs = DEFAULT_ROTATE_MS,
	className,
	classNames,
}: InputBarPlaceholderProps): JSX.Element | null {
	const [index, setIndex] = useState(0);
	const safeTexts = useMemo(
		() => texts.filter((item) => typeof item === "string" && item.length > 0),
		[texts],
	);
	const canRotate = rotating && safeTexts.length > 1;
	const textsKey = safeTexts.join("\0");

	useEffect(() => {
		setIndex(0);
	}, [textsKey]);

	useEffect(() => {
		if (!visible || !canRotate) return;
		const id = window.setInterval(() => {
			setIndex((i) => (i + 1) % safeTexts.length);
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [visible, canRotate, safeTexts.length, intervalMs]);

	if (!visible || safeTexts.length === 0) return null;

	const text = safeTexts[index % safeTexts.length] ?? safeTexts[0];

	return (
		<div
			className={cn("pointer-events-none absolute inset-0 overflow-hidden select-none", className)}
			aria-hidden
		>
			<AnimatePresence mode="wait" initial={false}>
				<motion.span
					key={`${index}-${text}`}
					initial={canRotate ? { opacity: 0, y: 10 } : false}
					animate={{ opacity: 1, y: 0 }}
					exit={canRotate ? { opacity: 0, y: -10 } : undefined}
					transition={SLIDE}
					className={cn(
						"absolute inset-0 truncate text-[13.5px] leading-[1.6] text-muted-foreground/45 select-none",
						classNames?.text,
					)}
				>
					{text}
				</motion.span>
			</AnimatePresence>
		</div>
	);
}
