import type {
	AuthorizedCapabilityClient,
	CapabilityAccessHandle,
	CapabilityAccessSessionFactory,
	CapabilityAccessSessionOptions,
	CapabilityToken,
} from "@vetta/capability-sdk";
import { CAPABILITY_CONSTRAINT_KINDS, FOUNDATION_STORAGE_CAPABILITIES } from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { ThemeCapabilityAdapter, themeStorageCapabilityNamespace } from "./theme-capability-adapter.js";

class RecordingAccessFactory implements CapabilityAccessSessionFactory {
	readonly invocations: Array<{ readonly capabilityId: string; readonly input: unknown }> = [];
	options: CapabilityAccessSessionOptions | undefined;
	revoked = false;

	createSession(options: CapabilityAccessSessionOptions): CapabilityAccessHandle {
		this.options = options;
		const client: AuthorizedCapabilityClient = {
			invoke: async <Input, Output>(capability: CapabilityToken<Input, Output>, input: Input): Promise<Output> => {
				this.invocations.push({ capabilityId: capability.id, input });
				return capability.parseOutput({});
			},
		};
		return {
			client,
			subject: options.subject,
			isRevoked: () => this.revoked,
			revoke: () => {
				this.revoked = true;
			},
		};
	}
}

describe("ThemeCapabilityAdapter", () => {
	it("owns Theme identity mapping and namespace-constrained session lifecycle", async () => {
		const access = new RecordingAccessFactory();
		const adapter = new ThemeCapabilityAdapter(access);
		const namespace = themeStorageCapabilityNamespace("theme.example");

		await adapter.getStorage("theme.example");
		await adapter.getStorage("theme.example");

		expect(access.options).toMatchObject({
			subject: { id: "system-adapter:theme-storage:theme.example" },
			grants: expect.arrayContaining([
				{
					capabilityId: FOUNDATION_STORAGE_CAPABILITIES.GET_ALL.id,
					constraints: [{ kind: CAPABILITY_CONSTRAINT_KINDS.NAMESPACE, value: namespace }],
				},
			]),
		});
		expect(access.invocations).toEqual([
			{ capabilityId: FOUNDATION_STORAGE_CAPABILITIES.GET_ALL.id, input: { namespace } },
			{ capabilityId: FOUNDATION_STORAGE_CAPABILITIES.GET_ALL.id, input: { namespace } },
		]);

		adapter.dispose();
		expect(access.revoked).toBe(true);
	});

	it("rejects invalid Theme ids before creating an access session", async () => {
		const access = new RecordingAccessFactory();
		const adapter = new ThemeCapabilityAdapter(access);

		await expect(adapter.getStorage("../theme")).rejects.toThrow("Invalid theme storage themeId");
		expect(access.options).toBeUndefined();
	});
});
