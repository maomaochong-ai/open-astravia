import { shell } from "electron";

const EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export async function openExternalUrl(rawUrl: string): Promise<void> {
	const parsed = new URL(rawUrl);
	if (!EXTERNAL_LINK_PROTOCOLS.has(parsed.protocol)) {
		throw new Error(`Unsupported external URL protocol: ${parsed.protocol}`);
	}
	await shell.openExternal(parsed.toString());
}
