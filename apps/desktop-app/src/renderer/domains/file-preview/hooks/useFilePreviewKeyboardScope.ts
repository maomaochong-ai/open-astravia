import { type ShortcutBinding, useShortcutScope } from "@shared/shortcuts";
import { type FilePreviewItem, getExtension, IMAGE_EXTENSIONS } from "@vetta/theme-ui/file-preview";
import { useMemo } from "react";

function isImageItem(item: FilePreviewItem | null | undefined): boolean {
	if (!item) return false;
	const ext = getExtension(item.name) || (item.path ? getExtension(item.path) : "");
	return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Surface-scope shortcuts for inline / activity-panel file preview.
 *
 * - Images: ← → browse siblings, Esc close (always).
 * - Text / other: ← → only when focus is NOT in the editor; Esc same.
 *   So CodeMirror keeps arrow keys while editing.
 */
export function useFilePreviewKeyboardScope(options: {
	active: boolean;
	item: FilePreviewItem | null;
	canPrev: boolean;
	canNext: boolean;
	onPrev?: () => void;
	onNext?: () => void;
	onClose: () => void;
}): void {
	const { active, item, canPrev, canNext, onPrev, onNext, onClose } = options;
	const image = isImageItem(item);

	const bindings = useMemo((): ShortcutBinding[] => {
		const list: ShortcutBinding[] = [];
		const when = image ? "always" : "not-editable";

		if (onPrev) {
			list.push({
				key: "arrowleft",
				when,
				run: () => {
					if (canPrev) onPrev();
				},
			});
		}
		if (onNext) {
			list.push({
				key: "arrowright",
				when,
				run: () => {
					if (canNext) onNext();
				},
			});
		}
		list.push({
			key: "escape",
			when,
			run: () => onClose(),
		});
		return list;
	}, [image, canPrev, canNext, onPrev, onNext, onClose]);

	useShortcutScope({
		id: "surface:file-preview",
		kind: "surface",
		active: active && item != null,
		exclusive: false,
		bindings,
	});
}
