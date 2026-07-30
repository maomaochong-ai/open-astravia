/**
 * 附件路径判定。原本住在 domains/chat/services/chat-service.ts，
 * 因 input-tokens 需要而下沉到 shared（shared 不允许反向依赖 domains）；
 * chat-service 仍以原名重新导出，调用方无需改动。
 */

const USER_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"]);

/** 看起来像一个可作为附件的绝对路径（含 Windows 盘符与 UNC）。 */
export function isAttachmentPath(path: string): boolean {
	if (!path) return false;
	if (path.startsWith("/")) return true;
	if (/^[A-Za-z]:[\\/]/.test(path)) return true;
	// UNC paths (Windows network shares)
	if (path.startsWith("\\\\") || path.startsWith("//")) return true;
	return false;
}

function basename(path: string): string {
	const normalized = path.replace(/[\\/]+$/, "");
	const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
	return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/** 按扩展名判定是否图片；图片 token 渲染成缩略图而非文件徽标。 */
export function isImagePath(path: string): boolean {
	const name = basename(path);
	const dotIndex = name.lastIndexOf(".");
	const extension = dotIndex === -1 ? "" : name.slice(dotIndex + 1).toLowerCase();
	return USER_IMAGE_EXTENSIONS.has(extension);
}
