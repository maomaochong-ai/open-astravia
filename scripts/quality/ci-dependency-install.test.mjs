import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installCiDependencies } from "./install-ci-dependencies.mjs";

const repoRoot = join(import.meta.dirname, "../..");
const workflowsDir = join(repoRoot, ".github/workflows");
const installAction = readFileSync(join(repoRoot, ".github/actions/install-bun-dependencies/action.yml"), "utf8");
const workflowSources = readdirSync(workflowsDir)
	.filter((name) => name.endsWith(".yml"))
	.map((name) => ({ name, source: readFileSync(join(workflowsDir, name), "utf8") }));

describe("CI dependency installation", () => {
	it("keeps frozen Bun installs behind the shared retry action", () => {
		for (const workflow of workflowSources) {
			expect(workflow.source, workflow.name).not.toContain("run: bun install --frozen-lockfile");
		}
		expect(workflowSources.filter(({ source }) => source.includes("Install dependencies"))).toSatisfy((workflows) =>
			workflows.every(({ source }) => source.includes("uses: ./.github/actions/install-bun-dependencies")),
		);
	});

	it("runs the shared cross-platform installer from the composite action", () => {
		expect(installAction).toContain("run: node scripts/quality/install-ci-dependencies.mjs");
	});

	it("clears the cache and retries a failed frozen install", async () => {
		const commands = [];
		const delays = [];
		const exitCodes = [1, 0, 0];

		await installCiDependencies({
			runCommand: async (command, args) => {
				commands.push([command, ...args]);
				return exitCodes.shift();
			},
			delay: async (milliseconds) => delays.push(milliseconds),
			log: () => undefined,
		});

		expect(commands).toEqual([
			["bun", "install", "--frozen-lockfile"],
			["bun", "pm", "cache", "rm"],
			["bun", "install", "--frozen-lockfile"],
		]);
		expect(delays).toEqual([2_000]);
	});

	it("fails after three install attempts while allowing cache cleanup failures", async () => {
		const commands = [];

		await expect(
			installCiDependencies({
				runCommand: async (command, args) => {
					commands.push([command, ...args]);
					return 1;
				},
				delay: async () => undefined,
				log: () => undefined,
			}),
		).rejects.toThrow("failed after 3 attempts");

		expect(commands.filter(([, operation]) => operation === "install")).toHaveLength(3);
		expect(commands.filter(([, operation]) => operation === "pm")).toHaveLength(2);
	});
});
