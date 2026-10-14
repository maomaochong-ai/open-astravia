import type { CompactionBlock } from "@shared/store/atoms";
import { CompactionStepView } from "@vetta-org/theme-ui/chat/CompactionStepView";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useExpansion } from "../message-list/expansionStore";
import { formatTokens } from "../../services/context-ring-details";

const LABEL_KEYS = {
	running: "messageList.compactionStep.running",
	success: "messageList.compactionStep.done",
	error: "messageList.compactionStep.failed",
} as const;

/** Automatic compaction as a step of the reply; opens to the summary that replaced earlier context. */
export const CompactionBlockView = memo(function CompactionBlockView({
	block,
	exportMode = false,
}: {
	readonly block: CompactionBlock;
	readonly exportMode?: boolean;
}) {
	const { t } = useTranslation("chat");
	const [expanded, toggle] = useExpansion(`compaction:${block.id}`);
	const detail =
		block.status === "success" && block.tokensBefore
			? t("messageList.compactionStep.tokensBefore", { tokens: formatTokens(block.tokensBefore) })
			: undefined;
	return (
		<CompactionStepView
			status={block.status}
			label={block.status === "error" && block.errorMessage ? `${t(LABEL_KEYS.error)} · ${block.errorMessage}` : t(LABEL_KEYS[block.status])}
			detail={detail}
			summary={block.summary}
			expanded={expanded}
			onToggle={toggle}
			exportMode={exportMode}
		/>
	);
});
