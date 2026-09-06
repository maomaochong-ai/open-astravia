import type { ChatToolCallPresentationViewModel, ToolCallBlock } from "@shared/store/atoms";
import { memo } from "react";
import { ToolCallBlockView } from "../blocks/ToolCallBlock";
import { TeamMemberReplyCard } from "./TeamMemberReplyCard";

interface ToolCallPresentationProps {
	readonly block: ToolCallBlock;
	readonly presentation?: ChatToolCallPresentationViewModel;
	readonly exportMode?: boolean;
	readonly aliased?: boolean;
	readonly onTeamMemberOpen?: (memberId: string) => void;
}

/**
 * Message recipe for a tool row with host-projected, always-visible activity.
 * Raw tool details keep their own disclosure behavior; activity is a sibling,
 * so expanding or collapsing those details never hides member progress.
 */
export const ToolCallPresentation = memo(function ToolCallPresentation({
	block,
	presentation,
	exportMode = false,
	aliased = false,
	onTeamMemberOpen,
}: ToolCallPresentationProps): JSX.Element {
	return (
		<div className="min-w-0 w-full">
			<ToolCallBlockView block={block} exportMode={exportMode} aliased={aliased} />
			{presentation && presentation.activities.length > 0 ? (
				<div className="mt-2 flex min-w-0 flex-col gap-2">
					{presentation.activities.map((activity) => (
						<TeamMemberReplyCard
							key={`${activity.requestId}:${activity.memberId}`}
							event={activity}
							onOpen={onTeamMemberOpen}
						/>
					))}
				</div>
			) : null}
		</div>
	);
});
