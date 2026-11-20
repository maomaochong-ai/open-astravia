import { normalizeReleaseNote } from "@astravia-org/theme-ui/overlays";

type OpenFilePreview = (preview: { readonly name: string; readonly url: string }) => void;

/**
 * 把发布说明当 markdown 文件交给文件预览打开，作为「查看更多」的落点。
 *
 * 设置页卡片与更新对话框共用这一条：两处都要能读完完整更新内容，各自复制一份
 * objectURL 的构造逻辑会出现「一处归一化、一处没有」的分叉（GitHub feed 的
 * releaseNote 是 HTML，不归一化就会把标签原样显示出来）。
 */
export function openReleaseNotePreview(
	openPreview: OpenFilePreview,
	releaseNote: string | undefined,
	version: string | undefined,
): void {
	if (!releaseNote) return;
	const blob = new Blob([normalizeReleaseNote(releaseNote)], { type: "text/markdown" });
	const url = URL.createObjectURL(blob);
	openPreview({ name: `${version ? `v${version}` : "update"}_changelog.md`, url });
}
