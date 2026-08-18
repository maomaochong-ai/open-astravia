import type { MouseEvent } from "react";

const EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function isExternalLink(href: string | undefined): href is string {
	if (!href) return false;
	try {
		return EXTERNAL_LINK_PROTOCOLS.has(new URL(href).protocol);
	} catch {
		return false;
	}
}

export function openExternalLink(event: MouseEvent<HTMLAnchorElement>, href: string | undefined): void {
	if (!isExternalLink(href)) return;

	event.preventDefault();
	void window.vetta.shell.openExternal(href);
}
