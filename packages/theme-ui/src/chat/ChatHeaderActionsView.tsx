import type { JSX, ReactNode } from "react";
import { Button } from "@vetta/ui";

export interface ChatHeaderActionsViewProps {
	readonly badges: ReactNode;
	readonly exportTitle?: string;
	readonly exportDisabled?: boolean;
	readonly exporting?: boolean;
	/** 省略即不渲染导出按钮（如新会话页尚无消息可导出）。 */
	readonly onOpenExport?: () => void;
	readonly pinTitle: string;
	readonly pinned: boolean;
	readonly onTogglePin: () => void;
	readonly panelTitle: string;
	readonly panelOpen: boolean;
	readonly onTogglePanel: () => void;
}

export function ChatHeaderActionsView({
	badges,
	exportTitle,
	exportDisabled,
	exporting,
	onOpenExport,
	pinTitle,
	pinned,
	onTogglePin,
	panelTitle,
	panelOpen,
	onTogglePanel,
}: ChatHeaderActionsViewProps): JSX.Element {
	return (
		<>
			{badges}
			{onOpenExport && (
				<Button
					size="icon-xs"
					variant="ghost"
					title={exportTitle}
					disabled={exportDisabled}
					onClick={onOpenExport}
				>
					<span
						className={
							exporting
								? "icon-[mdi--loading] animate-spin text-[14px]"
								: "icon-[solar--square-share-line-linear] text-[14px]"
						}
					/>
				</Button>
			)}
			<Button
				size="icon-xs"
				variant="ghost"
				title={pinTitle}
				onClick={onTogglePin}
				className={pinned ? "bg-accent text-foreground" : ""}
			>
				<span className={`${pinned ? "icon-[solar--pin-bold]" : "icon-[solar--pin-linear]"} text-[14px]`} />
			</Button>
			<Button
				size="icon-xs"
				variant="ghost"
				title={panelTitle}
				onClick={onTogglePanel}
				className={panelOpen ? "bg-accent text-foreground" : ""}
			>
				<span className="icon-[solar--sidebar-minimalistic-linear] -scale-x-100 text-[14px]" />
			</Button>
		</>
	);
}
