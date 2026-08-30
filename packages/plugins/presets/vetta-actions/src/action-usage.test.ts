import type { PluginAppActionRegistration, PluginContext } from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import plugin from "./index";

type Registration = Pick<PluginAppActionRegistration, "id" | "publicId" | "usage" | "effect">;

describe("official Action usage", () => {
	it("publishes usage for every live registration without changing its public identity", async () => {
		const registrations: Registration[] = [];
		const ctx = {
			appActions: {
				register: (registration: Registration) => {
					registrations.push(registration);
					return { dispose() {} };
				},
			},
		} as unknown as PluginContext;
		await plugin.activate(ctx);

		expect(registrations).toHaveLength(37);
		expect(new Set(registrations.map(({ publicId }) => publicId)).size).toBe(37);
		for (const registration of registrations) {
			expect(registration.publicId).toBe(registration.id);
			expect(registration.usage?.target, registration.id).toContain("Vetta Desktop");
			for (const field of ["useWhen", "avoidWhen", "alternatives"] as const) {
				expect(registration.usage?.[field].trim().length, `${registration.id}.${field}`).toBeGreaterThan(0);
			}
		}
		const usage = (id: string) => registrations.find((registration) => registration.id === id)?.usage;
		expect(usage("appearance.theme")?.avoidWhen).toContain("网页");
		expect(usage("projects.manage")?.avoidWhen).toContain("React");
		expect(usage("scheduler.task")?.avoidWhen).toContain("cron");
		expect(usage("skills.manage")?.alternatives).toContain("invoke_skill");
	});
});
