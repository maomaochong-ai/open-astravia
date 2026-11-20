import type { ReactNode } from "react";
import { ButtonGroup, ButtonGroupItem } from "@astravia-org/ui/button-group";

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
		<ButtonGroupItem
			title={title}
			aria-label={title}
			disabled={disabled}
			onClick={onClick}
			icon={
				<span
					className={
						exporting ? "icon-[mdi--loading] animate-spin text-[14px]" : "icon-[solar--square-share-line-linear] text-[14px]"
					}
				/>
			}
		/>
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
		<ButtonGroupItem
			title={title}
			aria-label={title}
			active={pinned}
			onClick={onClick}
			icon={<span className={`${pinned ? "icon-[solar--pin-bold]" : "icon-[solar--pin-linear]"} text-[14px]`} />}
		/>
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
		<ButtonGroupItem
			title={title}
			aria-label={title}
			active={open}
			onClick={onClick}
			icon={<span className="icon-[solar--sidebar-minimalistic-linear] -scale-x-100 text-[14px]" />}
		/>
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
		<ButtonGroupItem
			title={title}
			aria-label={title}
			active={open}
			onClick={onClick}
			icon={<span className="icon-[solar--window-frame-linear] text-[14px]" />}
		/>
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
		<ButtonGroupItem
			title={title}
			aria-label={title}
			active={focused}
			disabled={disabled}
			onClick={onClick}
			icon={<span className="icon-[solar--programming-linear] text-[14px]" />}
		/>
	);
}

/** 标题栏右侧的玻璃按钮组容器，把上面的各个动作按钮包在一起。 */
export function ChatHeaderActionGroup({ children }: { readonly children: ReactNode }): JSX.Element {
	return <ButtonGroup>{children}</ButtonGroup>;
}

export const ChatHeaderActions = {
	Group: ChatHeaderActionGroup,
	Export: ChatHeaderExportAction,
	Pin: ChatHeaderPinAction,
	Panel: ChatHeaderPanelAction,
	BottomPanel: ChatHeaderBottomPanelAction,
	Terminal: ChatHeaderTerminalAction,
} as const;
