import type { RemoteCapabilities } from "@astravia/remote-control";

/**
 * What this desktop tells every phone in its handshake, on the LAN and through
 * the relay alike. A phone only sends `file.*` requests when `fileRead` is set,
 * because older desktops drop the link on a method they do not know;
 * likewise `screen.subscribe` only when `screen` is set, and
 * `tool.result` only when `toolResult` is set, and `action.run` only when `actions` is set.
 */
export const DESKTOP_REMOTE_CAPABILITIES: RemoteCapabilities = {
	chat: true,
	sessionRead: true,
	fileRead: true,
	screen: true,
	toolResult: true,
	actions: true,
};
