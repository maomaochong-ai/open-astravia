import type { FilePreviewItem } from "@vetta/theme-ui/file-preview";
import { LightboxImageView } from "@vetta/theme-ui/file-preview";
import { useImageSrc, useLightboxImageModel } from "../hooks/useLightboxImageModel";

export { useImageSrc };

interface LightboxImageProps {
	item: FilePreviewItem;
	onClose: () => void;
}

/**
 * 灯箱图片视图：直接滚轮缩放、缩放后拖拽平移、原比例下上滑拖拽淡出关闭。
 * 由 FilePreviewDialog 以 key=当前图 重挂载，因此内部状态无需跨图重置。
 */
export function LightboxImage({ item, onClose }: LightboxImageProps): JSX.Element {
	const model = useLightboxImageModel(item, onClose);
	return <LightboxImageView {...model} />;
}
