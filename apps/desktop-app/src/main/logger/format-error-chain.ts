// 错误链格式化：文本版用于人读日志，结构化版用于 ring buffer / 诊断包导出。
// 两者各自遍历 error.cause 链并附带 code/errno/address/port —— 这是诊断 fetch
// 失败（ECONNREFUSED / EHOSTUNREACH / undici "fetch failed"）的关键信息。

export interface ErrorChainNode {
	name: string;
	message: string;
	stack?: string;
	code?: string;
	errno?: number | string;
	address?: string;
	port?: number;
	cause?: ErrorChainNode;
}

type ErrnoLike = Error & { code?: string; errno?: number | string; address?: string; port?: number };

// 文本版：输出必须与重构前逐字节一致，现有人读日志格式依赖它。
export function formatErrorChain(err: Error): string {
	const parts: string[] = [err.stack ?? `${err.name}: ${err.message}`];
	const seen = new Set<unknown>([err]);
	let cur: unknown = (err as { cause?: unknown }).cause;
	while (cur && !seen.has(cur)) {
		seen.add(cur);
		if (cur instanceof Error) {
			const meta: string[] = [];
			const anyCur = cur as ErrnoLike;
			if (anyCur.code) meta.push(`code=${anyCur.code}`);
			if (anyCur.errno !== undefined) meta.push(`errno=${anyCur.errno}`);
			if (anyCur.address) meta.push(`address=${anyCur.address}`);
			if (anyCur.port !== undefined) meta.push(`port=${anyCur.port}`);
			parts.push(
				`  Caused by: ${cur.stack ?? `${cur.name}: ${cur.message}`}${meta.length ? `  [${meta.join(", ")}]` : ""}`,
			);
		} else {
			parts.push(`  Caused by: ${String(cur)}`);
		}
		cur = (cur as { cause?: unknown }).cause;
	}
	return parts.join("\n");
}

// 结构化版：同一棵 cause 链输出嵌套对象，供 NDJSON 序列化。
export function formatErrorChainJSON(err: Error): ErrorChainNode {
	const seen = new Set<unknown>();
	const walk = (e: Error): ErrorChainNode => {
		seen.add(e);
		const anyE = e as ErrnoLike;
		const node: ErrorChainNode = { name: e.name, message: e.message };
		if (e.stack) node.stack = e.stack;
		if (anyE.code) node.code = anyE.code;
		if (anyE.errno !== undefined) node.errno = anyE.errno;
		if (anyE.address) node.address = anyE.address;
		if (anyE.port !== undefined) node.port = anyE.port;
		const cause = (e as { cause?: unknown }).cause;
		if (cause instanceof Error && !seen.has(cause)) {
			node.cause = walk(cause);
		}
		return node;
	};
	return walk(err);
}
