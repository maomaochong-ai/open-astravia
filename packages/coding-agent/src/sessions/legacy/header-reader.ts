/**
 * 判断首行是不是旧格式会话头。
 *
 * `cwd` 缺失时仍然认作会话头：早期版本没有把 cwd 写进头部，若在这里要求它必须存在，
 * 这类文件会被当成「别人的文件」整条从列表里消失，用户看到的就是会话丢了。
 * 缺 cwd 的那条由调用方用所在项目目录补上。
 */
export function isLegacySessionHeader(firstLine: string | undefined): boolean {
	if (!firstLine) return false;
	try {
		const value: unknown = JSON.parse(stripByteOrderMark(firstLine));
		if (typeof value !== "object" || value === null) return false;
		if (Reflect.get(value, "type") !== "session") return false;
		const cwd = Reflect.get(value, "cwd");
		return cwd === undefined || cwd === null || typeof cwd === "string";
	} catch {
		return false;
	}
}

/** 带 BOM 的首行直接 `JSON.parse` 会失败，会让整条会话被判成非本格式。 */
function stripByteOrderMark(line: string): string {
	return line.replace(/^\uFEFF/u, "").trim();
}
