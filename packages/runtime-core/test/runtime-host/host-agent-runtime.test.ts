import type { RuntimeHostSessionBackend, RuntimeObservationRecord } from "@vetta/runtime-core";
import { RUNTIME_HOST_LIFECYCLE_OBSERVATION, RuntimeHost } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";

describe("RuntimeHost Agent runtime ownership", () => {
	it("provides one built-in Agent control plane to its owned backend and closes both", async () => {
		const disposeBackend = vi.fn(async () => {});
		const closeObservationPort = vi.fn(async () => {});
		const records: RuntimeObservationRecord[] = [];
		const backend: RuntimeHostSessionBackend = {
			createAssembly: vi.fn(async () => {
				throw new Error("not used");
			}),
			dispose: disposeBackend,
		};
		let factoryAgents: RuntimeHost["agents"] | undefined;
		const host = new RuntimeHost({
			observationPort: {
				record: (record) => {
					records.push(record);
				},
				close: closeObservationPort,
			},
			createSessionBackend: ({ agents }) => {
				factoryAgents = agents;
				return backend;
			},
		});

		expect(factoryAgents).toBe(host.agents);
		expect(host.agents.snapshot().closed).toBe(false);

		await host.close();

		expect(disposeBackend).toHaveBeenCalledOnce();
		expect(closeObservationPort).toHaveBeenCalledOnce();
		expect(host.agents.snapshot().closed).toBe(true);
		expect(
			records
				.filter((record) => record.token.id === RUNTIME_HOST_LIFECYCLE_OBSERVATION.id)
				.map((record) => record.payload),
		).toEqual([
			{ operation: "host.close", phase: "started" },
			{ operation: "host.close", phase: "completed" },
		]);
		await expect(host.createSession()).rejects.toThrow("RuntimeHost is closed");
	});

	it("reports owned resource cleanup failures and retries from the failed ownership phase", async () => {
		const records: RuntimeObservationRecord[] = [];
		const closeObservationPort = vi.fn(async () => {});
		const backendFailure = Object.assign(new Error("private backend details"), { code: "E_BACKEND_CLOSE" });
		const disposeBackend = vi.fn().mockRejectedValueOnce(backendFailure).mockResolvedValueOnce(undefined);
		const host = new RuntimeHost({
			observationPort: {
				record: (record) => {
					records.push(record);
				},
				close: closeObservationPort,
			},
			createSessionBackend: () => ({
				createAssembly: vi.fn(async () => {
					throw new Error("not used");
				}),
				dispose: disposeBackend,
			}),
		});

		await expect(host.close()).rejects.toThrow("Failed to close RuntimeHost resources");

		expect(host.agents.snapshot().closed).toBe(false);
		expect(closeObservationPort).not.toHaveBeenCalled();
		expect(
			records
				.filter((record) => record.token.id === RUNTIME_HOST_LIFECYCLE_OBSERVATION.id)
				.map((record) => record.payload),
		).toEqual([
			{ operation: "host.close", phase: "started" },
			{
				operation: "host.close",
				phase: "failed",
				component: "session-backend",
				failure: { category: "error", errorName: "Error", errorCode: "E_BACKEND_CLOSE" },
			},
		]);
		expect(JSON.stringify(records)).not.toContain("private backend details");

		await host.close();
		expect(disposeBackend).toHaveBeenCalledTimes(2);
		expect(host.agents.snapshot().closed).toBe(true);
		expect(closeObservationPort).toHaveBeenCalledOnce();
	});

	it("rejects ambiguous backend and observation ownership", () => {
		const backend: RuntimeHostSessionBackend = {
			createAssembly: vi.fn(async () => {
				throw new Error("not used");
			}),
		};
		expect(
			() =>
				new RuntimeHost({
					sessionBackend: backend,
					createSessionBackend: () => backend,
				}),
		).toThrow("either sessionBackend or createSessionBackend");
		expect(
			() =>
				new RuntimeHost({
					observationPort: { record: vi.fn() },
					observationPublisher: {
						record: vi.fn(),
						forward: vi.fn(),
						scope: vi.fn(),
						flush: vi.fn(async () => {}),
					},
				}),
		).toThrow("either observationPort or observationPublisher");
	});
});
