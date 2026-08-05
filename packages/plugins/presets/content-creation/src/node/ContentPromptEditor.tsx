import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button, Popover, PopoverAnchor, PopoverContent } from "@vetta/ui";
import { type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ImportedContentReference } from "../generation/types";
import type { ContentAsset, ContentNodeData, ContentNodeInputBinding } from "../project/types";
import {
	contentPromptDocumentsEqual,
	contentPromptText,
	createContentPromptDocument,
	listContentPromptBindingIds,
} from "./prompt-document";
import {
	getPromptMentionContext,
	getPromptSelectionRange,
	insertPromptAssetToken,
	placePromptCaretAtEnd,
	readPromptEditor,
	refreshPromptEditorAssetPreviews,
	renderPromptEditor,
} from "./prompt-editor-dom";
import { PromptAssetMentionMenu } from "./PromptAssetMentionMenu";
import { PROMPT_REFERENCE_SLOT_ID } from "./prompt-sources";
import type { ContentAssetReferenceCandidate } from "./reference-candidates";
import { readImportedMediaFile } from "./readImportedMediaFile";

interface ContentPromptEditorProps {
	data: ContentNodeData;
	mentionAssets: readonly ContentAssetReferenceCandidate[];
	referenceAssets: readonly { binding: ContentNodeInputBinding; asset: ContentAsset }[];
	focusPromptRequest: number;
	onUpdate: (data: ContentNodeData) => Promise<void>;
	onImportReferences: (files: readonly ImportedContentReference[]) => Promise<void>;
}

const EMPTY_PROMPT_LABELS = new Map<string, string>();

