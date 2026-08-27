export const USER_MESSAGE_CLIPBOARD_VERSION = "1";
export const USER_MESSAGE_CLIPBOARD_ATTRIBUTE = "data-vetta-user-message";
export const USER_MESSAGE_CLIPBOARD_IMAGE_ATTRIBUTE = "data-vetta-clipboard-image";

export interface UserMessageClipboardWriteRequest {
	text: string;
	/** Image data URLs in the same order as the message's image tokens. */
	images: string[];
}

export interface UserMessageClipboardReadResult {
	text: string;
	html: string;
}

export function isVettaUserMessageClipboardHtml(html: string): boolean {
	return html.includes(`${USER_MESSAGE_CLIPBOARD_ATTRIBUTE}="${USER_MESSAGE_CLIPBOARD_VERSION}"`);
}
