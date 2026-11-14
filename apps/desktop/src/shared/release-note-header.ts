/**
 * 去掉发布说明开头的「# Astravia x.y.z」标题和 release-status 标记：
 * 更新对话框自己有标题与版本号，正文只保留 `## 新增` 起的内容。
 * 主进程（更新源给的说明、随包说明）与渲染进程（开发预览）共用。
 */
export function stripReleaseNoteHeader(markdown: string): string {
	return markdown
		.replace(/\r\n/g, "\n")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/^\s*# [^\n]*\n?/, "")
		.trim();
}
