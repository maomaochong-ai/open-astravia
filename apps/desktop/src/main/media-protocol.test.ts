import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoopbackSshConnection, formatLoopbackProjectUri } from "@vetta/ssh-transport/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ protocol: { handle: () => undefined } }));
const connection = createLoopbackSshConnection();
vi.mock("./ssh/ssh-runtime.js", () => ({ getSshConnection: () => connection }));

const { handleMediaRequest, MEDIA_PROTOCOL_SCHEME } = await import("./media-protocol.js");
const { allowProjectRoot } = await import("./filesystem/filesystem-service.js");

function mediaUrl(path: string): string {
	return `${MEDIA_PROTOCOL_SCHEME}://local/stream?path=${encodeURIComponent(path)}`;
}

/** 内容长度跨过一个远端分块，才能证明分块拼接没有错位。 */
function createMedia(directory: string, name: string): Buffer {
	const bytes = Buffer.alloc(1024 * 1024 + 4096);
	for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
	writeFileSync(join(directory, name), bytes);
	return bytes;
}

describe("媒体协议", () => {
	it("本地项目：整份与 Range 请求都按字节返回", async () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "vetta-media-local-")));
		const bytes = createMedia(root, "clip.mp4");
		allowProjectRoot(root);

		const full = await handleMediaRequest(new Request(mediaUrl(join(root, "clip.mp4"))));
		expect(full.status).toBe(200);
		expect(full.headers.get("Content-Type")).toBe("video/mp4");
		expect(Buffer.from(await full.arrayBuffer()).equals(bytes)).toBe(true);

		const ranged = await handleMediaRequest(
			new Request(mediaUrl(join(root, "clip.mp4")), { headers: { Range: "bytes=10-19" } }),
		);
		expect(ranged.status).toBe(206);
		expect(ranged.headers.get("Content-Range")).toBe(`bytes 10-19/${bytes.length}`);
		expect([...Buffer.from(await ranged.arrayBuffer())]).toEqual([...bytes.subarray(10, 20)]);
	});

	it("远程项目：图片与视频从远端按范围取回，内容与远端文件逐字节一致", async () => {
		const remoteRoot = realpathSync(mkdtempSync(join(tmpdir(), "vetta-media-remote-")));
		const bytes = createMedia(remoteRoot, "clip.mp4");
		const root = formatLoopbackProjectUri("build-01", remoteRoot);
		allowProjectRoot(root);

		const full = await handleMediaRequest(new Request(mediaUrl(`${root}/clip.mp4`)));
		expect(full.status).toBe(200);
		expect(full.headers.get("Content-Length")).toBe(String(bytes.length));
		expect(Buffer.from(await full.arrayBuffer()).equals(bytes)).toBe(true);

		// 跨过 1 MiB 分块边界的一段。
		const start = 1024 * 1024 - 5;
		const ranged = await handleMediaRequest(
			new Request(mediaUrl(`${root}/clip.mp4`), { headers: { Range: `bytes=${start}-${start + 9}` } }),
		);
		expect(ranged.status).toBe(206);
		expect([...Buffer.from(await ranged.arrayBuffer())]).toEqual([...bytes.subarray(start, start + 10)]);
	});

	it("远程项目之外的远端路径被拒绝，不存在的文件是 404", async () => {
		const remoteRoot = realpathSync(mkdtempSync(join(tmpdir(), "vetta-media-remote-")));
		const root = formatLoopbackProjectUri("build-01", remoteRoot);
		allowProjectRoot(root);

		expect((await handleMediaRequest(new Request(mediaUrl("ssh://build-01/etc/passwd")))).status).toBe(403);
		expect((await handleMediaRequest(new Request(mediaUrl(`${root}/missing.png`)))).status).toBe(404);
	});
});
