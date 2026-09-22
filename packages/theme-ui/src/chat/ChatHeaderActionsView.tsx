import { Button } from "@vetta-org/ui";

export function ChatHeaderExportAction({
	disabled,
	exporting,
	onClick,
	title,
}: {
	readonly disabled?: boolean;
	readonly exporting?: boolean;
	readonly onClick: () => void;
	readonly title?: string;
}): JSX.Element {
	return (
		<Button size="icon-xs" variant="ghost" title={title} disabled={disabled} onClick={onClick}>
			<span
				className={
					exporting
						? "icon-[mdi--loading] animate-spin text-[14px]"
						: "icon-[solar--square-share-line-linear] text-[14px]"
				}
			/>
		</Button>
	);
}

export function ChatHeaderPinAction({
	onClick,
	pinned,
	title,
}: {
	readonly onClick: () => void;
	readonly pinned: boolean;
	readonly title: string;
}): JSX.Element {
	return (
		<Button
			size="icon-xs"
			variant="ghost"
			title={title}
			onClick={onClick}
			className={pinned ? "bg-accent text-foreground" : ""}
		>
			<span className={`${pinned ? "icon-[solar--pin-bold]" : "icon-[solar--pin-linear]"} text-[14px]`} />
		</Button>
	);
}

export function ChatHeaderPanelAction({
	onClick,
	open,
	title,
}: {
	readonly onClick: () => void;
	readonly open: boolean;
	readonly title: string;
}): JSX.Element {
	return (
		<Button
			size="icon-xs"
			variant="ghost"
			title={title}
			onClick={onClick}
			className={open ? "bg-accent text-foreground" : ""}
		>
			<span className="icon-[solar--sidebar-minimalistic-linear] -scale-x-100 text-[14px]" />
		</Button>
	);
}

export function ChatHeaderBottomPanelAction({
	onClick,
	open,
	title,
}: {
	readonly onClick: () => void;
	readonly open: boolean;
	readonly title: string;
}): JSX.Element {
	return (
		<Button
			size="icon-xs"
			variant="ghost"
			title={title}
			aria-label={title}
			aria-pressed={open}
			onClick={onClick}
			className={open ? "bg-accent text-foreground" : ""}
		>
			<span className="icon-[solar--window-frame-linear] text-[14px]" />
		</Button>
	);
}

/**
 * 一步到位打开终端。`focused` 表示此刻已经在终端里（再点不会有任何动作），
 * 高亮与底部面板按钮的「展开」态同一套视觉。
 */
export function ChatHeaderTerminalAction({
	disabled,
	focused,
	onClick,
	title,
}: {
	readonly disabled?: boolean;
	readonly focused: boolean;
	readonly onClick: () => void;
	readonly title: string;
}): JSX.Element {
	return (
		<Button
			size="icon-xs"
			variant="ghost"
			title={title}
			aria-label={title}
			aria-pressed={focused}
			disabled={disabled}
			onClick={onClick}
			className={focused ? "bg-accent text-foreground" : ""}
		>
			<span className="icon-[solar--programming-linear] text-[14px]" />
		</Button>
	);
}

export const ChatHeaderActions = {
	Export: ChatHeaderExportAction,
	Pin: ChatHeaderPinAction,
	Panel: ChatHeaderPanelAction,
	BottomPanel: ChatHeaderBottomPanelAction,
	Terminal: ChatHeaderTerminalAction,
} as const;
