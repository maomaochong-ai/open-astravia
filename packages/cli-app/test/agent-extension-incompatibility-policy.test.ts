import type {
	CodingAgentExtensionCompatibilityAssessment,
	CodingAgentHostBootstrap,
} from "@vetta/coding-agent/bootstrap";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentRuntimeCli } from "../src/agent-runtime-selection.js";

const runtimeMocks = vi.hoisted(() => ({
	createBootstrap: vi.fn<() => Promise<unknown>>(),
	prepareIm: vi.fn<() => Promise<unknown>>(),
	preparePrint: vi.fn<() => Promise<unknown>>(),
	prepareRpc: vi.fn<() => Promise<unknown>>(),
	runIm: vi.fn<() => Promise<void>>(),
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
	prepareImRuntimeHost: runtimeMocks.prepareIm,
	preparePrintRuntimeHost: runtimeMocks.preparePrint,
	prepareRpcRuntimeHost: runtimeMocks.prepareRpc,
	runImRuntimeHost: runtimeMocks.runIm,
	runPrintRuntimeHost: runtimeMocks.runPrint,
	runRpcRuntimeHost: runtimeMocks.runRpc,
}));

const bootstrap = {
	cwd: "C:/test/workspace",
	parsed: { sessionDir: "C:/test/conversations" },
} as CodingAgentHostBootstrap;

const extensionCompatibility = {
	extensionCount: 1,
	bootstrapContributions: { providers: [], flags: [] },
	registrations: [
		{
			path: "C:/test/forward-extension.ts",
			events: ["future_event"],
			tools: [],
			commands: [],
			shortcuts: [],
			flags: [],
			messageRenderers: [],
		},
	],
	requiredRuntimeCapabilities: ["opaque-runtime-api", "event-handler"],
	inapplicableRuntimeCapabilities: [],
	requiresLegacyRuntime: true,
	inapplicableEvents: [],
	unsupportedEvents: ["future_event"],
	unmetRuntimeCapabilities: ["event-handler"],
} satisfies CodingAgentExtensionCompatibilityAssessment;

beforeEach(() => {
	process.exitCode = undefined;
	runtimeMocks.createBootstrap.mockReset().mockResolvedValue(bootstrap);
	for (const prepare of [runtimeMocks.prepareIm, runtimeMocks.preparePrint, runtimeMocks.prepareRpc]) {
		prepare.mockReset().mockResolvedValue({
			kind: "extension-incompatible",
			bootstrap,
			sessionPath: undefined,
			extensionCompatibility,
		});
	}
	for (const run of [runtimeMocks.runIm, runtimeMocks.runPrint, runtimeMocks.runRpc]) {
		run.mockReset().mockResolvedValue(undefined);
	}
});

afterEach(() => {
	vi.restoreAllMocks();
	process.exitCode = undefined;
});

describe("Extension incompatibility policy", () => {
	it("writes one validated RPC startup failure without opening a session", async () => {
		const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

		await runAgentRuntimeCli(["--mode", "rpc", "--scenario", "im-claw"]);

		expect(process.exitCode).toBe(2);
		expect(stdout).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toEqual({
			type: "response",
			command: "startup",
			success: false,
			errorCode: "extension_incompatible",
			phase: "startup",
			recoverability: "user_action",
			error: "Extension requires events or runtime capabilities that are not supported by this runtime",
			unsupportedEvents: ["future_event"],
			unmetRuntimeCapabilities: ["event-handler"],
		});
		expect(stderr).not.toHaveBeenCalled();
		expect(runtimeMocks.runIm).not.toHaveBeenCalled();
	});

	it("writes Print diagnostics without opening a session", async () => {
		const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

		await runAgentRuntimeCli(["--mode", "json", "reject incompatible extension"]);

		expect(process.exitCode).toBe(2);
		expect(stdout).not.toHaveBeenCalled();
		expect(stderr).toHaveBeenCalledOnce();
		expect(String(stderr.mock.calls[0]?.[0])).toContain(
			"errorCode=extension_incompatible unsupportedEvents=future_event unmetCapabilities=event-handler",
		);
		expect(runtimeMocks.runPrint).not.toHaveBeenCalled();
	});
});
