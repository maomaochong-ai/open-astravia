import { writeFileSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 180_000;

/** 把 URL 下载到本地文件；非 2xx 或超时抛错，由调用方决定是否换下一个源。 */
export async function downloadToFile(url: string, dest: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
	} finally {
		clearTimeout(timer);
	}
}
