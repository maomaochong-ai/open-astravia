/**
 * 端到端跑 publish.mjs 本体：真的 spawn node、真的读本地包、真的打一个 HTTP server。
 *
 * 为什么不 mock：这个脚本存在的全部理由就是「能读到用户磁盘上的包并传出去」，
 * 把 fs 与 fetch 换成假的，剩下的部分就没什么值得测的了。
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "publish-ability", "scripts", "publish.mjs");

/** 跑一次脚本，返回退出码与解析后的 stdout。 */
function runScript(args, env = {}) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [SCRIPT, ...args], {
			env: { ...process.env, ...env },
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => {
			stdout += c;
		});
		child.stderr.on("data", (c) => {
			stderr += c;
		});
		child.on("close", (code) => {
			let payload;
			try {
				payload = JSON.parse(stdout);
			} catch {
				payload = undefined;
			}
			resolve({ code, stdout, stderr, payload });
		});
	});
}

function validPayload(overrides = {}) {
	return {
		type: "mcp",
		slug: "my-server",
		mcp_config: { command: "npx" },
		detail: {
			name: "My Server",
			description: "一句话简介",
			author: "Me",
			content: "# 正文",
		},
		...overrides,
	};
}

describe("publish.mjs", () => {
	let workdir;
	let server;
	let baseUrl;
	let received;

	beforeEach(async () => {
		workdir = mkdtempSync(join(tmpdir(), "publish-test-"));
		received = [];

		server = createServer((req, res) => {
			const chunks = [];
			req.on("data", (c) => chunks.push(c));
			req.on("end", () => {
				received.push({
					url: req.url,
					authorization: req.headers.authorization,
					contentType: req.headers["content-type"],
					body: Buffer.concat(chunks),
				});
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						code: 0,
						data: { slug: "my-server", type: "mcp", version: "1.0.0", review_status: "pending" },
					}),
				);
			});
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		baseUrl = `http://127.0.0.1:${server.address().port}`;
	});

	afterEach(async () => {
		rmSync(workdir, { recursive: true, force: true });
		await new Promise((resolve) => server.close(resolve));
	});

	function writePayload(payload) {
		const path = join(workdir, "payload.json");
		writeFileSync(path, JSON.stringify(payload));
		return path;
	}

	const authEnv = (extra = {}) => ({
		VETTA_API_TOKEN: "test-token",
		VETTA_API_BASE_URL: baseUrl,
		...extra,
	});

	it("提交成功时输出结构化结果并 exit 0", async () => {
		const result = await runScript(["--input", writePayload(validPayload())], authEnv());

		expect(result.code).toBe(0);
		expect(result.payload.ok).toBe(true);
		expect(result.payload.slug).toBe("my-server");
		expect(result.payload.review_status).toBe("pending");
		expect(result.payload.message).toContain("等待管理员审核");
	});

	it("请求带 Bearer 与 multipart", async () => {
		await runScript(["--input", writePayload(validPayload())], authEnv());

		expect(received[0].authorization).toBe("Bearer test-token");
		expect(received[0].contentType).toContain("multipart/form-data");
		expect(received[0].url).toBe("/api/v1/abilities/submit");
	});

	it("baseUrl 自带 API 前缀时不重复拼接", async () => {
		// 桌面端注入的 VETTA_SERVER_URL 本身就带 /api/v1
		await runScript(["--input", writePayload(validPayload())], authEnv({ VETTA_API_BASE_URL: `${baseUrl}/api/v1` }));

		expect(received[0].url).toBe("/api/v1/abilities/submit");
	});

	it("校验失败时一次列全问题且不发请求", async () => {
		const result = await runScript(["--input", writePayload({ type: "mcp", slug: "s", detail: {} })], authEnv());

		expect(result.code).toBe(1);
		expect(result.payload.ok).toBe(false);
		expect(result.payload.errors.length).toBeGreaterThan(1);
		expect(received).toHaveLength(0);
	});

	it("--dry-run 只校验不提交", async () => {
		const result = await runScript(["--input", writePayload(validPayload()), "--dry-run"], authEnv());

		expect(result.code).toBe(0);
		expect(result.payload.dry_run).toBe(true);
		expect(received).toHaveLength(0);
	});

	it("入参可从 stdin 传入", async () => {
		// 长 markdown 走文件更稳，但 stdin 省一个临时文件
		const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, ...authEnv() } });
		child.stdin.write(JSON.stringify(validPayload()));
		child.stdin.end();

		const code = await new Promise((resolve) => child.on("close", resolve));

		expect(code).toBe(0);
		expect(received).toHaveLength(1);
	});

	it("有产物形态会把本地包读进 multipart", async () => {
		// 这是整个脚本存在的理由：远程 MCP 摸不到这个文件
		const pkgPath = join(workdir, "my-skill.zip");
		writeFileSync(pkgPath, Buffer.from("PKfake-zip-content"));

		const result = await runScript(
			["--input", writePayload({ type: "skill", package_path: pkgPath, detail: validPayload().detail })],
			authEnv(),
		);

		expect(result.code).toBe(0);
		const body = received[0].body.toString("latin1");
		expect(body).toContain("fake-zip-content");
		expect(body).toContain("my-skill.zip");
	});

	it("未登录时给出可操作的提示，且不发请求", async () => {
		const result = await runScript(["--input", writePayload(validPayload())], {
			VETTA_API_TOKEN: "",
			VETTA_API_BASE_URL: "",
			VETTA_HOME: workdir, // 该目录下没有 auth.json
		});

		expect(result.code).toBe(1);
		expect(result.payload.message).toContain("未登录");
		expect(received).toHaveLength(0);
	});

	it("从 ~/.vetta/auth.json 读登录态", async () => {
		// 环境变量是联调口子，正常路径是客户端下沉的凭据文件
		writeFileSync(join(workdir, "auth.json"), JSON.stringify({ baseUrl, token: "file-token" }));

		const result = await runScript(["--input", writePayload(validPayload())], {
			VETTA_API_TOKEN: "",
			VETTA_API_BASE_URL: "",
			VETTA_HOME: workdir,
		});

		expect(result.code).toBe(0);
		expect(received[0].authorization).toBe("Bearer file-token");
	});

	it("入参不是合法 JSON 时报错而不是崩栈", async () => {
		const path = join(workdir, "bad.json");
		writeFileSync(path, "{ not json");

		const result = await runScript(["--input", path], authEnv());

		expect(result.code).toBe(1);
		expect(result.payload.message).toContain("不是合法 JSON");
	});

	it("服务端返回业务错误码时如实转述", async () => {
		await new Promise((resolve) => server.close(resolve));
		server = createServer((req, res) => {
			req.resume();
			req.on("end", () => {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ code: 40001, message: "slug 已被他人占用" }));
			});
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const url = `http://127.0.0.1:${server.address().port}`;

		const result = await runScript(
			["--input", writePayload(validPayload())],
			{ VETTA_API_TOKEN: "t", VETTA_API_BASE_URL: url },
		);

		expect(result.code).toBe(1);
		expect(result.payload.message).toContain("slug 已被他人占用");
	});

	it("服务端返回非 JSON 时截断回显而不是吞掉", async () => {
		await new Promise((resolve) => server.close(resolve));
		server = createServer((req, res) => {
			req.resume();
			req.on("end", () => {
				res.writeHead(502, { "Content-Type": "text/html" });
				res.end("<html>502 Bad Gateway</html>");
			});
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const url = `http://127.0.0.1:${server.address().port}`;

		const result = await runScript(
			["--input", writePayload(validPayload())],
			{ VETTA_API_TOKEN: "t", VETTA_API_BASE_URL: url },
		);

		expect(result.code).toBe(1);
		expect(result.payload.message).toContain("502 Bad Gateway");
	});

	it("连不上服务时报出 baseUrl 便于定位", async () => {
		const result = await runScript(["--input", writePayload(validPayload())], {
			VETTA_API_TOKEN: "t",
			// 未监听的端口
			VETTA_API_BASE_URL: "http://127.0.0.1:1",
		});

		expect(result.code).toBe(1);
		expect(result.payload.message).toContain("无法连接");
	});

	it("已上架条目的重传给出「线上版本不受影响」的说明", async () => {
		await new Promise((resolve) => server.close(resolve));
		server = createServer((req, res) => {
			req.resume();
			req.on("end", () => {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						code: 0,
						data: { slug: "s", type: "mcp", version: "1.1.0", review_status: "approved", pending: { version: "1.1.0" } },
					}),
				);
			});
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const url = `http://127.0.0.1:${server.address().port}`;

		const result = await runScript(
			["--input", writePayload(validPayload())],
			{ VETTA_API_TOKEN: "t", VETTA_API_BASE_URL: url },
		);

		expect(result.payload.has_pending).toBe(true);
		expect(result.payload.message).toContain("用户不受影响");
	});
});
