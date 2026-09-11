import { conversationTagEditorAtom, conversationTagsAtom } from "@shared/store/atoms";
import type { ConversationTagEditorDialogViewProps } from "@vetta/theme-ui/project";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CONVERSATION_TAG_PRESET_COLORS, conversationCountForTag } from "../../../../shared/conversation-tags";

export function useConversationTagEditorModel(): ConversationTagEditorDialogViewProps | null {
	const { t } = useTranslation("project");
	const [editor, setEditor] = useAtom(conversationTagEditorAtom);
	const snapshot = useAtomValue(conversationTagsAtom);

	const close = useCallback(() => setEditor(null), [setEditor]);

	const tags = useMemo(
		() =>
			snapshot.tags.map((tag) => ({
				id: tag.id,
				name: tag.name,
				color: tag.color,
				removeHint: t("tagEditor.removeHint", { count: conversationCountForTag(snapshot, tag.id) }),
			})),
		[snapshot, t],
	);

	const create = useCallback(
		(input: { name: string; color: string }) => {
			void window.vetta.conversationTags.create({
				...input,
				sessionPath: editor?.mode === "create" ? editor.sessionPath : undefined,
			});
		},
		[editor],
	);

	const rename = useCallback((input: { id: string; name: string }) => {
		void window.vetta.conversationTags.update(input);
	}, []);

	const recolor = useCallback((input: { id: string; color: string }) => {
		void window.vetta.conversationTags.update(input);
	}, []);

	const remove = useCallback((tagId: string) => {
		void window.vetta.conversationTags.remove(tagId);
	}, []);

	if (!editor) return null;

	return {
		mode: editor.mode,
		tags,
		presetColors: CONVERSATION_TAG_PRESET_COLORS,
		labels: {
			createTitle: t("tagEditor.createTitle"),
			manageTitle: t("tagEditor.manageTitle"),
			namePlaceholder: t("tagEditor.namePlaceholder"),
			colorLabel: t("tagEditor.colorLabel"),
			customColor: t("tagEditor.customColor"),
			emptyNameError: t("tagEditor.emptyNameError"),
			cancel: t("tagEditor.cancel"),
			create: t("tagEditor.create"),
			done: t("tagEditor.done"),
			newTag: t("tagEditor.newTag"),
			remove: t("tagEditor.remove"),
			empty: t("tagEditor.empty"),
		},
		onCreate: create,
		onRename: rename,
		onRecolor: recolor,
		onRemove: remove,
		onClose: close,
	};
}
