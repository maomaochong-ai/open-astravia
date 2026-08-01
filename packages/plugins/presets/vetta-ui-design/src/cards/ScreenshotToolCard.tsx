import { useTranslation } from "@vetta-org/plugin-sdk";
import { getPluginCtx } from "../plugin-context";

interface ToolCallView {
	toolCallId: string;
	toolName: string;
	args?: unknown;
	status: string;
	result?: unknown;
	isError?: boolean;
}

function resultPath(result: unknown): string | null {
	if (typeof result === "string") {
		try {
			return resultPath(JSON.parse(result));
		} catch {
			return null;
		}
	}
	if (result && typeof result === "object" && typeof (result as { path?: unknown }).path === "string") {
		return (result as { path: string }).path;
	}
	return null;
}

/** Static file protocol URL (ADR-0027). */
function fileUrl(path: string): string {
	return `vetta-file://local${encodeURI(path)}`;
}

/** Inline rendering for vetd_screenshot tool calls: thumbnail instead of raw JSON. */
export function ScreenshotToolCard({ toolCall }: { toolCall: ToolCallView }) {
	const { t } = useTranslation();
	const path = resultPath(toolCall.result);
	if (!path || toolCall.isError) {
		return (
			<div className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
				{t("card.screenshot.title")}
				{toolCall.isError ? " ✕" : "…"}
			</div>
		);
	}
	const url = fileUrl(path);
	return (
		<button
			type="button"
			title={t("card.screenshot.open")}
			onClick={() => getPluginCtx().ui.previewImage({ id: path, url })}
			className="group relative block overflow-hidden rounded-lg border border-border"
		>
			<img src={url} alt={t("card.screenshot.title")} className="max-h-48 max-w-72 object-contain" />
			<span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-2 py-1 text-left text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
				{t("card.screenshot.open")}
			</span>
		</button>
	);
}
