import { describe, expect, it } from "vitest";
import { ensureMacosAdHocSignature } from "./dev-cli-shim";

function recordingExec(failures: ReadonlySet<string> = new Set()) {
	const calls: string[][] = [];
	return {
		calls,
		exec: async (file: string, args: readonly string[]) => {
			calls.push([file, ...args]);
			if (failures.has(args[0] ?? "")) throw new Error(`${args[0]} failed`);
			return undefined;
		},
	};
}

describe("ensureMacosAdHocSignature", () => {
	it("leaves a binary alone when its signature is already valid", async () => {
		const { calls, exec } = recordingExec();

		await expect(ensureMacosAdHocSignature("/dev/astravia-cli-app", { platform: "darwin", exec })).resolves.toBe(
			false,
		);

		expect(calls).toEqual([["codesign", "--verify", "/dev/astravia-cli-app"]]);
	});

	it("re-signs ad hoc when the signature does not match the binary, so macOS stops killing it", async () => {
		const { calls, exec } = recordingExec(new Set(["--verify"]));

		await expect(ensureMacosAdHocSignature("/dev/astravia-cli-app", { platform: "darwin", exec })).resolves.toBe(
			true,
		);

		expect(calls).toEqual([
			["codesign", "--verify", "/dev/astravia-cli-app"],
			["codesign", "--force", "--sign", "-", "/dev/astravia-cli-app"],
		]);
	});

	it("does nothing on platforms without macOS code signing", async () => {
		const { calls, exec } = recordingExec();

		await expect(
			ensureMacosAdHocSignature("C:/dev/astravia-cli-app.exe", { platform: "win32", exec }),
		).resolves.toBe(false);
		await expect(ensureMacosAdHocSignature("/dev/astravia-cli-app", { platform: "linux", exec })).resolves.toBe(
			false,
		);

		expect(calls).toEqual([]);
	});

	it("reports which binary could not be re-signed instead of leaving a silently broken CLI", async () => {
		const { exec } = recordingExec(new Set(["--verify", "--force"]));

		await expect(ensureMacosAdHocSignature("/dev/astravia-cli-app", { platform: "darwin", exec })).rejects.toThrow(
			"/dev/astravia-cli-app",
		);
	});
});
