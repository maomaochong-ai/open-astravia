import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoopbackSshConnection } from "@vetta/ssh-transport/testing";
import { describe, expect, it, vi } from "vitest";
import { createLocalFileUrl } from "../shared/file-protocol.js";

vi.mock("electron", () => ({
	protocol: { handle: () => undefined },
	app: { getPath: () => "/tmp/vetta-test-userdata", getAppPath: () => "/tmp/vetta-test-app" },
}));
const connection = createLoopbackSshConnection("build-01");
vi.mock("./ssh/ssh-runtime.js", () => ({ getSshConnection: () => connection }));

const { handleFileRequest } = await import("./file-protocol.js");
const { allowProjectRoot } = await import("./filesystem/filesystem-service.js");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("vetta-file 协议", () => {
	it("远程项目里的文件能取回，Content-Type 与本机同一套", async () => {
		// 回归：此前只有 vetta-media 支持远端。同一个插件用 vetta-file 只得到一张破图，
		// 没有任何提示——两个协议的能力不对称本身就是个陷阱。
		const remoteRoot = realpathSync(mkdtempSync(join(tmpdir(), "vetta-file-remote-")));
		writeFileSync(join(remoteRoot, "shot.png"), PNG);
		allowProjectRoot(`ssh://build-01${remoteRoot}`);

		const response = await handleFileRequest(new Request(createLocalFileUrl(`ssh://build-01${remoteRoot}/shot.png`)));

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("image/png");
		expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
	});

	it("本机文件照旧", async () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "vetta-file-local-")));
		writeFileSync(join(root, "shot.png"), PNG);
		allowProjectRoot(root);

		const response = await handleFileRequest(new Request(createLocalFileUrl(join(root, "shot.png"))));

		expect(response.status).toBe(200);
		expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
	});

	it("远程项目之外的文件被拒绝", async () => {
		const response = await handleFileRequest(new Request(createLocalFileUrl("ssh://build-01/etc/passwd")));
		expect([403, 404]).toContain(response.status);
	});
});
