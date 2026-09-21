/**
 * 从 `~/.ssh/config` 里挑出可以直接用作连接目标的别名。
 *
 * 这里**只**提取别名，不解析它背后的 HostName、Port、ProxyJump、IdentityFile。
 * 那些参数在连接时由 OpenSSH 自己解析，Vetta 缓存一份副本只会与用户后续的修改漂移，
 * 并且要连带实现 Include、Match 和 `%h`/`%p` 展开——那是一整个必然落后于 OpenSSH 的
 * 实现，正是选系统 ssh 要避开的东西。
 */
export function parseSshConfigAliases(content: string): string[] {
	const aliases: string[] = [];
	const seen = new Set<string>();
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		// `Host` 关键字大小写不敏感，且允许用 `=` 分隔。
		const match = /^host[\s=]+(.+)$/i.exec(line);
		if (!match) continue;
		for (const token of match[1].split(/\s+/)) {
			const alias = token.trim();
			if (alias.length === 0) continue;
			// 通配与取反条目是「给一组主机配默认值」，本身不是可连接的目标。
			if (/[*?!]/.test(alias)) continue;
			if (seen.has(alias)) continue;
			seen.add(alias);
			aliases.push(alias);
		}
	}
	return aliases;
}
