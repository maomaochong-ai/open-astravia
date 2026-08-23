import type { CardDescriptor } from "@astravia-org/plugin-sdk";

/** Card type this plugin renders; the tool's descriptor and the renderer agree on it. */
export const SCREENSHOT_CARD_TYPE = "astravia-ui-design:screenshot";

export const SCREENSHOT_TOOL_NAME = "astd_screenshot";

/** Payload carries STABLE REFERENCES only — the renderer scans `.snapshots` for the versions. */
export interface ScreenshotCardPayload {
	dirPath: string;
	frameId: string;
}

/**
 * One logical card per frame: same key across turns = one card, shown only under
 * its latest anchor (host dedup). The tab label is the frame id — a code
 * identifier, so it needs no translation and stays distinguishable across frames.
 */
export function screenshotCardDescriptor(astdPath: string, dirPath: string, frameId: string): CardDescriptor {
	return {
		type: SCREENSHOT_CARD_TYPE,
		key: `${astdPath}#${frameId}`,
		title: frameId,
		payload: { dirPath, frameId } satisfies ScreenshotCardPayload,
	};
}
