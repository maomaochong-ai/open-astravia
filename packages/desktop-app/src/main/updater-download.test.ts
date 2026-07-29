import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContentVerifyError, downloadWithResume } from "./updater-download.js";

const PAYLOAD = Buffer.from(
	Array.from({ length: 4096 }, (_, i) => String.fromCharCode(97 + (i % 26))).join(""),
	"utf8",
);
const PAYLOAD_SHA256 = createHash("sha256").update(PAYLOAD).digest("hex");

interface TestServer {
	url: string;
	close: () => Promise<void>;
	/** 收到的 Range 请求头，按请求顺序 */
	rangeHeaders: (string | undefined)[];
}

/** @param honorRange false 时无视 Range 直接回 200 整包，模拟不支持续传的服务端 */
async function startServer(options?: { honorRange?: boolean; body?: Buffer }): Promise<TestServer> {
	const honorRange = options?.honorRange !== false;
	const body = options?.body ?? PAYLOAD;
	const rangeHeaders: (string | undefined)[] = [];

	const server: Server = createServer((req, res) => {
		const range = req.headers.range;
		rangeHeaders.push(typeof range === "string" ? range : undefined);
		if (honorRange && typeof range === "string") {
			const start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
			const slice = body.subarray(start);
			res.writeHead(206, {
				"Content-Length": String(slice.byteLength),
				"Content-Range": `bytes ${start}-${body.byteLength - 1}/${body.byteLength}`,
			});
			res.end(slice);
			return;
		}
		res.writeHead(200, { "Content-Length": String(body.byteLength) });
		res.end(body);
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("failed to bind test server");

	return {
		url: `http://127.0.0.1:${address.port}/asset.zip`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
		rangeHeaders,
	};
}

describe("downloadWithResume", () => {
	let dir: string;
	let destPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "vetta-updater-download-"));
		destPath = join(dir, "asset.zip");
	});

	afterEach(() => {
		rmSync(dir, { force: true, recursive: true });
	});

	it("下载完整文件并在校验通过后 rename 到 destPath", async () => {
		const server = await startServer();
		try {
			await downloadWithResume({
				url: server.url,
				headers: {},
				destPath,
				expectedSize: PAYLOAD.byteLength,
				expectedSha256: PAYLOAD_SHA256,
			});
		} finally {
			await server.close();
		}

		expect(readFileSync(destPath).equals(PAYLOAD)).toBe(true);
		// 残片不应残留
		expect(existsSync(`${destPath}.part`)).toBe(false);
		// 无残片时不该发 Range
		expect(server.rangeHeaders).toEqual([undefined]);
	});

	it("从残片续传，且整包摘要仍然正确", async () => {
		const resumeFrom = 1000;
		writeFileSync(`${destPath}.part`, PAYLOAD.subarray(0, resumeFrom));

		const server = await startServer();
		try {
			await downloadWithResume({
				url: server.url,
				headers: {},
				destPath,
				expectedSize: PAYLOAD.byteLength,
				expectedSha256: PAYLOAD_SHA256,
			});
		} finally {
			await server.close();
		}

		expect(server.rangeHeaders).toEqual([`bytes=${resumeFrom}-`]);
		expect(readFileSync(destPath).equals(PAYLOAD)).toBe(true);
	});

	it("续传时进度从已有字节起算，总量是整包大小", async () => {
		const resumeFrom = 4000;
		writeFileSync(`${destPath}.part`, PAYLOAD.subarray(0, resumeFrom));

		const seen: { received: number; total: number }[] = [];
		const server = await startServer();
		try {
			await downloadWithResume({
				url: server.url,
				headers: {},
				destPath,
				expectedSize: PAYLOAD.byteLength,
				expectedSha256: PAYLOAD_SHA256,
				onProgress: (received, total) => seen.push({ received, total }),
			});
		} finally {
			await server.close();
		}

		expect(seen.length).toBeGreaterThan(0);
		expect(seen[0].received).toBeGreaterThan(resumeFrom);
		expect(seen.at(-1)).toEqual({ received: PAYLOAD.byteLength, total: PAYLOAD.byteLength });
	});

	it("服务端忽略 Range 回 200 时丢弃残片重下", async () => {
		writeFileSync(`${destPath}.part`, Buffer.from("坏残片"));

		const server = await startServer({ honorRange: false });
		try {
			await downloadWithResume({
				url: server.url,
				headers: {},
				destPath,
				expectedSize: PAYLOAD.byteLength,
				expectedSha256: PAYLOAD_SHA256,
			});
		} finally {
			await server.close();
		}

		expect(readFileSync(destPath).equals(PAYLOAD)).toBe(true);
	});

	it("摘要不匹配时抛 ContentVerifyError 并删掉残片，避免续传带着坏字节", async () => {
		const server = await startServer();
		try {
			await expect(
				downloadWithResume({
					url: server.url,
					headers: {},
					destPath,
					expectedSize: PAYLOAD.byteLength,
					expectedSha256: "a".repeat(64),
				}),
			).rejects.toThrow(ContentVerifyError);
		} finally {
			await server.close();
		}

		expect(existsSync(`${destPath}.part`)).toBe(false);
		expect(existsSync(destPath)).toBe(false);
	});

	it("体积不匹配时同样删残片并报错", async () => {
		const server = await startServer();
		try {
			await expect(
				downloadWithResume({
					url: server.url,
					headers: {},
					destPath,
					expectedSize: PAYLOAD.byteLength + 1,
				}),
			).rejects.toThrow(ContentVerifyError);
		} finally {
			await server.close();
		}

		expect(existsSync(`${destPath}.part`)).toBe(false);
	});

	it("残片不小于整包时视为不可信，重新下载", async () => {
		writeFileSync(`${destPath}.part`, Buffer.alloc(PAYLOAD.byteLength + 10, 0x41));

		const server = await startServer();
		try {
			await downloadWithResume({
				url: server.url,
				headers: {},
				destPath,
				expectedSize: PAYLOAD.byteLength,
				expectedSha256: PAYLOAD_SHA256,
			});
		} finally {
			await server.close();
		}

		expect(server.rangeHeaders).toEqual([undefined]);
		expect(readFileSync(destPath).equals(PAYLOAD)).toBe(true);
	});

	it("中断后保留残片，下一次能接着续传出完整文件", async () => {
		// 4MB：确保 body 分多个 chunk 到达，首个 chunk 后中断是确定行为
		const big = Buffer.alloc(4 * 1024 * 1024);
		for (let i = 0; i < big.byteLength; i++) big[i] = i % 251;
		const bigSha256 = createHash("sha256").update(big).digest("hex");

		const controller = new AbortController();
		const server = await startServer({ body: big });
		try {
			await expect(
				downloadWithResume({
					url: server.url,
					headers: {},
					destPath,
					expectedSize: big.byteLength,
					expectedSha256: bigSha256,
					onProgress: () => controller.abort(),
					signal: controller.signal,
				}),
			).rejects.toThrow();

			// 中断态：成品不存在，残片留着且未下完
			expect(existsSync(destPath)).toBe(false);
			const partSize = readFileSync(`${destPath}.part`).byteLength;
			expect(partSize).toBeGreaterThan(0);
			expect(partSize).toBeLessThan(big.byteLength);

			// 续传补齐
			await downloadWithResume({
				url: server.url,
				headers: {},
				destPath,
				expectedSize: big.byteLength,
				expectedSha256: bigSha256,
			});
			expect(server.rangeHeaders.at(-1)).toBe(`bytes=${partSize}-`);
		} finally {
			await server.close();
		}

		expect(readFileSync(destPath).equals(big)).toBe(true);
		expect(existsSync(`${destPath}.part`)).toBe(false);
	});
});
