import { useMemo, type JSX } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@vetta-org/ui";

/**
 * Mac 键盘预览组件（通用、纯展示，轻拟物风格）。
 * 用主题语义 token 渲染，深/浅色自动适配；高亮走 primary 主题色。
 * 左右功能键用独立 id 区分（shift-left / shift-right 等），可分别高亮。
 *
 * 高亮键在 highlightKeys 变化时播放一次「按下入场」动画（showPress）：
 * 键从抬起状态弹落到按下态，用于切换快捷键时给出触感反馈。
 *
 * 键帽刻印（esc / shift / return / command …）是物理硬件印字，
 * 不随系统语言本地化（真机键盘任何语言下都印同样字形），故按项目
 * 对 brand/协议串的惯例保持字面，不接 i18n。
 */

/** 可高亮的按键 id。左右功能键分开。 */
export type MacKeyId =
	| "esc"
	| "delete"
	| "tab"
	| "capslock"
	| "return"
	| "space"
	| "fn"
	| "control"
	| "shift-left"
	| "shift-right"
	| "command-left"
	| "command-right"
	| "option-left"
	| "option-right"
	// 其余按键 id 用其 label 小写，如 "a" / "1" / "f1" / "arrow-up"
	| (string & {});

interface KeyDef {
	/** 稳定 id，用于高亮匹配 */
	id: MacKeyId;
	/** 键帽主字形 */
	label: string;
	/** 左上角小字（如 shift 的 ⇧、command 的 ⌘） */
	sub?: string;
	/** flex-grow 权重，默认 1 */
	w?: number;
	/** 右上/右下对齐（功能键组下排文字靠边） */
	align?: "start" | "center" | "end";
}

type Row = KeyDef[];

const k = (id: string, label: string, extra?: Partial<KeyDef>): KeyDef => ({ id, label, ...extra });

