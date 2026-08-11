import type { InstalledPlugin } from "@preload/api";
import type { Disposable } from "@vetta-org/plugin-sdk";

export function loadPluginStyles(plugin: InstalledPlugin): Disposable {
	const pluginLayer = `vetta-plugins.${CSS.escape(plugin.id)}`;
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
		},
	};
}
