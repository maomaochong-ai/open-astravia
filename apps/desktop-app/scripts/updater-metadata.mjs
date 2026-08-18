import { posix } from "node:path";

export const updaterMetadataPattern = /^latest(?:-(?:mac|linux)(?:-[a-z0-9_-]+)?)?\.ya?ml$/i;
const artifactPattern = /\.(?:appimage|blockmap|dmg|exe|zip)$/i;

export function referencedFileName(reference) {
	if (typeof reference !== "string" || !reference.trim()) return undefined;
	let pathname = reference.trim().split(/[?#]/, 1)[0];
	try {
		pathname = new URL(reference).pathname;
	} catch {
		// electron-builder 的更新清单通常使用相对路径。
	}
	const fileName = posix.basename(decodeURIComponent(pathname.replaceAll("\\", "/")));
	return artifactPattern.test(fileName) ? fileName : undefined;
}
