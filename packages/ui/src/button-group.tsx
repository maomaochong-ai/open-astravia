import * as React from "react";
import { cn } from "./utils";

/**
 * 通用按钮组：一颗半透明胶囊，里面并排若干操作按钮，按钮之间一条细竖线分隔。
 *
 * 用于悬浮在内容之上的工具条（顶栏右上角、详情页操作区），不要拿它做表单里的普通按钮。
 *
 * 外观：浅色/深色都用「前景色 + 低透明度」叠出玻璃感，放在任何背景上都成立。
 * `blur` 默认开；容器贴在纯色背景上、没有可模糊的内容时可关掉省一层合成。
 */
export type ButtonGroupShape = "pill" | "square";

const ShapeContext = React.createContext<ButtonGroupShape>("pill");
const InGroupContext = React.createContext(false);

/** 当前是否已在某个 `ButtonGroup` 里：`SessionTopItem` 据此决定要不要自己再包一层胶囊。 */
export function useInButtonGroup(): boolean {
	return React.useContext(InGroupContext);
}

export interface ButtonGroupProps extends React.ComponentProps<"div"> {
	/** `pill` 胶囊（默认）或 `square` 圆角方形。 */
	shape?: ButtonGroupShape;
	/** 是否给胶囊加背景模糊，默认开。 */
	blur?: boolean;
}

export function ButtonGroup({ className, blur = true, shape = "pill", children, ...props }: ButtonGroupProps) {
	return (
		<ShapeContext.Provider value={shape}>
			<InGroupContext.Provider value={true}>
				<div
					role="group"
					data-slot="button-group"
					className={cn(
						"inline-flex items-center p-0.5",
						shape === "square" ? "rounded-xl" : "rounded-full",
						"bg-foreground/[0.06] dark:bg-white/[0.08]",
						blur && "backdrop-blur-md backdrop-saturate-150",
						className,
					)}
					{...props}
				>
					{children}
				</div>
			</InGroupContext.Provider>
		</ShapeContext.Provider>
	);
}

export interface ButtonGroupItemProps extends Omit<React.ComponentProps<"button">, "children"> {
	/** 图标节点；尺寸由组件统一约束（未显式给 size 的 svg 一律 16px）。 */
	icon?: React.ReactNode;
	/** 图标右侧文字。不传则是纯图标按钮，此时务必传 `title` 或 `aria-label`。 */
	label?: React.ReactNode;
	/** 角标：数字为计数（>99 显示 99+，0/undefined 不显示）；`true` 为小红点；也可传任意节点。 */
	badge?: number | boolean | React.ReactNode;
	/** 选中态（如面板已打开）。 */
	active?: boolean;
}

function renderBadge(badge: ButtonGroupItemProps["badge"]): React.ReactNode {
	if (badge === undefined || badge === null || badge === false || badge === 0) return null;
	if (badge === true) {
		return (
			<span
				data-slot="button-group-badge"
				className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive ring-2 ring-[color-mix(in_srgb,var(--background)_70%,transparent)]"
			/>
		);
	}
	const text = typeof badge === "number" ? (badge > 99 ? "99+" : String(badge)) : badge;
	return (
		<span
			data-slot="button-group-badge"
			className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-white tabular-nums"
		>
			{text}
		</span>
	);
}

export function ButtonGroupItem({
	className,
	icon,
	label,
	badge,
	active = false,
	type = "button",
	...props
}: ButtonGroupItemProps) {
	const shape = React.useContext(ShapeContext);
	const hasLabel = label !== undefined && label !== null && label !== false;
	return (
		<button
			type={type}
			data-slot="button-group-item"
			data-active={active || undefined}
			aria-pressed={props["aria-pressed"] ?? (active ? true : undefined)}
			className={cn(
				"relative inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-[13px] font-medium",
				shape === "square" ? "rounded-[10px]" : "rounded-full",
				"select-none text-foreground outline-none transition-colors",
				"hover:bg-foreground/[0.07] active:translate-y-px",
				"focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40",
				"data-[active]:bg-foreground/[0.1]",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				hasLabel ? "px-3" : "w-8",
				// 相邻两项之间的细分隔线：画在后一项左缘，不占布局宽度。
				"not-first:before:pointer-events-none not-first:before:absolute not-first:before:-left-px not-first:before:top-1/2 not-first:before:h-3.5 not-first:before:w-px not-first:before:-translate-y-1/2 not-first:before:bg-foreground/15",
				// 选中项的底色贴着分隔线：它自己的左线与右邻项的左线一起隐藏。
				"data-[active]:before:opacity-0 [[data-active]+&]:before:opacity-0",
				className,
			)}
			{...props}
		>
			{icon}
			{hasLabel && <span>{label}</span>}
			{renderBadge(badge)}
		</button>
	);
}
