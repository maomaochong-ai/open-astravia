import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SandboxShellGrant } from "@vetta/runtime-core/sandbox";
import type { ForegroundCommandOperations } from "@vetta/runtime-tools";
import { afterEach, describe, expect, it } from "vitest";
import { buildWindowsSandboxPolicy } from "./commands/windows-policy.js";
import { createNodeSandboxHost } from "./node-sandbox-host.js";
import { clearSessionGrants, getSandboxShellGrant } from "./sandbox-permissions.js";

const TEST_SESSION_ID = "node-sandbox-host-test";

afterEach(() => clearSessionGrants(TEST_SESSION_ID));

describe("Node sandbox host", () => {
	it.each(["win32", "linux", "darwin"] as const)(
		"selects the %s host without resolving platform binaries when operations are injected",
		(platform) => {
			const operations = createOperations();
			const host = createNodeSandboxHost({ platform, commandOperations: operations });

			expect(host?.platform).toBe(platform);
			expect(host?.commandOperations).toBe(operations);
		},
	);

	it("does not claim unsupported Node platforms", () => {
		expect(createNodeSandboxHost({ platform: "aix", commandOperations: createOperations() })).toBeUndefined();
	});

	it("resolves workspace boundaries and propagates shell grants through the Node context", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "vetta-node-sandbox-workspace-"));
		const outside = await mkdtemp(join(tmpdir(), "vetta-node-sandbox-outside-"));
		try {
			const host = createNodeSandboxHost({ platform: "win32", commandOperations: createOperations() });
			if (!host) throw new Error("Missing Node sandbox host");
			const insideAccess = await host.resolveWorkspacePathAccess(join(workspace, "missing.txt"), workspace);
			const outsideAccess = await host.resolveWorkspacePathAccess(join(outside, "missing.txt"), workspace);
			expect(insideAccess.allowed).toBe(true);
			expect(outsideAccess.allowed).toBe(false);

			const grant: SandboxShellGrant = { allowReadRoots: [outside], allowWriteRoots: [outside] };
			await host.runWithShellGrant(workspace, grant, async () => {
				expect(getSandboxShellGrant(workspace)).toEqual(grant);
			});
			expect(getSandboxShellGrant(workspace)).toBeUndefined();
		} finally {
			await rm(workspace, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("builds a closed-network Windows policy from host paths and an explicit grant", () => {
		const cwd = resolve("C:/workspace");
		const tempRoot = resolve("C:/temp/sandbox");
		const grantRoot = resolve("C:/shared/output");
		const policy = buildWindowsSandboxPolicy({
			cwd,
			tempRoot,
			shellCommandPath: resolve("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"),
			grant: { allowReadRoots: [grantRoot], allowWriteRoots: [grantRoot] },
			env: { SystemRoot: resolve("C:/Windows"), APPDATA: resolve("C:/Users/test/AppData/Roaming") },
		});

		expect(policy.allowNetwork).toBe(false);
		expect(policy.allowReadRoots).toEqual(expect.arrayContaining([cwd, tempRoot, grantRoot]));
		expect(policy.allowWriteRoots).toEqual(expect.arrayContaining([cwd, tempRoot, grantRoot]));
		expect(policy.denyReadRoots).toContain(resolve("C:/Users/test/AppData/Roaming/Vetta"));
		expect(policy.denyWriteRoots).toEqual(policy.denyReadRoots);
		expect(policy.allowReadRoots).toContain(
			dirname(resolve("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")),
		);
	});
});

function createOperations(): ForegroundCommandOperations {
	return {
		async exec() {
			return { exitCode: 0 };
		},
	};
}
