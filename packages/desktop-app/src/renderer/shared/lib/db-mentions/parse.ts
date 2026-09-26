/**
 * 从用户输入文本中解析 `@db:connection.table` 或 `@db:connection.scope.table` 数据库表 mention。
 *
 * 与 `@skill:xxx` / `@mcp:xxx` 风格统一，使用命名空间前缀 `db:` 消除歧义：
 * - 用户手敲的 `@hello.world`（无 db: 前缀）会被 parse 为纯文本，不会误判为 db-table
 * - 只有带 `@db:` 前缀的才会被识别为数据库表引用
 *
 * 兼容旧格式 `@connection.table`（无前缀）做过渡，但 parseInputSegments 默认
 * 只识别 `@db:` 前缀——旧格式仅用于已存数据的反序列化。
 *
 * 3 段格式说明（PG/MySQL 等非 flat 类型）：
 * - `@db:conn.schema.table`：connection=conn, scope=schema, table=table
 * - `@db:conn.database.table`：connection=conn, scope=database, table=table
 */

export interface DbTableMention {
	/** 原始 mention 字符串（含 @），如 `@my-conn.users` */
	raw: string;
	/** 连接名（dbx 连接名，不是 UUID） */
	connection: string;
	/** 非 flat 类型的 catalog scope 名（PG schema / MySQL database） */
	scope?: string;
	/** 表名 */
	table: string;
}

/**
 * connection / scope / table 三元组——Astravia 里 db-table 引用的核心域模型。
 * 取代到处散落的 `{ connection, scope?, table }` 匿名对象（Primitive Obsession 去重）。
 */
export interface DbMentionTriple {
	/** 连接名（dbx 连接名） */
	connection: string;
	/** 非 flat 类型的 catalog scope 名（PG schema / MySQL database） */
	scope?: string;
	/** 表名 */
	table: string;
}

const SIMPLE_IDENTIFIER_RE = /^[\p{L}_][\p{L}\p{N}_$]*$/u;

