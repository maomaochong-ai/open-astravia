import { pluginFilePreviewsAtom } from "@shared/store/atoms";
import type { FilePreviewItem, PreviewBodyViewProps } from "@vetta/theme-ui/file-preview";
import { getExtension } from "@vetta/theme-ui/file-preview";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PluginI18nBoundary } from "../../plugins/runtime/plugin-i18n";
import { PluginFilePreview } from "../components/PluginFilePreview";
import { TextPreviewRenderer } from "../components/TextPreviewRenderer";
import { downloadItem, isPreviewSupported, isTextExtension } from "../preview-utils";

type LoadState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "unsupported" }
	| { status: "loaded"; content: string; extension: string };

export function usePreviewBodyModel(
	item: FilePreviewItem,
	refreshNonce = 0,
): PreviewBodyViewProps {
	const ext = useMemo(() => getExtension(item.name), [item.name]);
	const supported = isPreviewSupported(item.name);
	const canLoad = supported || Boolean(item.path);
	const { t } = useTranslation("chat");
	const pluginPreviews = useAtomValue(pluginFilePreviewsAtom);
	const pluginPreview = useMemo(
		() => pluginPreviews.find((p) => p.extensions.includes(ext)),
		[pluginPreviews, ext],
	);

	const [state, setState] = useState<LoadState>({ status: "loading" });
	const [watchTick, setWatchTick] = useState(0);
	const itemPath = item.path;
	const itemUrl = item.url;
	const itemKey = itemPath ?? itemUrl ?? item.name;
	const prevKeyRef = useRef<string | null>(null);

	useEffect(() => {
		if (pluginPreview || !canLoad) return;
		let cancelled = false;
		const isNewItem = prevKeyRef.current !== itemKey;
		prevKeyRef.current = itemKey;
		if (isNewItem) setState({ status: "loading" });

		void loadItem(itemPath, itemUrl, ext, supported)
			.then((result) => {
				if (!cancelled) setState(result);
			})
			.catch((err: Error) => {
				if (!cancelled) {
					const message = err.message?.includes("too large")
						? t("fileEditor.errorPreviewTooLarge")
						: t("fileEditor.errorRead");
					setState({ status: "error", message });
				}
			});

		return () => {
			cancelled = true;
		};
	}, [itemPath, itemUrl, ext, supported, canLoad, pluginPreview, itemKey, watchTick, refreshNonce, t]);

	useEffect(() => {
		const path = itemPath;
		if (!path || pluginPreview || !canLoad) return;
		const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
		const dir = slash > 0 ? path.slice(0, slash) : path;
		void window.vetta.fs.watchDir(dir);
		const unsub = window.vetta.fs.onDirChanged((changed) => {
			if (changed === dir) setWatchTick((t) => t + 1);
		});
		return () => {
			unsub();
			void window.vetta.fs.unwatchDir(dir);
		};
	}, [itemPath, canLoad, pluginPreview]);

	const labels = {
		unsupported: t("fileEditor.unsupported"),
		download: t("fileEditor.download"),
	};

	if (pluginPreview) {
		return {
			state: {
				status: "plugin",
				content: (
					<PluginI18nBoundary pluginId={pluginPreview.pluginId}>
						<PluginFilePreview
							key={`${itemKey}-${refreshNonce}`}
							item={item}
							ext={ext}
							component={pluginPreview.component}
						/>
					</PluginI18nBoundary>
				),
			},
			labels,
			onDownload: (it) => void downloadItem(it),
		};
	}

	if (!canLoad || state.status === "unsupported") {
		return {
			state: { status: "unsupported", item },
			labels,
			onDownload: (it) => void downloadItem(it),
		};
	}

	if (state.status === "loading") {
		return { state: { status: "loading" }, labels, onDownload: (it) => void downloadItem(it) };
	}

	if (state.status === "error") {
		return {
			state: { status: "error", message: state.message },
			labels,
			onDownload: (it) => void downloadItem(it),
		};
	}

	const content = <TextPreviewRenderer content={state.content} extension={state.extension} />;

	return {
		state: { status: "content", content },
		labels,
		onDownload: (it) => void downloadItem(it),
	};
}

async function loadItem(
	path: string | undefined,
	url: string | undefined,
	ext: string,
	declaredTextFormat: boolean,
): Promise<Extract<LoadState, { status: "loaded" | "unsupported" }>> {
	if (path) {
		if (declaredTextFormat) {
			const result = await window.vetta.fs.readFile(path);
			return { status: "loaded", content: result.content, extension: ext };
		}
		const result = await window.vetta.fs.readTextPreviewFile(path);
		return result.status === "text"
			? { status: "loaded", content: result.content, extension: "" }
			: { status: "unsupported" };
	}
	if (!url) {
		throw new Error("FILE_PREVIEW_NO_SOURCE");
	}
	if (!declaredTextFormat) return { status: "unsupported" };
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);

	if (isTextExtension(ext)) {
		const text = await res.text();
		return { status: "loaded", content: text, extension: ext };
	}
	const buf = await res.arrayBuffer();
	return { status: "loaded", content: arrayBufferToBase64(buf), extension: ext };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}
