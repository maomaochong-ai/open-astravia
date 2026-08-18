import { pluginFilePreviewsAtom } from "@shared/store/atoms";
import {
	AUDIO_EXTENSIONS,
	IMAGE_EXTENSIONS,
	PreviewBodyView,
	VIDEO_EXTENSIONS,
	getExtension,
	getPreviewLabel,
	type FilePreviewItem,
} from "@vetta/theme-ui/file-preview";
import { useAtomValue } from "jotai";
import { usePreviewBodyModel } from "../hooks/usePreviewBodyModel";
import { downloadItem, isPreviewSupported, isTextExtension } from "../preview-utils";
import { EditableTextFileView } from "./EditableTextFileView";

export {
	AUDIO_EXTENSIONS,
	IMAGE_EXTENSIONS,
	VIDEO_EXTENSIONS,
	getExtension,
	getPreviewLabel,
	downloadItem,
	isPreviewSupported,
};

/**
 * 扩展名 → 预览组件的分发 + 加载状态机 + 文件实时刷新。
 * 内嵌预览（FilePreviewView）与全局灯箱（FilePreviewDialog）共用。
 */
export function PreviewBody({
	item,
	refreshNonce = 0,
	editable = false,
}: {
	item: FilePreviewItem;
	refreshNonce?: number;
	editable?: boolean;
}): JSX.Element {
	const extension = getExtension(item.name);
	const pluginPreviews = useAtomValue(pluginFilePreviewsAtom);
	const pluginOwnsPreview = pluginPreviews.some((preview) => preview.extensions.includes(extension));
	if (editable && item.path && isTextExtension(extension) && !pluginOwnsPreview) {
		return (
			<EditableTextFileView
				item={{ ...item, path: item.path }}
				refreshNonce={refreshNonce}
			/>
		);
	}
	return <ReadonlyPreviewBody item={item} refreshNonce={refreshNonce} />;
}

function ReadonlyPreviewBody({
	item,
	refreshNonce,
}: {
	item: FilePreviewItem;
	refreshNonce: number;
}): JSX.Element {
	const model = usePreviewBodyModel(item, refreshNonce);
	return <PreviewBodyView {...model} />;
}
