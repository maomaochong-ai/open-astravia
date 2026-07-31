import type { PluginFsApi } from "@vetta-org/plugin-sdk";

export const TAB_ID = "preview";

export function isHtmlFile(name: string): boolean {
	return /\.html?$/i.test(name);
}

/** cwd（含子孙目录）里有没有 html/htm——决定「移动预览」要不要在标签栏出现。 */
export async function hasHtmlFile(fs: PluginFsApi, cwd: string): Promise<boolean> {
	try {
		const files = await fs.listFilesRecursive(cwd);
		return files.some((file) => isHtmlFile(file.name));
	} catch {
		return false;
	}
}
