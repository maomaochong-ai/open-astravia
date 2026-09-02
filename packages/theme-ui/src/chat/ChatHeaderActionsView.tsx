import { Button } from "@vetta/ui";

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

export const ChatHeaderActions = {
	Export: ChatHeaderExportAction,
	Pin: ChatHeaderPinAction,
	Panel: ChatHeaderPanelAction,
} as const;
