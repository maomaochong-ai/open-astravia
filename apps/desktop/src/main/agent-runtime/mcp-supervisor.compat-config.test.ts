// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@astravia/coding-agent/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopMcpConfigSource } from "./mcp-supervisor.js";

/**
 * `.mcp.json` 的支持分两层：库层（runtime-node）能读，和产品层（桌面 supervisor）真的
 * 把路径传进去。库层用例绿了不代表产品可用——这里锁的是后一半：
 * `createDesktopMcpConfigSource` 必须把仓库根的 `.mcp.json` 交给配置源。
 */
describe("createDesktopMcpConfigSource 的 .mcp.json 接线", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "astravia-mcp-supervisor-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const options = () => ({
		projectRoot: root,
		agentDir: join(root, "agent"),
		dynamicOnly: false,
	});

	it("读到仓库根的 .mcp.json（Claude Code 约定的项目级配置）", () => {
		writeFileSync(
			join(root, ".mcp.json"),
			JSON.stringify({ mcpServers: { compatOnly: { command: "node", args: ["compat.js"] } } }),
		);

		const project = createDesktopMcpConfigSource(options()).loadProject();

		expect(project?.mcpServers.compatOnly).toMatchObject({ command: "node" });
	});

	it("同名 server 以 .mcp/config.json 为准，不被兼容文件覆盖", () => {
		writeFileSync(
			join(root, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					shared: { command: "compat" },
					compatOnly: { command: "compat" },
				},
			}),
		);
		const nativeDir = join(root, CONFIG_DIR_NAME);
		mkdirSync(nativeDir, { recursive: true });
		writeFileSync(join(nativeDir, "mcp.json"), JSON.stringify({ mcpServers: { shared: { command: "native" } } }));

		const project = createDesktopMcpConfigSource(options()).loadProject();

		expect(project?.mcpServers.shared).toMatchObject({ command: "native" });
		expect(project?.mcpServers.compatOnly).toMatchObject({ command: "compat" });
	});

	it("兼容文件里的坏条目不炸整体，只报一条诊断", () => {
		writeFileSync(join(root, ".mcp.json"), "{ this is not json");
		const onDiagnostic = vi.fn();

		const project = createDesktopMcpConfigSource(options(), onDiagnostic).loadProject();

		expect(project).toBeNull();
		expect(onDiagnostic).toHaveBeenCalled();
	});

	it("dynamicOnly 时不读任何文件", () => {
		writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { x: { command: "x" } } }));

		const source = createDesktopMcpConfigSource({ ...options(), dynamicOnly: true });

		expect(source.loadProject()).toBeNull();
	});
});
