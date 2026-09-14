import { cn } from "@vetta-org/ui";
import type { JSX, ReactNode } from "react";

export type DebugSubTab = "tool-calls" | "request-history";

export interface DebugTabPanelViewProps {
	subTab: DebugSubTab;
	onSubTabChange: (tab: DebugSubTab) => void;
	toolCallsLabel: string;
	requestHistoryLabel: string;
	toolCalls: ReactNode;
	requestHistory: ReactNode;
}

function SubTabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
				active
					? "bg-secondary text-foreground"
					: "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

export function DebugTabPanelView({
	subTab,
	onSubTabChange,
	toolCallsLabel,
	requestHistoryLabel,
	toolCalls,
	requestHistory,
}: DebugTabPanelViewProps): JSX.Element {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
				<SubTabButton active={subTab === "tool-calls"} onClick={() => onSubTabChange("tool-calls")}>
					{toolCallsLabel}
				</SubTabButton>
				<SubTabButton
					active={subTab === "request-history"}
					onClick={() => onSubTabChange("request-history")}
				>
					{requestHistoryLabel}
				</SubTabButton>
			</div>
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				{subTab === "tool-calls" && toolCalls}
				{subTab === "request-history" && requestHistory}
			</div>
		</div>
	);
}
