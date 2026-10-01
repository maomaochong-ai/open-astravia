/** Map an absolute local path to the privileged astravia-file:// scheme (ADR-0027). */
export function toAstraviaFileUrl(path: string): string {
	const normalized = path.replaceAll("\\", "/");
	const prefix = normalized.startsWith("/") ? "" : "/";
	return `astravia-file://local${prefix}${encodeURI(normalized)}`;
}