function isMentionBoundary(char: string | undefined): boolean {
	return !char || /\s|[([{,;:]/.test(char);
}

function isUnquotedMentionChar(char: string): boolean {
	return /[\p{L}\p{N}_$.-]/u.test(char);
}

function readQuotedSegment(source: string, start: number): { value: string; end: number } | null {
	const quote = source[start];
	if (quote !== '"' && quote !== "`") return null;
	let value = "";
	for (let i = start + 1; i < source.length; i++) {
		const char = source[i];
		if (char === quote) {
			if (source[i + 1] === quote) {
				value += quote;
				i++;
				continue;
			}
			return { value, end: i + 1 };
		}
		value += char;
	}
	return null;
}

function readMentionToken(source: string, start: number): { raw: string; parts: string[]; end: number } | null {
	let i = start;
	const parts: string[] = [];
	let raw = "";

	while (i < source.length) {
		const quoted = readQuotedSegment(source, i);
		if (quoted) {
			parts.push(quoted.value);
			raw += source.slice(i, quoted.end);
			i = quoted.end;
		} else {
			let value = "";
			const valueStart = i;
			while (i < source.length && isUnquotedMentionChar(source[i]) && source[i] !== ".") {
				value += source[i];
				i++;
			}
			if (!value) break;
			parts.push(value);
			raw += source.slice(valueStart, i);
		}

		if (source[i] !== ".") break;
		raw += ".";
		i++;
	}

	const usableParts = parts.filter(Boolean);
	if (!usableParts.length) return null;
	return { raw, parts: usableParts, end: i };
}

/**
 * 从文本中提取数据库表 mention，去重。
 *
 * 优先识别 `@db:connection.table` / `@db:connection.scope.table`（新格式，带命名空间前缀），
 * 同时兼容旧格式 `@connection.table`（无前缀）——用于已存数据的反序列化。
 * 调用方可通过 `format: "new" | "legacy" | "both"` 控制识别范围。
 *
 * @param text 完整用户输入文本
 * @param validConnections 可选——如果提供，只返回 connection 在列表中的 mention
 *                         （用来过滤用户手敲的 `@something.else`）
 * @param format 可选——"new" 只识别 `@db:` 前缀（默认），"legacy" 只识别旧格式，"both" 都识别
 */
export function parseDbTableMentions(
	text: string,
	validConnections?: readonly string[],
	format: "new" | "legacy" | "both" = "new",
): DbTableMention[] {
	const mentions: DbTableMention[] = [];
	const seen = new Set<string>();

	for (let i = 0; i < text.length; i++) {
		if (text[i] !== "@" || !isMentionBoundary(text[i - 1])) continue;

		// 新格式：@db:conn.table 或 @db:conn.scope.table
		if (format !== "legacy" && text.slice(i + 1, i + 4) === "db:") {
			const token = readMentionToken(text, i + 4); // 跳过 @db:
			if (token && token.parts.length >= 2) {
				const raw = `@db:${token.raw}`;
				const triple = parseDbMentionTriple(token.parts);
				if (triple) {
					if (
						!validConnections ||
						validConnections.some((c) => c.toLowerCase() === triple.connection.toLowerCase())
					) {
						const key = dbTableMentionKey(triple.connection, triple.table, triple.scope);
						if (!seen.has(key)) {
							seen.add(key);
							mentions.push({ raw, ...triple });
						}
					}
				}
				i = token.end - 1;
				continue;
			}
		}

		// 旧格式：@connection.table（无前缀）——仅 format !== "new" 时识别
		if (format !== "new") {
			const token = readMentionToken(text, i + 1);
			if (!token || token.parts.length < 2) {
				i = (token?.end ?? i + 1) - 1;
				continue;
			}
			const triple = parseDbMentionTriple(token.parts);
			if (triple) {
				if (
					!validConnections ||
					validConnections.some((c) => c.toLowerCase() === triple.connection.toLowerCase())
				) {
					const key = dbTableMentionKey(triple.connection, triple.table, triple.scope);
					if (!seen.has(key)) {
						seen.add(key);
						mentions.push({ raw: `@${token.raw}`, ...triple });
					}
				}
			}
			i = token.end - 1;
		}
	}

	return mentions;
}

/**
 * 从点分片段解析 DbMentionTriple（connection/scope/table）。
 * - 2 段 → connection / table
 * - 3+ 段 → connection / scope / table（取最后 3 段，前面的部分归入 connection 会造成歧义，所以不支持 4+ 段）
 */
function parseDbMentionTriple(parts: string[]): DbMentionTriple | null {
	if (parts.length < 2) return null;
	const table = parts[parts.length - 1]!;
	if (parts.length >= 3) {
		return {
			connection: parts[0]!,
			scope: parts[parts.length - 2],
			table,
		};
	}
	return { connection: parts[0]!, table };
}

/**
 * 格式化 mention 显示（用于 Lexical token getTextContent / 序列化输出）。
 * 自动对含空格/特殊字符的段加引号保护，parseDbTableMentions 能 round-trip 回去。
 * 使用 `@db:` 命名空间前缀，与 `@skill:` / `@mcp:` 风格统一，消除歧义。
 */
export function formatDbTableMention(connection: string, table: string, scope?: string): string {
	const safeConn = SIMPLE_IDENTIFIER_RE.test(connection) ? connection : `"${connection.replace(/"/g, '""')}"`;
	const safeTable = SIMPLE_IDENTIFIER_RE.test(table) ? table : `"${table.replace(/"/g, '""')}"`;
	if (scope) {
		const safeScope = SIMPLE_IDENTIFIER_RE.test(scope) ? scope : `"${scope.replace(/"/g, '""')}"`;
		return `@db:${safeConn}.${safeScope}.${safeTable}`;
	}
	return `@db:${safeConn}.${safeTable}`;
}

/**
 * mention 去重 key（小写）。scope 参与 key——`conn.schema.table` 与 `conn.public.table` 是不同实体。
 * 不传 scope 时行为与旧版本（仅 conn.table key）兼容。
 */
export function dbTableMentionKey(connection: string, table: string, scope?: string): string {
	return scope ? `${connection}.${scope}.${table}`.toLowerCase() : `${connection}.${table}`.toLowerCase();
}
