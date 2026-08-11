import { describe, expect, it, vi } from "vitest";
import { RuntimeSessionHostInteractionBroker } from "../../src/index.js";

describe("RuntimeSessionHostInteractionBroker", () => {
	it("fails closed before binding and honors an already-aborted confirmation", async () => {
		const broker = new RuntimeSessionHostInteractionBroker();
		const controller = new AbortController();
		controller.abort();

		await expect(broker.confirm("title", "message")).resolves.toBe(false);
		await expect(broker.confirm("title", "message", controller.signal)).resolves.toBe(false);
		await expect(
			broker.requestSandboxGrant({
				title: "grant",
				message: "message",
				toolName: "read",
				capability: "file.read",
				target: "outside.txt",
				resolvedTarget: "C:/outside.txt",
				sensitive: false,
			}),
		).resolves.toBe("deny");
	});

	it("routes every request through the latest binding", async () => {
		const firstConfirm = vi.fn(async () => true);
		const secondConfirm = vi.fn(async () => false);
		const broker = new RuntimeSessionHostInteractionBroker();
		await broker.bind({
			confirm: firstConfirm,
			requestSandboxGrant: async () => "allow_once",
		});

		await expect(broker.confirm("first", "message")).resolves.toBe(true);

		await broker.bind({
			confirm: secondConfirm,
			requestSandboxGrant: async () => "allow_session",
		});

		await expect(broker.confirm("second", "message")).resolves.toBe(false);
		await expect(
			broker.requestSandboxGrant({
				title: "grant",
				message: "message",
				toolName: "write",
				capability: "file.write",
				target: "outside.txt",
				resolvedTarget: "C:/outside.txt",
				sensitive: false,
			}),
		).resolves.toBe("allow_session");
		expect(firstConfirm).toHaveBeenCalledOnce();
		expect(secondConfirm).toHaveBeenCalledOnce();
	});
});
