import {
	KbFilterByTagsView as ThemeKbFilterByTagsView,
	KbListTagsView as ThemeKbListTagsView,
	KbWritePageView as ThemeKbWritePageView,
} from "@vetta/theme-ui/chat";
import { useTranslation } from "react-i18next";

/** Minimal tool block shape for knowledge tool UI adapters. */
interface KnowledgeToolBlock {
	uiDetails?: {
		knowledge?:
			| {
					kind: "filter";
					count: number;
					pages: Array<{
						id: string;
						title: string;
						summary?: string;
						tags: string[];
						absolutePath: string;
					}>;
			  }
			| {
					kind: "tags";
					tags: Array<{ tag: string; count: number }>;
			  }
			| {
					kind: "write";
					action: "create" | "update" | string;
					absolutePath: string;
					movedFrom?: string;
			  };
	};
}

/** kb_filter_by_tags：命中页列表（标题 + 摘要 + 标签 + 路径）。 */
export function KbFilterByTagsView({ block }: { block: KnowledgeToolBlock }): JSX.Element | null {
	const { t } = useTranslation("chat");
	const kb = block.uiDetails?.knowledge;
	if (!kb || kb.kind !== "filter") return null;
	return (
		<ThemeKbFilterByTagsView
			emptyLabel={t("filterByTags.noResults")}
			hitCountLabel={t("filterByTags.hitCount", { count: kb.count })}
			pages={kb.pages.map((p) => ({
				id: p.id,
				title: p.title || t("filterByTags.noTitle"),
				summary: p.summary ?? null,
				tags: p.tags,
				absolutePath: p.absolutePath,
			}))}
		/>
	);
}

/** kb_list_available_tags：标签云（带页数）。 */
export function KbListTagsView({ block }: { block: KnowledgeToolBlock }): JSX.Element | null {
	const { t } = useTranslation("chat");
	const kb = block.uiDetails?.knowledge;
	if (!kb || kb.kind !== "tags") return null;
	return (
		<ThemeKbListTagsView
			emptyLabel={t("listTags.empty")}
			tagCountLabel={t("listTags.tagCount", { count: kb.tags.length })}
			tags={kb.tags.map((item) => ({ tag: item.tag, count: item.count }))}
		/>
	);
}

/** kb_write_page：写入结果（动作 + 路径）。 */
export function KbWritePageView({ block }: { block: KnowledgeToolBlock }): JSX.Element | null {
	const { t } = useTranslation("chat");
	const kb = block.uiDetails?.knowledge;
	if (!kb || kb.kind !== "write") {
		return (
			<ThemeKbWritePageView
				isEmpty
				emptyLabel={t("knowledgeTools.empty")}
				actionLabel=""
				actionIcon=""
				absolutePath=""
				movedFromLabel={null}
			/>
		);
	}
	const actionLabel = kb.action === "create" ? t("writePage.actionCreate") : t("writePage.actionUpdate");
	const actionIcon = kb.action === "create" ? "icon-[mdi--file-plus-outline]" : "icon-[mdi--file-edit-outline]";
	return (
		<ThemeKbWritePageView
			emptyLabel={t("knowledgeTools.empty")}
			actionLabel={actionLabel}
			actionIcon={actionIcon}
			absolutePath={kb.absolutePath}
			movedFromLabel={kb.movedFrom ? t("writePage.originalLocation", { path: kb.movedFrom }) : null}
		/>
	);
}
