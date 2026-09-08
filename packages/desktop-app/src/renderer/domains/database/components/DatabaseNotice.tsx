import type { JSX, ReactNode } from "react";
import { cn } from "@astravia/ui";

export type DatabaseNoticeTone = "success" | "error" | "info";

const TONE_STYLES: Readonly<Record<DatabaseNoticeTone, { box: string; title: string; icon: string }>> = {
	success: {
		box: "bg-emerald-500/8",
		title: "text-emerald-600 dark:text-emerald-400",
		icon: "icon-[lucide--circle-check]",
	},
	error: {
		box: "bg-destructive/8",
		title: "text-destructive",
		icon: "icon-[lucide--circle-alert]",
	},
	info: {
		box: "bg-muted/50",
		title: "text-foreground",
		icon: "icon-[lucide--info]",
	},
};

/**
 * 面板通用提示卡：成功 / 错误 / 说明统一走无边框软填充，
 * 工作区错误、测试结果、表单反馈、引擎说明共用这一个组件。
 */
export function DatabaseNotice({
	tone,
	title,
	icon,
	children,
	className,
}: {
	tone: DatabaseNoticeTone;
	title: ReactNode;
	/** 覆盖默认图标（如引擎说明用盾牌锁）。 */
	icon?: string;
	children?: ReactNode;
	className?: string;
}): JSX.Element {
	const styles = TONE_STYLES[tone];
	return (
		<div className={cn("flex items-start gap-2.5 rounded-xl px-4 py-3", styles.box, className)}>
			<span className={cn("mt-0.5 h-4 w-4 shrink-0", icon ?? styles.icon, styles.title)} />
			<div className="min-w-0 flex-1">
				<div className={cn("text-[12.5px] font-semibold", styles.title)}>{title}</div>
				{children}
			</div>
		</div>
	);
}
