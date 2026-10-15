import type { CompactionBlock } from "@shared/store/atoms";
import { CompactionStepView } from "@astravia-org/theme-ui/chat/CompactionStepView";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useExpansion } from "../message-list/expansionStore";
import { formatTokens } from "../../services/context-ring-details";

const LABEL_KEYS = {
	running: "messageList.compactionStep.running",
	success: "messageList.compactionStep.done",
	error: "messageList.compactionStep.failed",
	skipped: "messageList.compactionStep.skipped",
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
	const label = (() => {
		if (block.status === "error" && block.errorMessage) {
			return `${t(LABEL_KEYS.error)} · ${block.errorMessage}`;
		}
		if (block.status === "skipped" && block.skipReason) {
			const reasonKey = `messageList.compactionSkipReason.${block.skipReason}`;
			const reasonText = t(reasonKey);
			// 如果 key 不存在，回退到原始 skipReason
			return reasonText === reasonKey ? `${t(LABEL_KEYS.skipped)} · ${block.skipReason}` : `${t(LABEL_KEYS.skipped)} · ${reasonText}`;
		}
		return t(LABEL_KEYS[block.status] ?? LABEL_KEYS.error);
	})();
	return (
		<CompactionStepView
			status={block.status}
			label={label}
			detail={detail}
			summary={block.summary}
			expanded={expanded}
			onToggle={toggle}
			exportMode={exportMode}
		/>
	);
});
