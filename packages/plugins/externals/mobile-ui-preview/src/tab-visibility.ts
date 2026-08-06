import type { PluginFileExplorerEntry } from "@vetta-org/plugin-sdk";

export const TAB_ID = "preview";

export function isHtmlFile(name: string): boolean {
	return /\.html?$/i.test(name);
}

/** 文件树当前选区里是否有 html/htm（决定「移动预览」要不要在标签栏出现）。 */
export function selectionHasHtmlFile(selection: readonly PluginFileExplorerEntry[]): boolean {
	return selection.some((entry) => !entry.isDirectory && isHtmlFile(entry.name));
}
