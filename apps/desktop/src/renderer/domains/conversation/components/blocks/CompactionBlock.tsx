import type { CompactionBlock } from "@shared/store/atoms";
import { CompactionStepView } from "@astravia-org/theme-ui/chat/CompactionStepView";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useExpansion } from "../message-list/expansionStore";
import { formatTokens } from "../../services/context-ring-details";
import { toCompactionDisplaySummary } from "../../services/compaction-display-summary";
import { MarkdownContent } from "./TextBlock";

const LABEL_KEYS = {
	running: "messageList.compactionStep.running",
	success: "messageList.compactionStep.done",
	error: "messageList.compactionStep.failed",
	skipped: "messageList.compactionStep.skipped",
} as const;

/** 压缩摘要是模型写的叙述，按 Markdown 预览而不是原文墙展示；引用要稳定，否则每帧重建整棵 Markdown 树。 */
function renderSummaryMarkdown(text: string, streaming: boolean) {
	// 运行中摘要每 100ms 长一截：交给流式尾块管线（节流快照 + 已闭合块冻结），
	// 否则每次增量都整篇重解析，表格/代码块反复重建。
	return <MarkdownContent text={text} isStreamingTail={streaming} />;
}

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
	// 摘要可长达数万字符，清洗与 Markdown 重渲都只在文本变化时做一次。
	const summary = useMemo(() => {
		if (block.summary === undefined) return undefined;
		// 标题映射放在读端：提示词只能约束新摘要，历史记录里的英文模板标题已经落盘了。
		return toCompactionDisplaySummary(block.summary, (key) => {
			const path = `messageList.compactionHeading.${key}`;
			// i18n 的键是字面量联合类型，这里按语义拼出键名，缺键时回头拿到键本身。
			const text: unknown = t(path as never);
			return typeof text === "string" && text !== path ? text : undefined;
		});
	}, [block.summary, t]);
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
			const reasonText = t(reasonKey as any);
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
			summary={summary}
			renderSummary={renderSummaryMarkdown}
			expanded={expanded}
			onToggle={toggle}
			exportMode={exportMode}
		/>
	);
});
