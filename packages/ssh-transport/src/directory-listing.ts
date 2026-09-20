export interface RemoteDirectoryEntry {
	readonly name: string;
	readonly kind: "file" | "directory" | "symlink" | "other";
	readonly sizeBytes: number;
	/** Unix 秒。远端时钟可能与本机不同步，只用于展示和排序，不用于判断新旧。 */
	readonly modifiedAtSeconds: number;
}

/**
 * 解析 {@link buildListDirectoryCommand} 的输出。
 *
 * 容忍而不是拒绝畸形行：一个文件名里带换行就会切出一行解析不出的碎片，若整个列表
 * 因此报错，用户看到的是「这个目录打不开」而不是「少了一个文件」。丢掉碎片、保住
 * 其余条目是这里刻意的取舍。
 */
export function parseRemoteDirectoryListing(output: string): RemoteDirectoryEntry[] {
	const entries: RemoteDirectoryEntry[] = [];
	for (const line of output.split("\n")) {
		if (line.length === 0) continue;
		// 文件名允许含制表符，所以只从左边切三刀，剩下的整段都是名字。
		const first = line.indexOf("\t");
		const second = line.indexOf("\t", first + 1);
		const third = line.indexOf("\t", second + 1);
		if (first < 0 || second < 0 || third < 0) continue;
		const rawName = line.slice(third + 1);
		const name = stripLeadingDotSlash(rawName);
		if (name.length === 0 || name === "." || name === "..") continue;
		const sizeBytes = Number.parseInt(line.slice(first + 1, second), 10);
		const modifiedAtSeconds = Number.parseInt(line.slice(second + 1, third), 10);
		entries.push({
			name,
			kind: classifyStatType(line.slice(0, first)),
			sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
			modifiedAtSeconds: Number.isFinite(modifiedAtSeconds) ? modifiedAtSeconds : 0,
		});
	}
	return entries;
}

/** `find .` 输出的是 `./name`；BSD 的 `%N` 原样回显传入路径，同样带前缀。 */
function stripLeadingDotSlash(value: string): string {
	return value.startsWith("./") ? value.slice(2) : value;
}

/**
 * GNU `%F` 给 `regular file` / `directory` / `symbolic link`，
 * BSD `%HT` 给 `Regular File` / `Directory` / `Symbolic Link`。
 * 统一转小写后按子串判定，避免为两套字面量各写一份映射表。
 *
 * 命令侧已用 `LC_ALL=C` 锁死英文（见 buildListDirectoryCommand）。这里仍兜住几种
 * 常见本地化写法：中文系统上 `%F` 给的是「目录」，一旦漏掉 locale 设置，整个目录
 * 会被判成未知类型然后在界面上显示为空——那是个很难从现象反推到原因的故障。
 */
function classifyStatType(raw: string): RemoteDirectoryEntry["kind"] {
	const value = raw.toLowerCase();
	if (value.includes("directory") || value.includes("目录") || value.includes("ディレクトリ")) return "directory";
	if (value.includes("link") || value.includes("符号链接") || value.includes("链接")) return "symlink";
	if (value.includes("regular") || value.includes("普通文件") || value.includes("文件")) return "file";
	return "other";
}
