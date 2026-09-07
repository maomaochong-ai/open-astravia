import type { InstalledPlugin } from "@preload/api";
import type { Disposable } from "@vetta-org/plugin-sdk";

function stylesheetIdentity(href: string): string {
	try {
		const url = new URL(href);
		url.search = "";
		url.hash = "";
		return url.href;
	} catch {
		return href.split(/[?#]/u, 1)[0] ?? href;
	}
}

export function loadPluginStyles(plugin: InstalledPlugin): Disposable {
	const pluginLayer = `vetta-plugins.${CSS.escape(plugin.id)}`;
	const ownedStylesheets = new Set(plugin.styleUrls.map(stylesheetIdentity));
	const styles = plugin.styleUrls.map((href) => {
		const style = document.createElement("style");
		style.dataset.vettaPluginId = plugin.id;
		style.textContent = `@import ${JSON.stringify(href)} layer(${pluginLayer});`;
		document.head.append(style);
		return style;
	});
	return {
		dispose: () => {
			for (const style of styles) style.remove();
			for (const link of document.head.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')) {
				if (ownedStylesheets.has(stylesheetIdentity(link.href))) link.remove();
			}
		},
	};
}
