import {
	AnchorEditsFallbackView,
	type AnchorEditItemView,
	DiffPreviewView,
	EditTextFallbackView,
	type DiffLineView,
} from "@vetta/theme-ui/chat";
import { useTranslation } from "react-i18next";
import { formatSignedCount } from "./shared/format";
import { parseDiff } from "./shared/parse-diff";
import { getStringArg } from "./shared/parse-tool";

interface EditDiffBlock {
	args: Record<string, unknown>;
	uiDetails?: { diff?: string };
}

/** edit 锚点模式的单条编辑（与 coding-agent anchorEditSchema 对齐，宽松解析）。 */
interface AnchorEditArg {
	anchor?: unknown;
	end_anchor?: unknown;
	new_text?: unknown;
	insert_after?: unknown;
}

/** 从工具参数里取锚点编辑数组；非锚点模式返回 null。 */
function getAnchorEdits(args: Record<string, unknown>): AnchorEditArg[] | null {
	return Array.isArray(args.edits) ? (args.edits as AnchorEditArg[]) : null;
}

function DiffPreview({ diff, anchorMode }: { diff: string; anchorMode: boolean }): JSX.Element {
	const { t } = useTranslation("chat");
	const { lines, stats } = parseDiff(diff);
	const net = stats.added - stats.removed;

	const viewLines: DiffLineView[] = lines.map((line) => {
		const rowClass =
			line.kind === "added"
				? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
				: line.kind === "removed"
					? "bg-red-500/10 text-red-700 dark:text-red-300"
					: line.kind === "meta"
						? "text-muted-foreground/45"
						: "text-foreground/70";
		const markerClass =
			line.kind === "added"
				? "text-emerald-600 dark:text-emerald-400"
				: line.kind === "removed"
					? "text-red-600 dark:text-red-400"
					: "text-muted-foreground/35";
		const marker = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
		const content = line.kind === "added" || line.kind === "removed" ? line.text.slice(1) : line.text;
		return {
			text: line.text,
			kind: line.kind,
			marker,
			content,
			rowClass,
			markerClass,
		};
	});

	return (
		<DiffPreviewView
			lines={viewLines}
			statsAdded={stats.added}
			statsRemoved={stats.removed}
			netLabel={t("editDiff.netChangeLabel", { net: formatSignedCount(net) })}
			modeBadge={anchorMode ? t("editDiff.anchor.badge") : undefined}
		/>
	);
}

/** 锚点模式流式降级：diff 尚未产出时展示每条锚点编辑的目标与新文本。 */
function AnchorEditsFallback({ edits }: { edits: AnchorEditArg[] }): JSX.Element | null {
	const { t } = useTranslation("chat");
	const items: AnchorEditItemView[] = edits.map((edit) => {
		const anchor = typeof edit.anchor === "string" ? edit.anchor : "?";
		const endAnchor = typeof edit.end_anchor === "string" ? edit.end_anchor : null;
		const newText = typeof edit.new_text === "string" ? edit.new_text : "";
		const isInsert = edit.insert_after === true;
		const isDelete = !isInsert && newText.length === 0;
		return {
			anchorLabel: endAnchor !== null ? `${anchor} – ${endAnchor}` : anchor,
			actionLabel: isInsert
				? t("editDiff.anchor.insertAfter")
				: isDelete
					? t("editDiff.anchor.delete")
					: endAnchor !== null
						? t("editDiff.anchor.replaceRange")
						: t("editDiff.anchor.replace"),
			text: isDelete ? null : newText,
		};
	});

	return (
		<AnchorEditsFallbackView
			badge={t("editDiff.anchor.badge")}
			items={items}
			textPreviewLabels={{
				characterUnit: t("textPreview.characterUnit"),
				emptyLabel: t("textPreview.emptyLabel"),
				lineUnit: t("textPreview.lineUnit"),
			}}
		/>
	);
}

function EditTextFallback({ block }: { block: EditDiffBlock }): JSX.Element | null {
	const { t } = useTranslation("chat");
	const oldText = getStringArg(block.args, "oldText");
	const newText = getStringArg(block.args, "newText");
	if (oldText === null && newText === null) return null;

	return (
		<EditTextFallbackView
			oldText={oldText}
			newText={newText}
			oldTextEmptyLabel={t("editDiff.oldTextEmpty")}
			newTextEmptyLabel={t("editDiff.newTextEmpty")}
			textPreviewLabels={{
				characterUnit: t("textPreview.characterUnit"),
				emptyLabel: t("textPreview.emptyLabel"),
				lineUnit: t("textPreview.lineUnit"),
			}}
		/>
	);
}

/** Desktop adapter: parse tool block + i18n into props-driven theme-ui views. */
export function EditDiffView({ block }: { block: EditDiffBlock }): JSX.Element | null {
	const anchorEdits = getAnchorEdits(block.args);
	if (block.uiDetails?.diff) return <DiffPreview diff={block.uiDetails.diff} anchorMode={anchorEdits !== null} />;
	if (anchorEdits !== null) return <AnchorEditsFallback edits={anchorEdits} />;
	return <EditTextFallback block={block} />;
}
