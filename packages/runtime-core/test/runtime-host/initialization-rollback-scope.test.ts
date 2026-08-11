import { describe, expect, it, vi } from "vitest";
import { InitializationRollbackScope } from "../../src/runtime-host/initialization-rollback-scope.js";

describe("InitializationRollbackScope", () => {
	it("rolls active acquisitions back in reverse order and preserves the initialization failure", async () => {
		const initializationError = new Error("initialization failed");
		const cleanupError = new Error("second cleanup failed");
		const order: string[] = [];
		const scope = new InitializationRollbackScope();
		scope.defer({
			id: "first",
			rollback: () => {
				order.push("first");
			},
		});
		scope.defer({
			id: "second",
			rollback: vi.fn(async () => {
				order.push("second");
				throw cleanupError;
			}),
		});
		scope.defer({
			id: "third",
			rollback: () => {
				order.push("third");
			},
		});
		scope.defer({
			id: "not-acquired",
			rollback: () => {
				order.push("not-acquired");
			},
		})();

		let caught: unknown;
		try {
			await scope.rollback(initializationError, "initialization and rollback failed");
		} catch (error) {
			caught = error;
		}

		expect(order).toEqual(["third", "second", "first"]);
		expect(caught).toBeInstanceOf(AggregateError);
		expect(caught).toMatchObject({
			message: "initialization and rollback failed",
			cause: initializationError,
			errors: [initializationError, cleanupError],
		});
	});

	it("rethrows the original failure unchanged when rollback succeeds", async () => {
		const initializationError = new Error("initialization failed");
		const scope = new InitializationRollbackScope();
		scope.defer({ id: "resource", rollback: vi.fn() });

		await expect(scope.rollback(initializationError, "unused message")).rejects.toBe(initializationError);
	});
});
