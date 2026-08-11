import { type PluginPreviewFile, useTranslation } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { versionedUrl } from "./utils";

export function VideoPreview({ file }: { file: PluginPreviewFile }): JSX.Element {
	const { t } = useTranslation();
	const [version, setVersion] = useState(0);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		setVersion(0);
		setFailed(false);
		const watcher = file.watch(() => {
			setFailed(false);
			setVersion((value) => value + 1);
		});
		return () => watcher.dispose();
	}, [file]);

	const src = versionedUrl(file.getUrl({ mediaKind: "video" }), version);

	if (failed || !src) {
		return (
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-[var(--muted-foreground)]">
				<div className="text-[40px]">□</div>
				<span className="text-[13px]">{t("video.error")}</span>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 items-center justify-center bg-black">
			<video
				src={src}
				controls
				preload="metadata"
				className="h-full w-full object-contain"
				onError={() => setFailed(true)}
			/>
		</div>
	);
}
