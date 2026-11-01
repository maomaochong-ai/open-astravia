import { Button } from "@astravia-org/ui/button";
import type { JSX, ReactNode } from "react";

export interface ProjectsPanelEmptyStateLabels {
	description: string;
	newConversation: string;
	title: string;
}

export interface ProjectsPanelEmptyStateProps {
	labels: ProjectsPanelEmptyStateLabels;
	onNewConversation: () => void;
	/** Secondary action slot, e.g. the add-project menu. */
	projectAction?: ReactNode;
}

export function ProjectsPanelEmptyState({
	labels,
	onNewConversation,
	projectAction,
}: ProjectsPanelEmptyStateProps): JSX.Element {
	return (
		<div className="px-1 py-2">
			<div className="flex flex-col gap-3 rounded-2xl bg-card p-3.5">
				<div className="flex flex-col gap-1">
					<p className="text-[14px] font-semibold text-foreground">{labels.title}</p>
					<p className="text-[12px] leading-relaxed text-muted-foreground">{labels.description}</p>
				</div>
				<div className="flex flex-col gap-2">
					<Button variant="primary" size="lg" className="w-full text-[13px]" onClick={onNewConversation}>
						<span className="icon-[solar--chat-round-line-linear] h-4 w-4 shrink-0" />
						{labels.newConversation}
					</Button>
					{projectAction}
				</div>
			</div>
		</div>
	);
}
