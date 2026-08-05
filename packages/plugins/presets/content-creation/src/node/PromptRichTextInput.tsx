import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button, Popover, PopoverAnchor, PopoverContent } from "@vetta/ui";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { ContentAsset, ContentPromptDocument } from "../project/types";
import { contentPromptDocumentsEqual } from "./prompt-document";
import {
	getPromptMentionContext,
	getPromptSelectionRange,
	insertPromptAssetToken,
	insertPromptSourceToken,
	placePromptCaretAtEnd,
	readPromptEditor,
	refreshPromptEditorAssetPreviews,
	renderPromptEditor,
} from "./prompt-editor-dom";
import { PromptMentionMenu, type PromptMentionOption } from "./PromptMentionMenu";

export type PromptMentionInsertion =
	| { type: "asset"; bindingId: string; asset: ContentAsset }
	| { type: "prompt"; sourceNodeId: string; label: string };

interface PromptRichTextInputProps {
	document: ContentPromptDocument;
	assetByBindingId: ReadonlyMap<string, ContentAsset>;
	promptLabelByNodeId: ReadonlyMap<string, string>;
	mentionOptions: readonly PromptMentionOption[];
	disabled?: boolean;
	size: "compact" | "regular";
	placeholder: string;
	inlineHint: string;
	menuTitle: string;
	emptyMessage: string;
	manualTitle: string;
	removeLabel: string;
	focusRequest?: number;
	onResolveMention: (option: PromptMentionOption) => PromptMentionInsertion | null;
	onChange: (document: ContentPromptDocument) => void;
	onCommit: (document: ContentPromptDocument) => void;
	onSubmit?: () => void;
	onUpload?: () => void;
	uploadTitle?: string;
}