export function ContentPromptEditor({
	data,
	mentionAssets,
	referenceAssets,
	focusPromptRequest,
	onUpdate,
	onImportReferences,
}: ContentPromptEditorProps) {
	const { t } = useTranslation();
	const editorRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const draftRef = useRef(data);
	const selectionRangeRef = useRef<Range | null>(null);
	const mentionRangeRef = useRef<Range | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [mentionQuery, setMentionQuery] = useState("");
	const [highlightedIndex, setHighlightedIndex] = useState(0);
	const removeReferenceLabel = t("nodeEditor.reference.remove");
	const assetById = useMemo(
		() =>
			new Map(
				[
					...referenceAssets.map(({ asset }) => asset),
					...mentionAssets.map(({ asset }) => asset),
				].map((asset) => [asset.id, asset]),
			),
		[mentionAssets, referenceAssets],
	);
	const assetByBindingId = useMemo(
		() =>
			new Map(
				(data.inputs ?? []).flatMap((binding) => {
					const asset = assetById.get(binding.assetId);
					return asset ? [[binding.id, asset] as const] : [];
				}),
			),
		[data.inputs, assetById],
	);
	const normalizedQuery = mentionQuery.trim().toLocaleLowerCase();
	const mentionOptions = mentionAssets.filter(
		({ asset }) =>
			!normalizedQuery ||
			asset.name.toLocaleLowerCase().includes(normalizedQuery) ||
			t(`asset.kind.${asset.kind}`).toLocaleLowerCase().includes(normalizedQuery),
	);

	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) {
			draftRef.current = data;
			return;
		}
		const incomingDocument = createContentPromptDocument(data);
		const currentDocument = createContentPromptDocument(draftRef.current);
		const isEditing = editor === editor.ownerDocument.activeElement;
		draftRef.current = data;
		if (isEditing && contentPromptDocumentsEqual(incomingDocument, currentDocument)) {
			refreshPromptEditorAssetPreviews(editor, assetByBindingId);
			return;
		}
		renderPromptEditor(
			editor,
			incomingDocument,
			assetByBindingId,
			EMPTY_PROMPT_LABELS,
			removeReferenceLabel,
		);
	}, [assetByBindingId, data, removeReferenceLabel]);
	useEffect(() => {
		if (focusPromptRequest === 0) return;
		const frame = window.requestAnimationFrame(() => {
			const editor = editorRef.current;
			if (editor) placePromptCaretAtEnd(editor);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [focusPromptRequest]);

	const syncDraftFromEditor = () => {
		const editor = editorRef.current;
		if (!editor) return draftRef.current;
		const promptDocument = readPromptEditor(editor);
		const referencedBindingIds = new Set(listContentPromptBindingIds(promptDocument));
		const next = {
			...draftRef.current,
			prompt: contentPromptText(promptDocument),
			promptDocument,
			inputs: (draftRef.current.inputs ?? []).filter((binding) => referencedBindingIds.has(binding.id)),
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
	const selectAsset = (option: ContentAssetReferenceCandidate) => {
		const editor = editorRef.current;
		if (!editor) return;
		const existingBinding = (draftRef.current.inputs ?? []).find(
			(binding) => binding.assetId === option.asset.id,
		);
		const binding =
			existingBinding ??
			({
				id: crypto.randomUUID(),
				assetId: option.asset.id,
				slotId: PROMPT_REFERENCE_SLOT_ID,
				sourceNodeId: option.sourceNodeId,
			} satisfies ContentNodeInputBinding);
		if (!existingBinding) {
			draftRef.current = {
				...draftRef.current,
				inputs: [...(draftRef.current.inputs ?? []), binding],
			};
		}
		insertPromptAssetToken(
			editor,
			mentionRangeRef.current ?? selectionRangeRef.current,
			binding.id,
			option.asset,
			removeReferenceLabel,
		);
		const next = syncDraftFromEditor();
		closeMenu();
		void onUpdate(next);
	};
	const openManualPicker = () => {
		const editor = editorRef.current;
		if (editor) selectionRangeRef.current = getPromptSelectionRange(editor);
		mentionRangeRef.current = null;
		setMentionQuery("");
		setHighlightedIndex(0);
		setMenuOpen(true);
	};
	const removeReferenceToken = (bindingId: string) => {
		const editor = editorRef.current;
		const token = editor?.querySelector<HTMLElement>(`[data-prompt-binding-id="${CSS.escape(bindingId)}"]`);
		if (!token) return;
		token.remove();
		const next = syncDraftFromEditor();
		void onUpdate(next);
	};
	const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const removeTarget = (event.target as HTMLElement).dataset.removePromptBindingId;
		if (removeTarget && (event.key === "Enter" || event.key === " ")) {
			event.preventDefault();
			removeReferenceToken(removeTarget);
			return;
		}
		if (!menuOpen) return;
		if (event.key === "Escape") {
			event.preventDefault();
			closeMenu();
			return;
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const direction = event.key === "ArrowDown" ? 1 : -1;
			setHighlightedIndex((current) =>
				mentionOptions.length === 0 ? 0 : (current + direction + mentionOptions.length) % mentionOptions.length,
			);
			return;
		}
		if (event.key === "Enter" && mentionOptions[highlightedIndex]) {
			event.preventDefault();
			selectAsset(mentionOptions[highlightedIndex]);
		}
	};
	const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? []);
		event.target.value = "";
		if (files.length === 0) return;
		await onUpdate(syncDraftFromEditor());
		await onImportReferences(await Promise.all(files.map(readImportedMediaFile)));
	};

	return (
		<div
			className="nodrag nopan nowheel min-w-0 max-w-[calc(100vw-32px)] rounded-2xl border border-border/70 bg-card/95 p-2.5 text-card-foreground shadow-lg backdrop-blur-md"
			style={{ width: "min(420px, calc(100vw - 32px))" }}
			onPointerDown={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<Popover open={menuOpen} onOpenChange={(open) => (open ? setMenuOpen(true) : closeMenu())}>
				<div className="overflow-hidden rounded-xl border border-border/65 bg-background/40 focus-within:border-primary/45">
					<PopoverAnchor asChild>
						<div
							ref={editorRef}
							className="min-h-28 whitespace-pre-wrap break-words px-3 py-3 text-[13px] leading-6 text-foreground outline-none empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
							contentEditable
							suppressContentEditableWarning
							role="textbox"
							aria-multiline="true"
							aria-label={t("nodeEditor.prompt")}
							data-placeholder={t("nodeEditor.prompt.placeholder")}
							onInput={() => {
								syncDraftFromEditor();
								updateMentionState();
							}}
							onKeyUp={() => {
								const editor = editorRef.current;
								if (editor) selectionRangeRef.current = getPromptSelectionRange(editor);
							}}
							onKeyDown={handleEditorKeyDown}
							onBlur={() => void onUpdate(syncDraftFromEditor())}
							onClick={(event) => {
								const target = (event.target as HTMLElement).closest<HTMLElement>(
									"[data-remove-prompt-binding-id]",
								);
								if (target?.dataset.removePromptBindingId) {
									event.preventDefault();
									removeReferenceToken(target.dataset.removePromptBindingId);
								}
							}}
						/>
					</PopoverAnchor>
					<div className="flex items-center justify-between gap-2 border-t border-border/55 px-2 py-1.5">
						<span className="px-1 text-[10px] text-muted-foreground">
							{t("nodeEditor.prompt.mention.inlineHint")}
						</span>
						<div className="flex items-center gap-0.5">
							<Button
								type="button"
								size="icon-xs"
								variant="ghost"
								disabled={mentionAssets.length === 0}
								title={t("nodeEditor.prompt.mention.manual")}
								onMouseDown={(event) => event.preventDefault()}
								onClick={openManualPicker}
							>
								<span className="text-[13px] font-semibold" aria-hidden="true">
									@
								</span>
							</Button>
							<Button
								type="button"
								size="icon-xs"
								variant="ghost"
								title={t("nodeEditor.prompt.mention.upload")}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => fileInputRef.current?.click()}
							>
								<span className="icon-[lucide--paperclip] block size-3.5" aria-hidden="true" />
							</Button>
							<input
								ref={fileInputRef}
								className="hidden"
								type="file"
								multiple
								accept="image/*,video/*,audio/*"
								onChange={(event) => void handleFiles(event)}
							/>
						</div>
					</div>
				</div>
				<PopoverContent
					align="end"
					side="bottom"
					className="w-80 gap-1.5 p-1.5"
					onOpenAutoFocus={(event) => event.preventDefault()}
				>
					<PromptAssetMentionMenu
						options={mentionOptions}
						query={mentionQuery}
						highlightedIndex={highlightedIndex}
						onSelect={selectAsset}
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
}
