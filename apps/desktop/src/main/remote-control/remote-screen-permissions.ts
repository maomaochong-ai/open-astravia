import { systemPreferences } from "electron";
import type { ScreenSharePermissions } from "./remote-screen-share.js";

/**
 * What macOS lets this app do for a phone looking at the screen. Only checked,
 * never requested: the person is usually away from the desktop when a phone
 * asks, so a system prompt would sit unanswered (ADR-0140).
 */
export const desktopScreenPermissions: ScreenSharePermissions = {
	screenAllowed: () => process.platform !== "darwin" || systemPreferences.getMediaAccessStatus("screen") === "granted",
	inputAllowed: () => process.platform !== "darwin" || systemPreferences.isTrustedAccessibilityClient(false),
};
