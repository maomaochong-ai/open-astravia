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

/** 压缩摘要运行期只追加纯文本，压缩结束才整篇解析一次；引用要稳定，否则每帧重建整棵 Markdown 树。 */
function renderSummaryMarkdown(text: string, streaming: boolean) {
	// 摘要在运行期每 100ms 长一截，而整篇 Markdown 解析的成本随长度线性增长（实测 20k 约 50ms、120k 可达 1s 以上），
	// 远超流式节流间隔。生产日志里能归因的 #185（Maximum update depth exceeded）崩溃栈有 233/234 落在这张卡上，
	// 且都指向这棵子树里的更新入队处。增长期改走纯文本：每次增量只是一次文本节点更新，成本与长度无关，
	// 这个子树里也不再挂载 useStreamingDisplayText / useRenderSnapshot 这两个 setState 生产者；压缩结束后整篇解析一次。
	if (streaming) return <div className="whitespace-pre-wrap">{text}</div>;
	return <MarkdownContent text={text} />;
}

/** Automatic compaction as a step of the reply; opens to the summary that replaced earlier context. */
export const CompactionBlockView = memo(function CompactionBlockView({
	block,
	exportMode = false,
}: {
	readonly block: CompactionBlock;
	readonly exportMode?: boolean;
}) {
	// `i18n` 是稳定实例，`i18n.language` 才是变化维度；把 `t` 放进 useMemo 依赖会让它在每帧
	// 都是新引用，长摘要每次增量都重跑全文本地化（实测把 6.7s 的长摘要用例拖到 30s）。
	const { t, i18n } = useTranslation("chat");
	// 单测桩只注入 `t`，所以把实例显式当可能缺失来看待：缺了就退回 `t`，
	// 此时缓存只随摘要变化。
	const translation: typeof i18n | undefined = i18n;
	const language = translation?.language;
	// 展开态必须活在组件外：Virtuoso 把条目滚出视窗就会卸载重挂，组件内 state 会归零。
	// running 的默认展开也交给 store 的默认值，组件内不再记第二份用户选择。
	const [expanded, toggle] = useExpansion(`compaction:${block.id}`, block.status === "running");
	// 摘要可长达数万字符，清洗与 Markdown 重渲都只在文本变化时做一次；
	// 内部会对「原本不含标记/标题」的增量做单次扫描短路，不需要在调用处按状态分叉。
	const summary = useMemo(() => {
		if (block.summary === undefined) return undefined;
		// 标题映射放在读端：提示词只能约束新摘要，历史记录里的英文模板标题已经落盘了。
		return toCompactionDisplaySummary(block.summary, (key) => {
			const path = `messageList.compactionHeading.${key}`;
			// i18n 的键是字面量联合类型，这里按语义拼出键名，缺键时回头拿到键本身。
			const text: unknown = translation ? translation.t(path as never, { ns: "chat" }) : t(path as never);
			return typeof text === "string" && text !== path ? text : undefined;
		});
	}, [block.summary, t, translation, language]);
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
			pendingHint={
				<span className="tool-call-shimmer-text text-[0.8125rem]">{t("messageList.compactionStep.generating")}</span>
			}
			expanded={expanded}
			onToggle={toggle}
			exportMode={exportMode}
		/>
	);
});
