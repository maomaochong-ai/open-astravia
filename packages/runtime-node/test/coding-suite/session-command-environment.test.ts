import { describe, expect, it } from "vitest";
import { createNodeHostSessionCommandEnvironment } from "../../src/coding/index.js";

describe("Node host Session command environment", () => {
	it("merges Session environment values and owns an isolated background service", () => {
		const first = createNodeHostSessionCommandEnvironment({
			cwd: process.cwd(),
			resolveShell: () => ({ executable: "shell", args: ["-c"] }),
			environment: () => ({ BASE_ONLY: "base", OVERRIDE: "base" }),
			sessionEnvironment: { OVERRIDE: "session", SESSION_ONLY: "session" },
		});
		const second = createNodeHostSessionCommandEnvironment({
			cwd: process.cwd(),
			resolveShell: () => ({ executable: "shell", args: ["-c"] }),
		});

		try {
			expect(first.commandEnvironment()).toMatchObject({
				BASE_ONLY: "base",
				OVERRIDE: "session",
				SESSION_ONLY: "session",
			});
			expect(first.registrations.map(({ tool }) => tool.name)).toEqual(["bash", "shell"]);
			expect(first.backgroundService).not.toBe(second.backgroundService);
			expect(first.backgroundService.list()).toEqual([]);
			expect(second.backgroundService.list()).toEqual([]);
		} finally {
			first.dispose();
			second.dispose();
		}
	});
});
