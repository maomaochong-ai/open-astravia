import { REMOTE_MAX_ACTION_RESULT_CHARS } from "@vetta/remote-control";
import { describe, expect, it, vi } from "vitest";
import { type ActionDefinition, ActionError, type JsonValue } from "../app-actions/types.js";
import { type RemoteActionHost, runRemoteAction } from "./remote-actions.js";

function host(
	definitions: Record<string, Partial<ActionDefinition>>,
	run = vi.fn(async (): Promise<JsonValue> => ({ ok: true })),
) {
	const value: RemoteActionHost = {
		get: (actionId) => {
			const definition = definitions[actionId];
			if (!definition) throw new ActionError("ACTION_NOT_FOUND", `Action not found: ${actionId}`);
			return definition as ActionDefinition;
		},
		run,
	};
	return { host: value, run };
}

describe("runRemoteAction", () => {
	it("runs an action a plugin offered to phones, marked as coming from remote control", async () => {
		const { host: actions, run } = host({ "plugin.jsk-map.scene-geometry": { remote: true } });
		await expect(
			runRemoteAction(actions, { actionId: "plugin.jsk-map.scene-geometry", input: { scene: { kind: "focus" } } }),
		).resolves.toEqual({ result: { ok: true } });
		expect(run).toHaveBeenCalledWith(
			"plugin.jsk-map.scene-geometry",
			{ scene: { kind: "focus" } },
			{ source: "remote-control" },
		);
	});

	it("answers not_found alike for unknown actions and ones not offered to phones", async () => {
		const { host: actions, run } = host({
			"plugin.a.local": { remote: false },
			"plugin.a.write": { remote: true, requiresApproval: () => true },
		});
		for (const actionId of ["plugin.a.local", "plugin.a.write", "plugin.a.missing"]) {
			await expect(runRemoteAction(actions, { actionId })).rejects.toMatchObject({
				code: "not_found",
				message: "Action is not offered to phones",
			});
		}
		expect(run).not.toHaveBeenCalled();
	});

	it("maps schema, readiness and plugin failures without leaking plugin messages", async () => {
		const fail = (error: Error) =>
			host(
				{ "plugin.a.read": { remote: true } },
				vi.fn(async (): Promise<JsonValue> => Promise.reject(error)),
			);
		const cases: Array<[Error, string]> = [
			[new ActionError("ACTION_INVALID_INPUT", "bad"), "invalid_frame"],
			[new ActionError("PLUGIN_ACTION_UNAVAILABLE", "renderer gone"), "busy"],
			[new ActionError("PLUGIN_ACTION_TIMEOUT", "slow"), "request_timeout"],
			[new ActionError("JSK_SECRET", "token=abc"), "internal_error"],
		];
		for (const [error, code] of cases) {
			const rejection = runRemoteAction(fail(error).host, { actionId: "plugin.a.read" });
			await expect(rejection).rejects.toMatchObject({ code });
			await expect(rejection).rejects.not.toMatchObject({ message: expect.stringContaining("token") });
		}
	});

	it("requires an action id and refuses results too large for a sealed frame", async () => {
		const { host: actions } = host(
			{ "plugin.a.read": { remote: true } },
			vi.fn(async (): Promise<JsonValue> => "x".repeat(REMOTE_MAX_ACTION_RESULT_CHARS)),
		);
		await expect(runRemoteAction(actions, {})).rejects.toMatchObject({ code: "invalid_frame" });
		await expect(runRemoteAction(actions, { actionId: "plugin.a.read" })).rejects.toMatchObject({
			code: "too_large",
		});
	});
});
