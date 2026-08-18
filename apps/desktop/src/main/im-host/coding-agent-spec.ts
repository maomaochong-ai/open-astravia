import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { DEFAULT_SERVER_URL } from "../constants.js";
import type { CodingAgentSpec } from "./host-protocol.js";

/**
 * Resolve the on-disk root of the `@vetta/coding-agent` package so the
 * spawned agent-rpc subprocess can find its bundled runtime assets
 * (theme JSON, export-html template, package.json, banner). We never rely
 * on the subprocess's own `getPackageDir()` walk-up because once
 * coding-agent is Vite-bundled into Electron's main bundle, `__dirname`
 * resolves into the bundle's tree — wrong.
 *
 * Prod: assets are staged into <Resources>/coding-agent/ by prepare-pack.
 * Dev: resolve the workspace directory via the package's package.json.
 */
function resolveCodingAgentPackageDir(): string {
	if (app.isPackaged) {
		return join(process.resourcesPath, "coding-agent");
	}
	// Use ESM's import.meta.resolve to find coding-agent's main entry,
	// then walk up to the package root. We avoid require.resolve because
	// coding-agent's "exports" map has no "require" / "default" condition
	// (ESM-only export) and CJS resolution refuses it. We also avoid
	// "@vetta/coding-agent/package.json" subpath because "./package.json"
	// isn't listed in "exports".
	const entryUrl = import.meta.resolve("@vetta/coding-agent");
	const entry = fileURLToPath(entryUrl);
	let dir = dirname(entry);
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) return dir;
		dir = dirname(dir);
	}
	throw new Error(`coding-agent package.json not found walking up from ${entry}`);
}

/**
 * Build the {@link CodingAgentSpec} that the im-gateway sidecar uses to
 * spawn one coding-agent subprocess per IM session.
 *
 * Production: Vetta.app's executable. macOS/Linux use `--agent-rpc`, which
 * main.ts detects before window/UI bring-up. Windows runs the staged
 * coding-agent CLI under `ELECTRON_RUN_AS_NODE=1`, because GUI Electron
 * mode closes stdio too early for the RPC handshake.
 *
 * Dev: Electron + the bundled dev main entry + `--agent-rpc`. Mirrors the
 * production argv shape so the sidecar code path stays identical.
 *
 * `packageDir` is always populated so the sidecar forwards it as
 * `VETTA_PACKAGE_DIR` to the child — the only reliable way for the
 * bundled agent to find its on-disk assets.
 */
export interface BuildCodingAgentSpecOptions {
	/**
	 * When set, forwarded to coding-agent as `--provider <p> --model <m>`
	 * (+ `--thinking <level>` when reasoningLevel is set).
	 */
	agentModel?: { provider: string; model: string; reasoningLevel?: string };
}

export function buildCodingAgentSpec(opts: BuildCodingAgentSpecOptions = {}): CodingAgentSpec {
	const packageDir = resolveCodingAgentPackageDir();
	const modelArgs: string[] = opts.agentModel
		? [
				"--provider",
				opts.agentModel.provider,
				"--model",
				opts.agentModel.model,
				...(opts.agentModel.reasoningLevel ? ["--thinking", opts.agentModel.reasoningLevel] : []),
			]
		: [];

	// Inject the host's compile-time server URL into the subprocess env.
	// coding-agent's main.ts reads `process.env.VETTA_SERVER_URL` ahead of
	// `~/.vetta/agent/settings.json`, which avoids the prod failure where a
	// stale `serverUrl` (e.g. left over from a dev/LAN login) causes
	// `loadRemoteModels` to 401 against the wrong gateway — remote providers
	// (vetta-go et al.) disappear and the agent exits with
	// "Unknown provider" before the prompt is ever processed.
	const serverUrl = DEFAULT_SERVER_URL;

	if (app.isPackaged) {
		if (process.platform === "win32") {
			return {
				bin: process.execPath,
				prefixArgs: [join(packageDir, "dist", "agent-rpc-cli.mjs"), ...modelArgs, "--scenario", "im-claw"],
				runAsNode: true,
				packageDir,
				serverUrl,
			};
		}
		// Linux: pass `--no-sandbox` as a REAL argv entry, placed BEFORE
		// `--agent-rpc` so (a) Chromium parses it during ContentMain init and
		// (b) main.ts's parseAgentRpcCommand only forwards args AFTER
		// `--agent-rpc` to coding-agent, keeping `--no-sandbox` out of the
		// agent's own arg parser. The child's in-process
		// `app.commandLine.appendSwitch("no-sandbox")` runs too late for
		// AppImage: chrome-sandbox lives in the /tmp mount without setuid
		// root, so the SUID sandbox host FATALs in early browser init before
		// the JS main executes. The child renders no untrusted web content,
		// so disabling the sandbox is safe. macOS keeps the plain argv.
		const prefixArgs =
			process.platform === "linux"
				? ["--no-sandbox", "--agent-rpc", ...modelArgs, "--scenario", "im-claw"]
				: ["--agent-rpc", ...modelArgs, "--scenario", "im-claw"];
		return {
			bin: process.execPath,
			prefixArgs,
			packageDir,
			serverUrl,
		};
	}
	const appRoot = process.cwd();
	return {
		bin: process.execPath,
		prefixArgs: [join(appRoot, "dist/main/index.js"), "--agent-rpc", ...modelArgs, "--scenario", "im-claw"],
		packageDir,
		serverUrl,
	};
}
