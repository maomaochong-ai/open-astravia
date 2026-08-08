/** Map an absolute local path to the privileged vetta-file:// scheme (ADR-0027). */
export function toVettaFileUrl(path: string): string {
	const normalized = path.replaceAll("\\", "/");
	const prefix = normalized.startsWith("/") ? "" : "/";
	return `vetta-file://local${prefix}${encodeURI(normalized)}`;
}
