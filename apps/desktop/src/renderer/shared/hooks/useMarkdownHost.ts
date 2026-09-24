import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { resolveLocalFilePath } from "@shared/lib/resolve-local-file-path";
import { filePreviewAtom } from "@shared/store/atoms";
import type { MarkdownHost } from "@vetta-org/theme-ui/markdown";
import { useSetAtom } from "jotai";
import { useMemo } from "react";
import { imageAsPng, imageDataForAction, imageFileName, resolveMarkdownImage } from "../lib/markdown-images";

export function useMarkdownHost(baseDirectory: string | null): MarkdownHost {
	const open = useSetAtom(filePreviewAtom);
	return useMemo(
		() => ({
			async openHtml(source) {
				await waitForCommittedPaint();
				const id = await window.vetta.markdown.openHtml(source);
				return () => {
					void window.vetta.markdown.closeHtml(id).catch(() => {});
				};
			},
			renderMermaid: async (source, theme) => window.vetta.markdown.renderMermaid(source, theme),
			favicon: async (origin) => window.vetta.markdown.favicon(origin),
			async resolveImage(source) {
				return resolveMarkdownImage(source, baseDirectory, async (path) => {
					const resolved = resolveLocalFilePath(path, baseDirectory);
					if (!baseDirectory) throw new Error("Image has no document directory");
					return window.vetta.fs.readFile(resolved);
				});
			},
			async copyImage(source) {
				await window.vetta.clipboard.writeImage(await imageAsPng(await imageDataForAction(source)));
			},
			async saveImage(source) {
				const data = await imageDataForAction(source);
				const comma = data.indexOf(",");
				const base64 = data.slice(0, comma).includes(";base64");
				await window.vetta.dialog.saveData(
					imageFileName(data),
					base64 ? data.slice(comma + 1) : decodeURIComponent(data.slice(comma + 1)),
					base64 ? "base64" : "utf8",
				);
			},
			openImage: (url, name) =>
				open({ name: `${name || "image"}.${imageFileName(url).split(".").pop()}`, url, kind: "image" }),
		}),
		[baseDirectory, open],
	);
}
