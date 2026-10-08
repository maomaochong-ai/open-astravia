// @vitest-environment jsdom
import { CompactionBoundaryView as CompactionBoundaryFallback } from "@astravia-org/theme-ui/chat";
import { MarkdownContent } from "@astravia-org/theme-ui/markdown";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { compactionLiveSummaryAtom, isCompactingAtom } from "@shared/store/atoms";
import { useExpansion } from "./expansionStore";

/**
 * 压缩消息卡：把上下文压缩从「一条静态细线」升级为可折叠卡片。
 *
 * 形态（方案 §6.1）：
 * - 折叠态（默认）：细线 + 压缩图标 + 账目行（tokensBefore）+ 展开 chevron——
 *   高度恒定，Virtuoso 高度估算友好；
 * - 展开态：Markdown 渲染摘要全文；压缩进行中（isCompacting）时优先展示
 *   live 流式摘要（compaction.delta 逐段累积），结束后回落历史投影的 summary；
 * - 展开态走 expansionStore（外置持久，滚出视口不丢——Fold 同款先例）。
 *
 * 兼容：无 summary 且不在压缩中 → 回落旧 CompactionBoundary（零变化）。
 */

export interface CompactionCardProps {
	/** 历史投影的摘要（event.kind === "compaction" 的 summary）。 */
	readonly summary?: string;
	readonly tokensBefore?: number;
}

export const CompactionCard = memo(function CompactionCard({ summary, tokensBefore }: CompactionCardProps) {
	const { t } = useTranslation("chat");
	const isCompacting = useAtomValue(isCompactingAtom);
	const liveSummary = useAtomValue(compactionLiveSummaryAtom);

	// 进行中优先 live 文本；结束后回落历史 summary。
	const text = isCompacting ? (liveSummary ?? summary) : summary;
	if (!text) {
		// 无摘要且不在压缩：保持旧边界线形态（旧会话数据的兼容路径）。
		return <CompactionBoundaryFallback label={t("messageList.compactionBoundary")} />;
	}

	const [expanded, toggleExpanded] = useExpansion("compaction-card", false);
	const label = isCompacting
		? t("messageList.compactionCard.compacting")
		: tokensBefore !== undefined
			? t("messageList.compactionCard.tokens", { tokens: tokensBefore.toLocaleString() })
			: t("messageList.compactionBoundary");

	return (
		<div className="my-1 rounded-lg border border-border/40 bg-muted/20">
			<button
				type="button"
				onClick={toggleExpanded}
				className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-muted-foreground/70 transition-colors hover:text-muted-foreground"
				aria-expanded={expanded}
			>
				<span className="icon-[mdi--compress] h-3 w-3 shrink-0" aria-hidden="true" />
				<span className="truncate">{label}</span>
				{isCompacting ? (
					<span className="icon-[mdi--loading] h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
				) : (
					<span
						className={`icon-[mdi--chevron-${expanded ? "up" : "down"}] h-3 w-3 shrink-0 transition-transform`}
						aria-hidden="true"
					/>
				)}
			</button>
			{expanded ? (
				<div className="border-t border-border/40 px-3 py-2">
					<MarkdownContent
						text={text}
						isStreamingTail={isCompacting}
						theme="light"
						labels={{ copy: t("messageList.compactionCard.viewSummary") } as never}
						getFileIconClass={(): string => ""}
						onOpenFile={(): void => {}}
						onOpenUrl={(): void => {}}
					/>
				</div>
			) : null}
		</div>
	);
});
