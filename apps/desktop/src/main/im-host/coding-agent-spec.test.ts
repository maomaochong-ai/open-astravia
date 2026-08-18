import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";

// 形参必须显式声明：断言要读第二个参数（runAgentRuntimeCli 的 options）。
const runtimeSelector = vi.hoisted(() =>
	vi.fn(async (_args: readonly string[], _options?: { injectRuntimeCredentials?: unknown }) => {}),
);

vi.mock("electron", () => ({
	app: {
		isPackaged: true,
		getAppPath: () => "C:\\app",
	},
}));

vi.mock("@vetta/cli-host", () => ({
	runAgentRuntimeCli: runtimeSelector,
}));

vi.mock("../constants.js", () => ({
	DEFAULT_SERVER_URL: "https://api.test",
}));

import { runAgentRpcCommand } from "../cli/agent-rpc-command.js";
import { buildCodingAgentSpec } from "./coding-agent-spec.js";

const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
const originalPackageDir = process.env.VETTA_PACKAGE_DIR;

afterEach(() => {
	vi.restoreAllMocks();
	runtimeSelector.mockClear();
	if (originalResourcesPath) {
		Object.defineProperty(process, "resourcesPath", originalResourcesPath);
	} else {
		Reflect.deleteProperty(process, "resourcesPath");
	}
	if (originalPackageDir === undefined) {
		delete process.env.VETTA_PACKAGE_DIR;
	} else {
		process.env.VETTA_PACKAGE_DIR = originalPackageDir;
	}
});

describe("IM coding-agent invocation", () => {
	test("builds the Windows executable prefix without a Runtime selector", () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		Object.defineProperty(process, "resourcesPath", {
			configurable: true,
			value: "C:\\resources",
		});

		const spec = buildCodingAgentSpec();

		expect(spec).toMatchObject({
			bin: process.execPath,
			prefixArgs: ["C:\\resources\\coding-agent\\dist\\agent-rpc-cli.mjs", "--scenario", "im-claw"],
			runAsNode: true,
			packageDir: "C:\\resources\\coding-agent",
			serverUrl: "https://api.test",
		});
		expect(spec.prefixArgs).not.toContain("--agent-runtime");
	});

	test("routes the Electron discriminator through the single CLI Runtime host", async () => {
		Object.defineProperty(process, "resourcesPath", {
			configurable: true,
			value: "C:\\resources",
		});

		await expect(runAgentRpcCommand(["--mode", "rpc"])).resolves.toBe(0);
		expect(runtimeSelector).toHaveBeenCalledWith(["--mode", "rpc"], expect.anything());
	});

	test("即使凭据装配不可用也照常把子进程拉起来", async () => {
		// 保险库/日志子系统出问题时只能不注入凭据（自定义 provider 会自己报鉴权错），
		// 但绝不能让整个 Claw 子进程起不来——本地无鉴权 provider 本来还能用。
		Object.defineProperty(process, "resourcesPath", {
			configurable: true,
			value: "C:\\resources",
		});
		vi.doMock("../models/model-credential-store.js", () => {
			throw new Error("safeStorage unavailable");
		});
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

		await expect(runAgentRpcCommand(["--mode", "rpc"])).resolves.toBe(0);

		expect(runtimeSelector).toHaveBeenCalledOnce();
		expect(runtimeSelector.mock.calls[0]?.[1]).toMatchObject({ injectRuntimeCredentials: undefined });
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("凭据注入不可用"));
		vi.doUnmock("../models/model-credential-store.js");
	});

	test("packages the Windows RPC entry from cli-app instead of the Legacy coding-agent CLI", () => {
		const preparePackPath = fileURLToPath(new URL("../../../scripts/prepare-pack.js", import.meta.url));
		const source = readFileSync(preparePackPath, "utf8");

		expect(source).toContain('join(cliAppDir, "src", "agent-rpc-cli.ts")');
		expect(source).not.toContain('join(codingAgentDir, "dist", "cli.js")');
	});
});
