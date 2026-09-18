import { getSubagentsForSession, subagentsBySessionAtom } from "@shared/store/subagents-atoms";
import { useAtomValue } from "jotai";
import { SubagentReplyCard } from "./SubagentReplyCard";
import { useSubagentCardsSession } from "./SubagentCardsScope";

export function SubagentReplyCards({ toolCallId }: { toolCallId: string }): JSX.Element | null {
	const sessionId = useSubagentCardsSession();
	const subagents = useAtomValue(subagentsBySessionAtom);
	const children = getSubagentsForSession(subagents, sessionId).filter((task) => task.originToolCallId === toolCallId);
	if (children.length === 0) return null;
	return (
		<div className="mt-2 flex min-w-0 flex-col gap-2">
			{children.map((task) => <SubagentReplyCard key={task.path} task={task} />)}
		</div>
	);
}