/** 键盘布局：每行按 flex-grow 权重排布，跨行大致对齐即可。 */
const LAYOUT: Row[] = [
	[
		k("esc", "esc", { w: 1.6, align: "start" }),
		...["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"].map((f) =>
			k(f.toLowerCase(), f, { w: 1 }),
		),
		k("touchid", "", { w: 1.2 }),
	],
	[
		k("backtick", "`"),
		...["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((d) => k(d, d)),
		k("minus", "-"),
		k("equal", "="),
		k("delete", "delete", { w: 1.8, align: "end" }),
	],
	[
		k("tab", "tab", { w: 1.6, align: "start" }),
		...["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"].map((c) => k(c.toLowerCase(), c)),
		k("bracket-left", "["),
		k("bracket-right", "]"),
		k("backslash", "\\", { w: 1.2 }),
	],
	[
		k("capslock", "caps lock", { w: 2, align: "start" }),
		...["A", "S", "D", "F", "G", "H", "J", "K", "L"].map((c) => k(c.toLowerCase(), c)),
		k("semicolon", ";"),
		k("quote", "'"),
		k("return", "return", { w: 2, align: "end" }),
	],
	[
		k("shift-left", "shift", { sub: "⇧", w: 2.5, align: "start" }),
		...["Z", "X", "C", "V", "B", "N", "M"].map((c) => k(c.toLowerCase(), c)),
		k("comma", ","),
		k("period", "."),
		k("slash", "/"),
		k("shift-right", "shift", { sub: "⇧", w: 2.5, align: "end" }),
	],
	[
		k("fn", "fn", { sub: "🌐" }),
		k("control", "control", { sub: "⌃", w: 1.5, align: "start" }),
		k("option-left", "option", { sub: "⌥", w: 1.5, align: "start" }),
		k("command-left", "command", { sub: "⌘", w: 1.9, align: "start" }),
		k("space", "", { w: 5 }),
		k("command-right", "command", { sub: "⌘", w: 1.9, align: "end" }),
		k("option-right", "option", { sub: "⌥", w: 1.5, align: "end" }),
		k("arrow-left", "◀"),
		k("arrow-updown", "arrow", { w: 1 }), // 占位：渲染为上/下箭头双层竖排键
		k("arrow-right", "▶"),
	],
];

export interface MacKeyboardPreviewProps {
	/** 需要高亮（主题色）的按键 id 集合 */
	highlightKeys?: MacKeyId[];
	className?: string;
}

// 轻拟物键帽样式：顶部高光 + 底部落影，营造实体键帽的凸起感。
const CAP_RAISED = cn(
	"bg-gradient-to-b from-card to-muted",
	"border border-black/[0.08] dark:border-white/[0.08]",
	"shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_1.5px_rgba(0,0,0,0.14),0_2px_3px_-1px_rgba(0,0,0,0.12)]",
	"dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_1.5px_2px_rgba(0,0,0,0.55)]",
);
// 高亮键：primary 主题色，带内凹按下感。
const CAP_ACTIVE = cn(
	"bg-gradient-to-b from-primary/95 to-primary text-primary-foreground",
	"border border-primary/60",
	"shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-2px_5px_rgba(0,0,0,0.22)]",
);

export function MacKeyboardPreview({ highlightKeys, className }: MacKeyboardPreviewProps): JSX.Element {
	const highlighted = useMemo(() => new Set(highlightKeys ?? []), [highlightKeys]);
	// 高亮集合的签名：变化时用作 motion key，强制高亮键重挂并重放按下动画。
	const pressSignature = useMemo(() => [...highlighted].sort().join("|"), [highlighted]);

	return (
		<div
			className={cn(
				"relative block w-full select-none rounded-[18px] p-3",
				"border border-black/[0.08] dark:border-white/[0.08]",
				"bg-gradient-to-b from-muted/90 to-muted/50",
				"shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_14px_32px_-16px_rgba(0,0,0,0.45)]",
				"dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_14px_32px_-16px_rgba(0,0,0,0.7)]",
				className,
			)}
		>
			{/* 内凹键槽：把键帽「坐」进一个略微下沉的托盘里 */}
			<div className="flex flex-col gap-1.5 rounded-[12px] bg-black/[0.03] p-2 shadow-[inset_0_1px_2px_rgba(0,0,0,0.07)] dark:bg-black/25 dark:shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]">
				{LAYOUT.map((row, ri) => (
					<div key={ri} className="flex gap-1.5">
						{row.map((key) => {
							// 方向键：上下箭头合并成一个双层竖排键，替换占位 id。
							if (key.id === "arrow-updown") {
								return <ArrowUpDownKey key={key.id} highlighted={highlighted} />;
							}
							return (
								<Keycap
									key={key.id}
									def={key}
									active={highlighted.has(key.id)}
									pressSignature={pressSignature}
								/>
							);
						})}
					</div>
				))}
			</div>
		</div>
	);
}

// 涟漪起始时机（≈按下命中点）与两圈之间的间隔。
const RIPPLE_HIT = 0.22;
const RIPPLE_GAP = 0.24;

function Keycap({
	def,
	active,
	pressSignature,
}: {
	def: KeyDef;
	active: boolean;
	pressSignature: string;
}): JSX.Element {
	const align = def.align ?? "center";
	const reduceMotion = useReducedMotion();

	// Touch ID 键：中间画一个同心圆环表示指纹传感器。
	const content =
		def.id === "touchid" ? (
			<span className="flex h-4 w-4 items-center justify-center rounded-full border border-foreground/30">
				<span className="h-2 w-2 rounded-full border border-foreground/25" />
			</span>
		) : (
			<>
				{def.sub && (
					<span
						className={cn("mb-0.5 text-[10px] opacity-80", active ? "text-primary-foreground" : "text-foreground/70")}
					>
						{def.sub}
					</span>
				)}
				{def.label && (
					<span className={cn("max-w-full truncate", def.label.length > 2 && "text-[9px]")}>{def.label}</span>
				)}
			</>
		);

	const capClass = cn(
		"relative z-10 flex h-full w-full min-w-0 flex-col justify-center overflow-hidden rounded-[7px] px-1 text-[11px] font-medium leading-none",
		active ? CAP_ACTIVE : CAP_RAISED,
		align === "start" && "items-start",
		align === "center" && "items-center",
		align === "end" && "items-end",
	);
	// 外层负责 flex 布局与高度，不裁剪，让涟漪能溢出键帽边缘。
	const outerStyle = { flexGrow: def.w ?? 1, flexBasis: 0 } as const;

	// 非高亮键（或用户偏好减少动效）：静态键帽。
	if (!active || reduceMotion) {
		return (
			<div className="relative flex h-9 min-w-0" style={outerStyle}>
				<div className={capClass}>{content}</div>
			</div>
		);
	}

	return (
		<div className="relative flex h-9 min-w-0" style={outerStyle}>
			{/* 键帽下方的两圈涟漪光圈：跟随按下命中点，扩大并淡出。 */}
			{[0, 1].map((i) => (
				<motion.span
					key={`${pressSignature}-ripple-${i}`}
					className="pointer-events-none absolute inset-0 z-0 rounded-[7px] border border-primary/60"
					initial={{ scale: 0.85, opacity: 0 }}
					animate={{ scale: [0.85, 1.75], opacity: [0.5, 0] }}
					transition={{ duration: 0.62, delay: RIPPLE_HIT + i * RIPPLE_GAP, ease: "easeOut" }}
				/>
			))}
			{/* 键帽本体：从抬起(-6px)弹落、越过按下位再回弹稳定的「按下入场」。 */}
			<motion.div
				key={pressSignature}
				className={capClass}
				initial={{ y: -6, filter: "brightness(1.18)" }}
				animate={{ y: [-6, 2.5, 0], filter: ["brightness(1.18)", "brightness(0.96)", "brightness(1)"] }}
				transition={{ duration: 0.42, times: [0, 0.55, 1], ease: [0.22, 1, 0.36, 1] }}
			>
				{content}
			</motion.div>
		</div>
	);
}

/** 上/下箭头合并的竖排半高键。 */
function ArrowUpDownKey({ highlighted }: { highlighted: Set<MacKeyId> }): JSX.Element {
	const upActive = highlighted.has("arrow-up");
	const downActive = highlighted.has("arrow-down");
	const base = "flex h-[16px] items-center justify-center rounded-[4px] text-[9px] leading-none";
	return (
		<div className="flex min-w-0 flex-col justify-between gap-0.5" style={{ flexGrow: 1, flexBasis: 0 }}>
			<div className={cn(base, upActive ? CAP_ACTIVE : CAP_RAISED)}>▲</div>
			<div className={cn(base, downActive ? CAP_ACTIVE : CAP_RAISED)}>▼</div>
		</div>
	);
}
