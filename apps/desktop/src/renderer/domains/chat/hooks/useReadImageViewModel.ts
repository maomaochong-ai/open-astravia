import type { ReadImageViewProps } from "@vetta/theme-ui/chat";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes, formatDimensions } from "../components/blocks/tool-views/shared/format";

/** Minimal image preview shape for read-image tool UI. */
export interface ToolImagePreviewLike {
	mimeType: string;
	data: string;
	processedWidth?: number;
	processedHeight?: number;
	originalWidth?: number;
	originalHeight?: number;
	wasResized?: boolean;
	processedSizeBytes?: number;
	originalSizeBytes?: number;
	originalPath?: string;
}

export function useReadImageViewModel(image: ToolImagePreviewLike): ReadImageViewProps {
	const { t } = useTranslation("chat");

	return useMemo(() => {
		const processedWidth = image.processedWidth && image.processedWidth > 0 ? image.processedWidth : undefined;
		const processedHeight = image.processedHeight && image.processedHeight > 0 ? image.processedHeight : undefined;
		const originalWidth = image.originalWidth && image.originalWidth > 0 ? image.originalWidth : undefined;
		const originalHeight = image.originalHeight && image.originalHeight > 0 ? image.originalHeight : undefined;
		const wasProcessed = image.wasResized === true;
		const originalPath = image.originalPath ?? null;

		const hostProcessedDims =
			processedWidth !== undefined && processedHeight !== undefined
				? formatDimensions(processedWidth, processedHeight)
				: null;

		const originalLine =
			wasProcessed && (originalWidth !== undefined || image.originalSizeBytes !== undefined)
				? `${t("imagePreview.originalLabel")} ${formatDimensions(originalWidth, originalHeight)} · ${formatBytes(image.originalSizeBytes)}`
				: null;

		return {
			src: `data:${image.mimeType};base64,${image.data}`,
			alt: t("imagePreview.altText"),
			sizeLinePrefix: wasProcessed ? t("imagePreview.processedLabel") : t("imagePreview.imageLabel"),
			processedSizeLabel: formatBytes(image.processedSizeBytes),
			hostProcessedDims,
			unknownDimsLabel: formatDimensions(undefined, undefined),
			originalLine,
			originalPath,
			showInFolderLabel: t("imagePreview.showInFolderButton"),
			onOpenOriginal: originalPath
				? () => {
						void window.vetta.shell.showItemInFolder(originalPath);
					}
				: undefined,
		};
	}, [image, t]);
}
