import type { CodingAgentHostBootstrap } from "@vetta/coding-agent/bootstrap";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentRuntimeCli } from "../src/agent-runtime-selection.js";

const runtimeMocks = vi.hoisted(() => ({
	createBootstrap: vi.fn<() => Promise<unknown>>(),
	preparePrint: vi.fn<() => Promise<unknown>>(),
	prepareRpc: vi.fn<() => Promise<unknown>>(),
	runPrint: vi.fn<() => Promise<void>>(),
	runRpc: vi.fn<() => Promise<void>>(),
}));

vi.mock("@vetta/coding-agent/bootstrap", () => ({
	createAgentCliBootstrap: runtimeMocks.createBootstrap,
	resolveCodingAgentSessionDir: () => "C:/test/conversations",
}));

vi.mock("@vetta/coding-agent/cli-control", () => ({
	runCodingAgentCliControl: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("../src/rpc/cli-session-format-compatibility.js", () => ({
	createCliRuntimeSessionCatalog: () => ({}),
}));

vi.mock("../src/rpc/runtime-host/runtime-host.js", () => ({
	preparePrintRuntimeHost: runtimeMocks.preparePrint,
	prepareRpcRuntimeHost: runtimeMocks.prepareRpc,
	runPrintRuntimeHost: runtimeMocks.runPrint,
	runRpcRuntimeHost: runtimeMocks.runRpc,
}));

const bootstrap = {
	cwd: "C:/test/workspace",
	parsed: { sessionDir: "C:/test/conversations" },
} as CodingAgentHostBootstrap;

const sessionCompatibility = {
	kind: "session-incompatible",
	status: "not-representable",
	sourcePath: "C:/test/conversations/future.jsonl",
	errorCode: "session_version_unsupported",
	sourceVersion: 4,
	issueCode: "invalid-header",
	issueCount: 1,
} as const;

beforeEach(() => {
	process.exitCode = undefined;
	runtimeMocks.createBootstrap.mockReset().mockResolvedValue(bootstrap);
	for (const prepare of [runtimeMocks.preparePrint, runtimeMocks.prepareRpc]) {
		prepare.mockReset().mockResolvedValue({
			kind: "session-incompatible",
			bootstrap,
			sessionPath: sessionCompatibility.sourcePath,
			sessionCompatibility,
		});
	}
	for (const run of [runtimeMocks.runPrint, runtimeMocks.runRpc]) {
		run.mockReset().mockResolvedValue(undefined);
	}
});

afterEach(() => {
	vi.restoreAllMocks();
	process.exitCode = undefined;
});

describe("Session incompatibility policy", () => {
	it("writes one validated RPC startup failure without opening a session", async () => {
		const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

		await runAgentRuntimeCli(["--mode", "rpc", "--session", sessionCompatibility.sourcePath]);

		expect(process.exitCode).toBe(2);
		expect(stdout).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toEqual({
			type: "response",
			command: "startup",
			success: false,
			errorCode: "session_version_unsupported",
			phase: "startup",
			recoverability: "user_action",
			error: "Historical session cannot be imported safely",
			sessionPath: sessionCompatibility.sourcePath,
			sourceVersion: 4,
			issueCode: "invalid-header",
			issueCount: 1,
		});
		expect(stderr).not.toHaveBeenCalled();
		expect(runtimeMocks.runRpc).not.toHaveBeenCalled();
	});

	it("writes Print diagnostics without opening a session", async () => {
		const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

		await runAgentRuntimeCli(["--mode", "json", "--session", sessionCompatibility.sourcePath, "hello"]);

		expect(process.exitCode).toBe(2);
		expect(stdout).not.toHaveBeenCalled();
		expect(stderr).toHaveBeenCalledOnce();
		expect(String(stderr.mock.calls[0]?.[0])).toContain(
			"errorCode=session_version_unsupported session=C:/test/conversations/future.jsonl",
		);
		expect(runtimeMocks.runPrint).not.toHaveBeenCalled();
	});
});
