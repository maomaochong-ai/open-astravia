import type { PluginNetworkApi, PluginSettingsApi } from "@vetta-org/plugin-sdk";
import type { GeneratedContent } from "./types";

export function readStringSetting(settings: PluginSettingsApi, key: string): string {
	const value = settings.get<unknown>(key);
	return typeof value === "string" ? value.trim() : "";
}

export function requireStringSetting(settings: PluginSettingsApi, key: string, providerId: string): string {
	const value = readStringSetting(settings, key);
	if (!value) throw new Error(`content provider credential is not configured: ${providerId}`);
	return value;
}

export async function downloadGeneratedContent(
	network: PluginNetworkApi,
	url: string,
	content: Omit<GeneratedContent, "data" | "mimeType"> & { mimeType?: string },
	headers?: Record<string, string>,
): Promise<GeneratedContent> {
	const response = await network.request<string>({ url, headers, responseType: "base64", timeoutMs: 330_000 });
	if (!response.ok) throw new Error(`content provider media download returned HTTP ${response.status}`);
	return {
		...content,
		data: response.body,
		mimeType: response.headers["content-type"]?.split(";")[0] || content.mimeType || defaultMimeType(content.kind),
	};
}

export function dimensionsFor(aspectRatio: string | undefined, resolution = "1024p"): { width: number; height: number } {
	const shortSide = resolution === "4k" ? 2160 : resolution === "1080p" ? 1080 : resolution === "720p" ? 720 : 1024;
	const [widthPart, heightPart] = (aspectRatio ?? "1:1").split(":").map(Number);
	if (!widthPart || !heightPart) return { width: shortSide, height: shortSide };
	if (widthPart >= heightPart) return { width: Math.round((shortSide * widthPart) / heightPart), height: shortSide };
	return { width: shortSide, height: Math.round((shortSide * heightPart) / widthPart) };
}

export function nearestValue(value: number | undefined, values: readonly number[], fallback: number): number {
	if (value === undefined || values.length === 0) return fallback;
	return values.reduce((nearest, candidate) =>
		Math.abs(candidate - value) < Math.abs(nearest - value) ? candidate : nearest,
	);
}

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultMimeType(kind: GeneratedContent["kind"]): string {
	return kind === "video" ? "video/mp4" : "image/png";
}
