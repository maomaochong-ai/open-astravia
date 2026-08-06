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
	| { status: "loaded"; content: string; encoding: "utf8" | "base64" };

export function usePreviewBodyModel(
	item: FilePreviewItem,
	refreshNonce = 0,
): PreviewBodyViewProps {
	const ext = useMemo(() => getExtension(item.name), [item.name]);
	const supported = isPreviewSupported(item.name);
	const { t } = useTranslation("chat");
	const pluginPreviews = useAtomValue(pluginFilePreviewsAtom);
	const pluginPreview = useMemo(
		() => pluginPreviews.find((p) => p.extensions.includes(ext)),
		[pluginPreviews, ext],
	);

	const [state, setState] = useState<LoadState>({ status: "loading" });
	const [watchTick, setWatchTick] = useState(0);
	const itemKey = item.path ?? item.url ?? item.name;
	const prevKeyRef = useRef<string | null>(null);

	useEffect(() => {
		if (pluginPreview || !supported) return;
		let cancelled = false;
		const isNewItem = prevKeyRef.current !== itemKey;
		prevKeyRef.current = itemKey;
		if (isNewItem) setState({ status: "loading" });

		void loadItem(item, ext)
			.then((result) => {
				if (!cancelled) setState({ status: "loaded", ...result });
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
	}, [item, ext, supported, pluginPreview, itemKey, watchTick, refreshNonce, t]);

	useEffect(() => {
		const path = item.path;
		if (!path || pluginPreview || !supported) return;
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
	}, [item.path, supported, pluginPreview]);

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

	if (!supported) {
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

	const content = <TextPreviewRenderer content={state.content} extension={ext} />;

	return {
		state: { status: "content", content },
		labels,
		onDownload: (it) => void downloadItem(it),
	};
}

async function loadItem(
	item: FilePreviewItem,
	ext: string,
): Promise<{ content: string; encoding: "utf8" | "base64" }> {
	if (item.path) {
		return await window.vetta.fs.readFile(item.path);
	}
	if (!item.url) {
		throw new Error("FILE_PREVIEW_NO_SOURCE");
	}
	const res = await fetch(item.url);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);

	if (isTextExtension(ext)) {
		const text = await res.text();
		return { content: text, encoding: "utf8" };
	}
	const buf = await res.arrayBuffer();
	return { content: arrayBufferToBase64(buf), encoding: "base64" };
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
