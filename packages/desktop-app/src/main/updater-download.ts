import { createHash, type Hash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, renameSync, rmSync, statSync } from "node:fs";

/**
 * 可续传的单文件下载。
 *
 * 安装包动辄 200MB+，弱网下一次性流式下载失败即前功尽弃。这里把字节先写到
 * `${destPath}.part`，中断后保留残片，下次带 `Range: bytes=<已有>-` 续传；
 * 只有校验通过才 rename 到 destPath，因此 destPath 存在 == 内容完整可安装。
 */
export interface ResumableDownload {
	url: string;
	headers: Record<string, string>;
	/** 最终落盘路径；下载期间写 `${destPath}.part` */
	destPath: string;
	/** 服务端声明的完整体积；0 表示未知 */
	expectedSize: number;
	/** 期望的 sha256；摘要机制之前发布的存量安装包为空，跳过校验 */
	expectedSha256?: string;
	signal?: AbortSignal;
	onProgress?: (received: number, total: number) => void;
}

/** 内容校验失败：残片已被删除，重试必须从头下载 */
export class ContentVerifyError extends Error {}

/** 从 `bytes 100-999/1000` 里取总长；拿不到返回 0 */
function parseContentRangeTotal(headerValue: string | null): number {
	if (!headerValue) return 0;
	const slash = headerValue.lastIndexOf("/");
	if (slash < 0) return 0;
	const total = Number(headerValue.slice(slash + 1));
	return Number.isFinite(total) ? total : 0;
}

/** 把已下载的残片喂进摘要，续传后才能算出整包 sha256 */
async function feedExistingBytes(path: string, hash: Hash): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const stream = createReadStream(path);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolve());
		stream.on("error", reject);
	});
}

/** 残片可用则返回其字节数，否则清掉残片返回 0 */
function resolveResumeOffset(partPath: string, expectedSize: number): number {
	if (!existsSync(partPath)) return 0;
	const existing = statSync(partPath).size;
	// 残片反而比整包大/等长：内容不可信，重下
	if (existing <= 0 || (expectedSize > 0 && existing >= expectedSize)) {
		rmSync(partPath, { force: true });
		return 0;
	}
	return existing;
}

export async function downloadWithResume(opts: ResumableDownload): Promise<void> {
	const partPath = `${opts.destPath}.part`;
	const resumeFrom = resolveResumeOffset(partPath, opts.expectedSize);

	const headers: Record<string, string> = { ...opts.headers };
	if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;

	const response = await fetch(opts.url, { headers, signal: opts.signal });
	if (!response.ok || !response.body) {
		throw new Error(`下载失败：HTTP ${response.status}`);
	}

	const hash = createHash("sha256");
	let received = 0;
	let append = false;

	if (resumeFrom > 0 && response.status === 206) {
		await feedExistingBytes(partPath, hash);
		received = resumeFrom;
		append = true;
	} else if (resumeFrom > 0) {
		// 服务端忽略了 Range（返回 200 整包）：残片无用，从头写
		rmSync(partPath, { force: true });
	}

	const contentLength = Number(response.headers.get("Content-Length") || 0);
	const total =
		opts.expectedSize ||
		parseContentRangeTotal(response.headers.get("Content-Range")) ||
		(append ? received + contentLength : contentLength);

	const writeStream = createWriteStream(partPath, append ? { flags: "a" } : {});
	const reader = response.body.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			received += value.byteLength;
			hash.update(value);
			await new Promise<void>((resolve, reject) => {
				writeStream.write(value, (err) => (err ? reject(err) : resolve()));
			});
			opts.onProgress?.(received, total);
		}
	} finally {
		await new Promise<void>((resolve) => writeStream.end(resolve));
	}

	// ─── 校验：不通过就删残片，避免续传把坏字节一直带下去 ───

	if (opts.expectedSha256) {
		const actual = hash.digest("hex");
		if (actual !== opts.expectedSha256.toLowerCase()) {
			rmSync(partPath, { force: true });
			throw new ContentVerifyError(
				`安装包校验失败：内容摘要与服务端不一致（期望 ${opts.expectedSha256}，实际 ${actual}）`,
			);
		}
	}

	if (opts.expectedSize > 0) {
		const actualSize = statSync(partPath).size;
		if (actualSize !== opts.expectedSize) {
			rmSync(partPath, { force: true });
			throw new ContentVerifyError(`下载文件大小不匹配（${actualSize} vs ${opts.expectedSize}）`);
		}
	}

	renameSync(partPath, opts.destPath);
}
