import type { FilePreviewItem } from "@vetta/theme-ui/file-preview";
import { getExtension, type LightboxImageViewProps } from "@vetta/theme-ui/file-preview";
import { useEffect, useState } from "react";

const MIME_MAP: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	ico: "image/x-icon",
};

export function useImageSrc(item: FilePreviewItem): { src: string; error: boolean } {
	const [src, setSrc] = useState("");
	const [error, setError] = useState(false);
	useEffect(() => {
		setSrc("");
		setError(false);
		let cancelled = false;
		if (item.url) {
			setSrc(item.url);
			return;
		}
		if (!item.path) {
			setError(true);
			return;
		}
		void window.vetta.fs
			.readFile(item.path)
			.then(({ content, encoding }) => {
				if (cancelled) return;
				const mime = MIME_MAP[getExtension(item.name)] ?? "image/png";
				setSrc(encoding === "base64" ? `data:${mime};base64,${content}` : content);
			})
			.catch(() => {
				if (!cancelled) setError(true);
			});
		return () => {
			cancelled = true;
		};
	}, [item]);
	return { src, error };
}

export function useLightboxImageModel(item: FilePreviewItem, onClose: () => void): LightboxImageViewProps {
	const { src, error } = useImageSrc(item);
	return {
		src,
		error,
		alt: item.name,
		errorLabel: "无法加载此图片",
		onClose,
	};
}