export function PromptRichTextInput({
	document,
	assetByBindingId,
	promptLabelByNodeId,
	mentionOptions: allMentionOptions,
	disabled = false,
	size,
	placeholder,
	inlineHint,
	menuTitle,
	emptyMessage,
	manualTitle,
	removeLabel,
	focusRequest = 0,
	onResolveMention,
	onChange,
	onCommit,
	onSubmit,
	onUpload,
	uploadTitle,
}: PromptRichTextInputProps) {
	const { t } = useTranslation();
	const editorRef = useRef<HTMLDivElement>(null);
	const draftDocumentRef = useRef(document);
	const selectionRangeRef = useRef<Range | null>(null);
	const mentionRangeRef = useRef<Range | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [mentionQuery, setMentionQuery] = useState("");
	const [highlightedIndex, setHighlightedIndex] = useState(0);
	const normalizedQuery = mentionQuery.trim().toLocaleLowerCase();
	const mentionOptions = allMentionOptions.filter((option) => {
		if (!normalizedQuery) return true;
		if (option.type === "prompt") {
			return (
				option.label.toLocaleLowerCase().includes(normalizedQuery) ||
				option.source.prompt.toLocaleLowerCase().includes(normalizedQuery)
			);
		}
		return (
			option.candidate.asset.name.toLocaleLowerCase().includes(normalizedQuery) ||
			t(`asset.kind.${option.candidate.asset.kind}`).toLocaleLowerCase().includes(normalizedQuery)
		);
	});

	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) {
			draftDocumentRef.current = document;
			return;
		}
		const isEditing = editor === editor.ownerDocument.activeElement;
		const currentDocument = draftDocumentRef.current;
		draftDocumentRef.current = document;
		if (isEditing && contentPromptDocumentsEqual(document, currentDocument)) {
			refreshPromptEditorAssetPreviews(editor, assetByBindingId);
			return;
		}
		renderPromptEditor(editor, document, assetByBindingId, promptLabelByNodeId, removeLabel);
	}, [assetByBindingId, document, promptLabelByNodeId, removeLabel]);
	useEffect(() => {
		if (focusRequest === 0) return;
		const frame = window.requestAnimationFrame(() => {
			const editor = editorRef.current;
			if (editor) placePromptCaretAtEnd(editor);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [focusRequest]);

	const closeMenu = () => {
		setMenuOpen(false);
		setMentionQuery("");
		setHighlightedIndex(0);
		mentionRangeRef.current = null;
	};
	const emitDocument = (commit: boolean) => {
		const editor = editorRef.current;
		if (!editor) return;
		const nextDocument = readPromptEditor(editor);
		draftDocumentRef.current = nextDocument;
		if (commit) onCommit(nextDocument);
		else onChange(nextDocument);
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
	const selectMention = (option: PromptMentionOption) => {
		const editor = editorRef.current;
		if (!editor) return;
		const insertion = onResolveMention(option);
		if (!insertion) return;
		const range = mentionRangeRef.current ?? selectionRangeRef.current;
		if (insertion.type === "asset") {
			insertPromptAssetToken(
				editor,
				range,
				insertion.bindingId,
				insertion.asset,
				removeLabel,
			);
		} else {
			insertPromptSourceToken(
				editor,
				range,
				insertion.sourceNodeId,
				insertion.label,
				removeLabel,
			);
		}
		closeMenu();
		emitDocument(true);
	};
	const openManualPicker = () => {
		const editor = editorRef.current;
		if (editor) selectionRangeRef.current = getPromptSelectionRange(editor);
		mentionRangeRef.current = null;
		setMentionQuery("");
		setHighlightedIndex(0);
		setMenuOpen(true);
	};
	const removeToken = (selector: string) => {
		const token = editorRef.current?.querySelector<HTMLElement>(selector);
		if (!token) return;
		token.remove();
		emitDocument(true);
	};
	const removeAssetToken = (bindingId: string) => {
		removeToken(`[data-prompt-binding-id="${CSS.escape(bindingId)}"]`);
	};
	const removeSourceToken = (sourceNodeId: string) => {
		removeToken(`[data-prompt-source-node-id="${CSS.escape(sourceNodeId)}"]`);
	};
	const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const target = event.target as HTMLElement;
		const removeBindingId = target.dataset.removePromptBindingId;
		if (removeBindingId && (event.key === "Enter" || event.key === " ")) {
			event.preventDefault();
			removeAssetToken(removeBindingId);
			return;
		}
		const removeSourceNodeId = target.dataset.removePromptSourceNodeId;
		if (removeSourceNodeId && (event.key === "Enter" || event.key === " ")) {
			event.preventDefault();
			removeSourceToken(removeSourceNodeId);
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
			if (event.key === "Enter") {
				event.preventDefault();
				const option = mentionOptions[highlightedIndex];
				if (option) selectMention(option);
				return;
			}
		}
		if (onSubmit && event.key === "Enter" && !event.shiftKey) {
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
						className={`${size === "regular" ? "min-h-28" : "min-h-[76px]"} whitespace-pre-wrap break-words px-3 py-3 text-[13px] leading-6 text-foreground outline-none empty:before:pointer-events-none empty:before:text-[12px] empty:before:font-normal empty:before:text-muted-foreground/25 empty:before:content-[attr(data-placeholder)]`}
						contentEditable={!disabled}
						suppressContentEditableWarning
						role="textbox"
						aria-multiline="true"
						aria-label={t("nodeEditor.prompt")}
						data-placeholder={placeholder}
						onInput={() => {
							emitDocument(false);
							updateMentionState();
						}}
						onKeyUp={() => {
							const editor = editorRef.current;
							if (editor) selectionRangeRef.current = getPromptSelectionRange(editor);
						}}
						onKeyDown={handleEditorKeyDown}
						onBlur={() => emitDocument(true)}
						onClick={(event) => {
							const assetTarget = (event.target as HTMLElement).closest<HTMLElement>(
								"[data-remove-prompt-binding-id]",
							);
							if (assetTarget?.dataset.removePromptBindingId) {
								event.preventDefault();
								removeAssetToken(assetTarget.dataset.removePromptBindingId);
								return;
							}
							const sourceTarget = (event.target as HTMLElement).closest<HTMLElement>(
								"[data-remove-prompt-source-node-id]",
							);
							if (sourceTarget?.dataset.removePromptSourceNodeId) {
								event.preventDefault();
								removeSourceToken(sourceTarget.dataset.removePromptSourceNodeId);
							}
						}}
					/>
				</PopoverAnchor>
				<div className="flex items-center justify-between gap-2 border-t border-border/50 px-2 py-1.5">
					<span className="px-1 text-[10px] text-muted-foreground">{inlineHint}</span>
					<div className="flex items-center gap-0.5">
						<Button
							type="button"
							size="icon-xs"
							variant="ghost"
							disabled={disabled || allMentionOptions.length === 0}
							title={manualTitle}
							onMouseDown={(event) => event.preventDefault()}
							onClick={openManualPicker}
						>
							<span className="text-[13px] font-semibold" aria-hidden="true">
								@
							</span>
						</Button>
						{onUpload ? (
							<Button
								type="button"
								size="icon-xs"
								variant="ghost"
								disabled={disabled}
								title={uploadTitle}
								onMouseDown={(event) => event.preventDefault()}
								onClick={onUpload}
							>
								<span className="icon-[lucide--paperclip] block size-3.5" aria-hidden="true" />
							</Button>
						) : null}
					</div>
				</div>
			</div>
			<PopoverContent
				align="end"
				side="bottom"
				className="w-80 gap-1.5 p-1.5"
				onOpenAutoFocus={(event) => event.preventDefault()}
			>
				<PromptMentionMenu
					options={mentionOptions}
					query={mentionQuery}
					highlightedIndex={highlightedIndex}
					title={menuTitle}
					emptyMessage={emptyMessage}
					onSelect={selectMention}
				/>
			</PopoverContent>
		</Popover>
	);
}
