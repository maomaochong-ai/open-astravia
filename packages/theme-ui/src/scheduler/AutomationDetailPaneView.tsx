import { cn } from "@vetta-org/ui";
import type { JSX, ReactNode } from "react";

export type AutomationDetailStatusTone = "active" | "running" | "paused" | "suspended" | "done" | "draft";

export interface AutomationDetailPaneViewProps {
	readonly statusLabel: string;
	readonly statusTone: AutomationDetailStatusTone;
	/** 顶栏右侧的操作（更多菜单、暂停/启用等），关闭按钮由本组件自带。 */
	readonly headerActions?: ReactNode;
	readonly closeLabel: string;
	readonly onClose: () => void;
	/** 可编辑的任务内容。 */
	readonly body: ReactNode;
	/** 编辑态下的执行历史；新建时不传。 */
	readonly history?: ReactNode;
	/** 底栏：保存/创建、打开聊天等。 */
	readonly footer?: ReactNode;
}

const STATUS_CLASS: Record<AutomationDetailStatusTone, string> = {
	active: "text-primary",
	running: "text-primary",
	paused: "text-muted-foreground",
	suspended: "text-amber-500",
	done: "text-muted-foreground",
	draft: "text-muted-foreground",
};

/** 自动化页右侧分屏：顶栏状态 + 操作，中间滚动的编辑区与执行历史，底栏固定。 */
export function AutomationDetailPaneView({
	statusLabel,
	statusTone,
	headerActions,
	closeLabel,
	onClose,
	body,
	history,
	footer,
}: AutomationDetailPaneViewProps): JSX.Element {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex h-12 shrink-0 items-center gap-1 px-6">
				<span className={cn("flex-1 truncate text-[13px] font-medium", STATUS_CLASS[statusTone])}>
					{statusLabel}
				</span>
				{headerActions}
				<button
					type="button"
					title={closeLabel}
					aria-label={closeLabel}
					onClick={onClose}
					className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<span className="icon-[mdi--close] h-4 w-4" />
				</button>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-6">
				{body}
				{history ? <div className="mt-6">{history}</div> : null}
			</div>
			{footer ? (
				<footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 px-6 py-3">
					{footer}
				</footer>
			) : null}
		</div>
	);
}

/** 顶栏里的图标按钮，与关闭按钮同一套尺寸。 */
export function AutomationPaneIconButton({
	icon,
	label,
	disabled,
	onClick,
}: {
	readonly icon: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
		>
			<span className={cn(icon, "h-4 w-4")} />
		</button>
	);
}
