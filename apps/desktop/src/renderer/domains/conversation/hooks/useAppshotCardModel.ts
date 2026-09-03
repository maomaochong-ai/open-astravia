import { pathBasename } from "@shared/lib/utils";
import { filePreviewAtom } from "@shared/store/atoms";
import type { AppshotCardViewLabels } from "@vetta/theme-ui/chat";
import { useSetAtom } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AppshotCardData } from "../components/AppshotCard";

function mediaUrl(path: string): string {
	return `vetta-media://local/stream?${new URLSearchParams({ path }).toString()}`;
}

export interface AppshotCardModel {
	imageSrc: string | null;
	iconSrc: string | null;
	label: string;
	labels: AppshotCardViewLabels;
	onPreview?: () => void;
}

export function useAppshotCardModel(data: AppshotCardData): AppshotCardModel {
	const { t } = useTranslation("chat");
	const setFilePreview = useSetAtom(filePreviewAtom);
	const { imagePath, iconPath, appName, windowTitle, documentPath } = data;

	const label = documentPath
		? pathBasename(documentPath)
		: windowTitle
			? `${appName ? `${appName} · ` : ""}${windowTitle}`
			: appName || (imagePath ? pathBasename(imagePath) : "");

	const labels = useMemo(
		(): AppshotCardViewLabels => ({
			previewTitle: t("inputBar.capsule.appshotPreview"),
			thumbnailAlt: t("inputBar.capsule.appshotThumbnailAlt"),
			iconAlt: t("inputBar.capsule.appshotIconAlt"),
			removeTitle: t("inputBar.capsule.removeDefault"),
		}),
		[t],
	);

	return {
		imageSrc: imagePath ? mediaUrl(imagePath) : null,
		iconSrc: iconPath ? mediaUrl(iconPath) : null,
		label,
		labels,
		onPreview: imagePath ? () => setFilePreview({ name: pathBasename(imagePath), path: imagePath }) : undefined,
	};
}
