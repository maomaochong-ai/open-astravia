import type { PluginPreviewFile } from "@astravia-org/plugin-sdk";

export async function fetchFileBytes(file: PluginPreviewFile): Promise<ArrayBuffer> {
	const url = file.getUrl();
	if (!url) return file.readBytes();
	const response = await fetch(url);
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.arrayBuffer();
}
