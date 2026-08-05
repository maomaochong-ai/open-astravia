import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button, Popover, PopoverAnchor, PopoverContent } from "@vetta/ui";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ContentAsset, ContentNodeData, ContentPromptDocument } from "../project/types";
import {
	contentPromptDocumentsEqual,
	contentPromptText,
	createContentPromptDocument,
	listContentPromptSourceNodeIds,
} from "./prompt-document";
import {
	getPromptMentionContext,
	getPromptSelectionRange,
	insertPromptSourceToken,
	readPromptEditor,
	renderPromptEditor,
} from "./prompt-editor-dom";
import type { ConnectedPromptSource } from "./prompt-sources";
import { PromptSourceMentionMenu } from "./PromptSourceMentionMenu";

interface ContentGeneratorPromptEditorProps {
	data: ContentNodeData;
	sources: readonly ConnectedPromptSource[];
	disabled: boolean;
	onDraftChange: (data: ContentNodeData) => void;
	onCommit: (data: ContentNodeData) => void;
	onSubmit: () => void;
}

const EMPTY_ASSETS: ReadonlyMap<string, ContentAsset> = new Map();

export function ContentGeneratorPromptEditor({
	data,
	sources,
	disabled,
	onDraftChange,
	onCommit,
	onSubmit,
}: ContentGeneratorPromptEditorProps) {
	const { t } = useTranslation();
	const editorRef = useRef<HTMLDivElement>(null);
	const draftRef = useRef(data);
	const selectionRangeRef = useRef<Range | null>(null);
	const mentionRangeRef = useRef<Range | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [mentionQuery, setMentionQuery] = useState("");
	const [highlightedIndex, setHighlightedIndex] = useState(0);
	const removeLabel = t("nodeEditor.promptReference.remove");
	const promptLabelByNodeId = useMemo(
		() =>
			new Map(
				sources.map((source, index) => [
					source.nodeId,
					source.label?.trim() || t("nodeEditor.prompt.source.connected", { index: index + 1 }),
				]),
			),
		[sources, t],
	);
	const selectedSourceIds = new Set(
		listContentPromptSourceNodeIds(createGeneratorPromptDocument(data, sources)),
	);
	const normalizedQuery = mentionQuery.trim().toLocaleLowerCase();
	const mentionOptions = sources.filter((source, index) => {
		if (selectedSourceIds.has(source.nodeId)) return false;
		const label = source.label?.trim() || t("nodeEditor.prompt.source.connected", { index: index + 1 });
		return (
			!normalizedQuery ||
			label.toLocaleLowerCase().includes(normalizedQuery) ||
			source.prompt.toLocaleLowerCase().includes(normalizedQuery)
		);
	});

	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) {
			draftRef.current = data;
			return;
		}
		const incomingDocument = createGeneratorPromptDocument(data, sources);
		const currentDocument = createGeneratorPromptDocument(draftRef.current, sources);
		const isEditing = editor === editor.ownerDocument.activeElement;
		draftRef.current = data;
		if (isEditing && contentPromptDocumentsEqual(incomingDocument, currentDocument)) return;
		renderPromptEditor(editor, incomingDocument, EMPTY_ASSETS, promptLabelByNodeId, removeLabel);
	}, [data, promptLabelByNodeId, removeLabel]);

	const syncDraftFromEditor = () => {
		const editor = editorRef.current;
		if (!editor) return draftRef.current;
		const promptDocument = readPromptEditor(editor);
		const next = {
			...draftRef.current,
			prompt: contentPromptText(promptDocument),
			promptDocument,
			promptSourceNodeId: undefined,
		};
		draftRef.current = next;
		return next;
	};
	const closeMenu = () => {
		setMenuOpen(false);
		setMentionQuery("");
		setHighlightedIndex(0);
		mentionRangeRef.current = null;
	};
	const updateMentionState = () => {
		const editor = editorRef.current;
		if (!editor) return;
		selectionRangeRef.current = getPromptSelectionRange(editor);
		const mention = getPromptMentionContext(editor);
		mentionRangeRef.current = mention?.range ?? null;
		if (!mention) {
			closeMenu();
			return;
		}
		setMentionQuery(mention.query);
		setHighlightedIndex(0);
		setMenuOpen(true);
	};
	const selectSource = (source: ConnectedPromptSource) => {
		const editor = editorRef.current;
		if (!editor) return;
		insertPromptSourceToken(
			editor,
			mentionRangeRef.current ?? selectionRangeRef.current,
			source.nodeId,
			promptLabelByNodeId.get(source.nodeId) ?? source.nodeId,
			removeLabel,
		);
		const next = syncDraftFromEditor();
		closeMenu();
		onCommit(next);
	};
	const openManualPicker = () => {
		const editor = editorRef.current;
		if (editor) selectionRangeRef.current = getPromptSelectionRange(editor);
		mentionRangeRef.current = null;
		setMentionQuery("");
		setHighlightedIndex(0);
		setMenuOpen(true);
	};
	const removeSourceToken = (sourceNodeId: string) => {
		const editor = editorRef.current;
		const token = editor?.querySelector<HTMLElement>(
			`[data-prompt-source-node-id="${CSS.escape(sourceNodeId)}"]`,
		);
		if (!token) return;
		token.remove();
		onCommit(syncDraftFromEditor());
	};
	const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const removeTarget = (event.target as HTMLElement).dataset.removePromptSourceNodeId;
		if (removeTarget && (event.key === "Enter" || event.key === " ")) {
			event.preventDefault();
			removeSourceToken(removeTarget);
			return;
		}
		if (menuOpen) {
			if (event.key === "Escape") {
				event.preventDefault();
				closeMenu();
				return;
			}
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const direction = event.key === "ArrowDown" ? 1 : -1;
				setHighlightedIndex((current) =>
					mentionOptions.length === 0
						? 0
						: (current + direction + mentionOptions.length) % mentionOptions.length,
				);
				return;
			}
			if (event.key === "Enter" && mentionOptions[highlightedIndex]) {
				event.preventDefault();
				selectSource(mentionOptions[highlightedIndex]);
				return;
			}
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			onSubmit();
		}
	};

	return (
		<Popover open={menuOpen} onOpenChange={(open) => (open ? setMenuOpen(true) : closeMenu())}>
			<div className="overflow-hidden rounded-xl border border-border/65 bg-background/35 transition-colors focus-within:border-primary/45 focus-within:bg-background/55">
				<PopoverAnchor asChild>
					<div
						ref={editorRef}
						className="min-h-[76px] whitespace-pre-wrap break-words px-3 py-3 text-[13px] leading-6 text-foreground outline-none empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
						contentEditable={!disabled}
						suppressContentEditableWarning
						role="textbox"
						aria-multiline="true"
						aria-label={t("nodeEditor.prompt")}
						data-placeholder={t("nodeEditor.generatorPrompt.placeholder")}
						onInput={() => {
							const next = syncDraftFromEditor();
							onDraftChange(next);
							updateMentionState();
						}}
						onKeyUp={() => {
							const editor = editorRef.current;
							if (editor) selectionRangeRef.current = getPromptSelectionRange(editor);
						}}
						onKeyDown={handleEditorKeyDown}
						onBlur={() => onCommit(syncDraftFromEditor())}
						onClick={(event) => {
							const target = (event.target as HTMLElement).closest<HTMLElement>(
								"[data-remove-prompt-source-node-id]",
							);
							if (target?.dataset.removePromptSourceNodeId) {
								event.preventDefault();
								removeSourceToken(target.dataset.removePromptSourceNodeId);
							}
						}}
					/>
				</PopoverAnchor>
				<div className="flex items-center justify-between gap-2 border-t border-border/50 px-2 py-1.5">
					<span className="px-1 text-[10px] text-muted-foreground">
						{t("nodeEditor.generatorPrompt.inlineHint")}
					</span>
					<Button
						type="button"
						size="icon-xs"
						variant="ghost"
						disabled={disabled || mentionOptions.length === 0}
						title={t("nodeEditor.promptReference.manual")}
						onMouseDown={(event) => event.preventDefault()}
						onClick={openManualPicker}
					>
						<span className="text-[13px] font-semibold" aria-hidden="true">
							@
						</span>
					</Button>
				</div>
			</div>
			<PopoverContent
				align="end"
				side="bottom"
				className="w-80 gap-1.5 p-1.5"
				onOpenAutoFocus={(event) => event.preventDefault()}
			>
				<PromptSourceMentionMenu
					options={mentionOptions}
					query={mentionQuery}
					highlightedIndex={highlightedIndex}
					onSelect={selectSource}
				/>
			</PopoverContent>
		</Popover>
	);
}

function createGeneratorPromptDocument(
	data: ContentNodeData,
	sources: readonly ConnectedPromptSource[],
): ContentPromptDocument {
	const document = createContentPromptDocument(data, { includeInputBindings: false });
	if (
		data.promptDocument ||
		data.promptSourceNodeId !== undefined ||
		data.prompt?.trim() ||
		!sources[0]
	) {
		return document;
	}
	return {
		version: 1,
		segments: [{ type: "prompt-reference", sourceNodeId: sources[0].nodeId }],
	};
}
