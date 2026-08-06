import {
	CAPABILITY_ERROR_CODES,
	CAPABILITY_LAYERS,
	type CapabilityExecutionContext,
	DOMAIN_PROJECT_CAPABILITIES,
	defineCapability,
	defineCapabilityModule,
	type FilesystemPathInput,
	type FilesystemReadFileResult,
	FOUNDATION_FILESYSTEM_CAPABILITIES,
} from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { bindCapability } from "../src/provider.js";
import { CAPABILITY_MODULE_TRUST_LEVELS, CapabilityRegistry } from "../src/registry.js";

const TEST_CAPABILITY = FOUNDATION_FILESYSTEM_CAPABILITIES.READ_FILE;
const TEST_CAPABILITY_VERSION_2 = defineCapability<FilesystemPathInput, FilesystemReadFileResult>({
	id: TEST_CAPABILITY.id,
	kind: TEST_CAPABILITY.kind,
	layer: TEST_CAPABILITY.layer,
	version: 2,
	input: TEST_CAPABILITY.input,
	output: TEST_CAPABILITY.output,
});

function context(): CapabilityExecutionContext {
	return { signal: new AbortController().signal, traceId: "test" };
}

describe("CapabilityRegistry", () => {
	it("supports more than ten concurrent invocations without listener warnings", async () => {
		const warnings: Error[] = [];
		const onWarning = (warning: Error): void => {
			if (warning.name === "MaxListenersExceededWarning" && warning.message.includes("abort listeners")) {
				warnings.push(warning);
			}
		};
		process.on("warning", onWarning);

		const registry = new CapabilityRegistry(CAPABILITY_LAYERS.FOUNDATION);
		const registration = registry.registerOwner("owner", [
			bindCapability(TEST_CAPABILITY, {
				execute: (_input, executionContext) =>
					new Promise<FilesystemReadFileResult>((_resolve, reject) => {
						executionContext.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
					}),
			}),
		]);
		const invocations = Array.from({ length: 11 }, (_, index) =>
			registry.invoke(TEST_CAPABILITY, { path: `value-${index}` }, context()),
		);

		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			registration.dispose();
			await Promise.allSettled(invocations);
			await new Promise<void>((resolve) => setImmediate(resolve));
		} finally {
			process.off("warning", onWarning);
			registration.dispose();
		}

		expect(warnings).toEqual([]);
	});

	it("keeps the previous provider when replacement validation fails", async () => {
		const registry = new CapabilityRegistry(CAPABILITY_LAYERS.FOUNDATION);
		registry.registerOwner("owner", [
			bindCapability(TEST_CAPABILITY, {
				execute: ({ path }) => ({
					content: `old:${path}`,
					encoding: "utf8",
				}),
			}),
		]);

		expect(() =>
			registry.registerOwner("owner", [
				bindCapability(DOMAIN_PROJECT_CAPABILITIES.LIST, {
					execute: () => ({
						workspacePath: "C:/workspace",
						projects: [],
						archivedProjects: [],
					}),
				}),
			]),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.LAYER_MISMATCH }));
		await expect(registry.invoke(TEST_CAPABILITY, { path: "value" }, context())).resolves.toEqual({
			content: "old:value",
			encoding: "utf8",
		});
	});

	it("aborts in-flight invocations when an owner is replaced", async () => {
		const registry = new CapabilityRegistry(CAPABILITY_LAYERS.FOUNDATION);
		registry.registerOwner("owner", [
			bindCapability(TEST_CAPABILITY, {
				execute: (_input, executionContext) =>
					new Promise<FilesystemReadFileResult>((_resolve, reject) => {
						executionContext.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
					}),
			}),
		]);
		const invocation = registry.invoke(TEST_CAPABILITY, { path: "value" }, context());

		registry.registerOwner("owner", [
			bindCapability(TEST_CAPABILITY, {
				execute: ({ path }) => ({
					content: `new:${path}`,
					encoding: "utf8",
				}),
			}),
		]);

		await expect(invocation).rejects.toMatchObject({ code: CAPABILITY_ERROR_CODES.ABORTED });
		await expect(registry.invoke(TEST_CAPABILITY, { path: "value" }, context())).resolves.toEqual({
			content: "new:value",
			encoding: "utf8",
		});
	});

	it("aborts in-flight invocations when a registration is disposed", async () => {
		const registry = new CapabilityRegistry(CAPABILITY_LAYERS.FOUNDATION);
		const registration = registry.registerOwner("owner", [
			bindCapability(TEST_CAPABILITY, {
				execute: (_input, executionContext) =>
					new Promise<FilesystemReadFileResult>((_resolve, reject) => {
						executionContext.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
					}),
			}),
		]);
		const invocation = registry.invoke(TEST_CAPABILITY, { path: "value" }, context());

		registration.dispose();

		await expect(invocation).rejects.toMatchObject({ code: CAPABILITY_ERROR_CODES.ABORTED });
		expect(registry.has(TEST_CAPABILITY.id)).toBe(false);
	});

	it("enforces module publisher trust and exact bindings before replacing providers", async () => {
		const registry = new CapabilityRegistry(CAPABILITY_LAYERS.FOUNDATION);
		const module = defineCapabilityModule({
			id: "filesystem",
			publisher: "vetta",
			version: "1.0.0",
			capabilities: [TEST_CAPABILITY],
		});
		const oldBinding = bindCapability(TEST_CAPABILITY, {
			execute: ({ path }) => ({ content: `old:${path}`, encoding: "utf8" as const }),
		});

		expect(() => registry.registerModule(module, [oldBinding])).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.RESERVED_PUBLISHER }),
		);
		registry.registerModule(module, [oldBinding], { trust: CAPABILITY_MODULE_TRUST_LEVELS.BUILT_IN });

		expect(() =>
			registry.registerModule(module, [], { trust: CAPABILITY_MODULE_TRUST_LEVELS.BUILT_IN }),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_MODULE }));
		await expect(registry.invoke(TEST_CAPABILITY, { path: "value" }, context())).resolves.toEqual({
			content: "old:value",
			encoding: "utf8",
		});
	});

	it("rejects invocation contract version mismatches", async () => {
		const registry = new CapabilityRegistry(CAPABILITY_LAYERS.FOUNDATION);
		registry.registerOwner("owner", [
			bindCapability(TEST_CAPABILITY, {
				execute: ({ path }) => ({ content: path, encoding: "utf8" }),
			}),
		]);

		await expect(registry.invoke(TEST_CAPABILITY_VERSION_2, { path: "value" }, context())).rejects.toMatchObject({
			code: CAPABILITY_ERROR_CODES.VERSION_MISMATCH,
		});
	});
});
