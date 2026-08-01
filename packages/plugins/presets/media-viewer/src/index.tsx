import { definePlugin, type PluginFilePreviewProps, useTranslation } from "@vetta-org/plugin-sdk";
import { AudioPreview } from "./AudioPreview";
import { MEDIA_EXTENSIONS, isAudioExtension, isImageExtension, isVideoExtension } from "./formats";
import { ImagePreview } from "./ImagePreview";
import { setRegisterShortcutScope } from "./plugin-ui";
import "./style.css";
import { VideoPreview } from "./VideoPreview";

function MediaPreview({ file }: PluginFilePreviewProps) {
	const { t } = useTranslation();
	if (isImageExtension(file.extension)) return <ImagePreview file={file} />;
	if (file.extension === "webm") {
		return file.mime.startsWith("video/") ? <VideoPreview file={file} /> : <AudioPreview file={file} />;
	}
	if (isVideoExtension(file.extension)) return <VideoPreview file={file} />;
	if (isAudioExtension(file.extension)) return <AudioPreview file={file} />;

	return (
		<div className="flex h-full min-h-0 flex-1 items-center justify-center p-8 text-[13px] text-[var(--muted-foreground)]">
			{t("preview.unsupported")}
		</div>
	);
}

export default definePlugin({
	activate(ctx) {
		setRegisterShortcutScope((contribution) => ctx.ui.registerShortcutScope(contribution));
		ctx.ui.registerFilePreview({
			extensions: MEDIA_EXTENSIONS,
			component: MediaPreview,
		});
	},
	deactivate() {
		setRegisterShortcutScope(null);
	},
});
