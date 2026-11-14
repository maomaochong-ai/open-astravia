import { cn } from "@astravia-org/ui/utils";
import { motion } from "motion/react";
import {
	type ComponentPropsWithoutRef,
	type JSX,
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
} from "react";

/**
 * SplashPanel 的配套部件：头部（输入框 / 标题）、底栏、提示行、步骤过渡。
 * 多步流程在同一个 Splash 里完成时，每一步只需要换这几块，外壳不动。
 */

const HEADER_CLASS = "relative flex h-12 shrink-0 items-center gap-2.5 px-3.5";

function BackButton({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className="-ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
		>
			<span aria-hidden="true" className="icon-[solar--alt-arrow-left-linear] size-4" />
		</button>
	);
}

export interface SplashInputHeaderProps {
	/** 无返回键时显示在输入框前的图标（iconify 类名）。 */
	readonly icon: string;
	readonly value: string;
	readonly placeholder: string;
	/** 输入框的无障碍名称。 */
	readonly label: string;
	readonly onChange: (value: string) => void;
	/** Enter 提交；输入法组合中的 Enter 是选词，不会触发。 */
	readonly onSubmit?: () => void;
	/** 给了就在输入框前显示返回键（替换图标），用于进入了二级步骤的场景。 */
	readonly onBack?: () => void;
	readonly backLabel?: string;
	readonly disabled?: boolean;
	readonly invalid?: boolean;
	readonly inputRef?: RefObject<HTMLInputElement | null>;
	/** 透传给 input 的其余属性，例如命令面板的 combobox 无障碍属性。 */
	readonly inputProps?: Omit<
		ComponentPropsWithoutRef<"input">,
		"value" | "onChange" | "placeholder" | "disabled" | "aria-label" | "aria-invalid"
	>;
	/** 挂载后自动聚焦，默认开启：进入这一步后的第一个动作就是打字。 */
	readonly autoFocus?: boolean;
}

export function SplashInputHeader({
	icon,
	value,
	placeholder,
	label,
	onChange,
	onSubmit,
	onBack,
	backLabel,
	disabled,
	invalid,
	inputRef,
	inputProps,
	autoFocus = true,
}: SplashInputHeaderProps): JSX.Element {
	const ownRef = useRef<HTMLInputElement | null>(null);
	const ref = inputRef ?? ownRef;
	// 中日文输入法：确认候选词的那下 Enter，keydown 与 compositionend 的先后各引擎不一致，
	// 所以除了 isComposing 再用 compositionend 之后的一小段时间兜底。
	const composingRef = useRef(false);
	const composedAtRef = useRef(0);

	useEffect(() => {
		if (!autoFocus) return;
		const frame = requestAnimationFrame(() => ref.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [autoFocus, ref]);

	return (
		<div className={HEADER_CLASS}>
			{onBack ? (
				<BackButton label={backLabel ?? ""} onClick={onBack} />
			) : (
				<span aria-hidden="true" className={cn(icon, "size-4 shrink-0 text-muted-foreground")} />
			)}
			<input
				{...inputProps}
				ref={ref}
				type="text"
				autoComplete="off"
				spellCheck={false}
				aria-label={label}
				aria-invalid={invalid || undefined}
				disabled={disabled}
				value={value}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
				onCompositionStart={() => {
					composingRef.current = true;
				}}
				onCompositionEnd={() => {
					composingRef.current = false;
					composedAtRef.current = Date.now();
				}}
				onKeyDown={(event) => {
					inputProps?.onKeyDown?.(event);
					if (event.key !== "Enter" || !onSubmit) return;
					if (composingRef.current || event.nativeEvent.isComposing || Date.now() - composedAtRef.current < 80) {
						return;
					}
					onSubmit();
				}}
				className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
			/>
		</div>
	);
}

export interface SplashTitleHeaderProps {
	readonly title: string;
	readonly onBack?: () => void;
	readonly backLabel?: string;
	/** 标题右侧的附加内容，例如当前路径。 */
	readonly trailing?: ReactNode;
	/** title 是面板的标题（大而粗）；plain 用于路径之类的辅助信息，保持常规字重。 */
	readonly variant?: "title" | "plain";
}

/** 没有输入框的步骤用它做头部：与输入头部同高同位，切步骤时外壳不跳。 */
export function SplashTitleHeader({
	title,
	onBack,
	backLabel,
	trailing,
	variant = "title",
}: SplashTitleHeaderProps): JSX.Element {
	return (
		<div className={HEADER_CLASS}>
			{onBack && <BackButton label={backLabel ?? ""} onClick={onBack} />}
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-foreground",
					variant === "title" ? "text-[17px] font-semibold tracking-tight" : "text-[14px]",
				)}
			>
				{title}
			</span>
			{trailing}
		</div>
	);
}

/** 底栏：快捷键提示或主操作按钮。 */
export function SplashFooter({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
	return (
		<div
			className={cn(
				// 唯一保留分隔线的地方，并用与面板不同的底色把操作区托出来。
				"flex min-h-8 shrink-0 items-center gap-3 border-t border-border/60 bg-muted/50 px-3.5 py-1",
				"text-[11px] text-muted-foreground/80",
				className,
			)}
		>
			{children}
		</div>
	);
}

/** 输入下方的一行提示；tone=error 时用红色并作为 alert 播报。 */
export function SplashNotice({
	tone = "muted",
	children,
}: {
	tone?: "muted" | "error";
	children: ReactNode;
}): JSX.Element {
	return (
		<p
			role={tone === "error" ? "alert" : undefined}
			className={cn(
				"whitespace-pre-wrap break-words px-4 py-2.5 text-[12px] leading-snug",
				tone === "error" ? "text-destructive" : "text-muted-foreground",
			)}
		>
			{children}
		</p>
	);
}

/**
 * 步骤切换的淡入：用 stepKey 区分步骤。只做入场，不做离场——
 * 离场动画要同时保留两步的 DOM，在高度不同的两步之间会让面板抖动。
 */
export function SplashStep({ stepKey, children }: { stepKey: string; children: ReactNode }): JSX.Element {
	return (
		<motion.div
			key={stepKey}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: 0.12, ease: "easeOut" }}
			className="flex min-h-0 flex-col"
		>
			{children}
		</motion.div>
	);
}
