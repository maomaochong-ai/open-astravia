import { getQuickJS, type QuickJSContext } from "quickjs-emscripten";
import { afterEach, describe, expect, it } from "vitest";
import { QUICKJS_PLUGIN_BOOTSTRAP } from "./quickjs-plugin-bootstrap";
import type { QuickJsWorkerOutboundMessage } from "./quickjs-plugin-protocol";

let context: QuickJSContext | undefined;

function evaluate(code: string): void {
	if (!context) throw new Error("QuickJS test context is not initialized");
	const result = context.evalCode(code);
	if (result.error) {
		const error = context.dump(result.error);
		result.error.dispose();
		throw new Error(String(error));
	}
	result.value.dispose();
}

function runPendingJobs(): void {
	if (!context) throw new Error("QuickJS test context is not initialized");
	const result = context.runtime.executePendingJobs(100);
	if (result.error) {
		const error = context.dump(result.error);
		result.error.dispose();
		throw new Error(String(error));
	}
}

afterEach(() => {
	context?.dispose();
	context = undefined;
});

describe("QuickJS plugin bootstrap", () => {
	it("hides renderer globals and routes async capabilities through host calls", async () => {
		const QuickJS = await getQuickJS();
		context = QuickJS.newContext();
		const messages: QuickJsWorkerOutboundMessage[] = [];
		const emit = context.newFunction("__vettaHostEmit", (payload) => {
			messages.push(JSON.parse(context?.getString(payload) ?? "null") as QuickJsWorkerOutboundMessage);
			return context?.undefined;
		});
		context.setProp(context.global, "__vettaHostEmit", emit);
		emit.dispose();
		evaluate(QUICKJS_PLUGIN_BOOTSTRAP);
		evaluate(
			`__vettaInitialize(${JSON.stringify({
				plugin: { id: "probe", version: "1.0.0" },
				permissions: ["network.fetch"],
				settings: {},
				locale: "zh",
			})})`,
		);
		evaluate(`
			vetta.activate((ctx) => {
				ctx.ui.notify({
					message: JSON.stringify({
						window: typeof window,
						document: typeof document,
						fetch: typeof fetch,
						process: typeof process,
						require: typeof require,
					})
				});
				ctx.ui.registerActivityTab({
					id: "probe",
					label: "Probe",
					scope_use: ["project"],
					view: { type: "button", label: "Run", action: "run" },
				});
				ctx.ui.onAction("run", async () => {
					const response = await ctx.network.request({ url: "https://example.com" });
					ctx.ui.updateActivityTab("probe", { type: "text", text: String(response.status) });
				});
			});
		`);
		evaluate("__vettaRunActivate()");

		const notification = messages.find((message) => message.type === "notify");
		expect(notification).toMatchObject({
			type: "notify",
			options: {
				message: JSON.stringify({
					window: "undefined",
					document: "undefined",
					fetch: "undefined",
					process: "undefined",
					require: "undefined",
				}),
			},
		});

		evaluate('__vettaDispatchAction({ tabId: "probe", action: "run", kind: "press" })');
		runPendingJobs();
		const hostCall = messages.find((message) => message.type === "hostCall");
		expect(hostCall).toMatchObject({ type: "hostCall", method: "network.request" });
		if (!hostCall || hostCall.type !== "hostCall") throw new Error("Expected a QuickJS host call");

		evaluate(`__vettaResolveHostCall(${hostCall.callId}, true, { status: 204 })`);
		runPendingJobs();
		expect(messages).toContainEqual({
			type: "updateActivityTab",
			tabId: "probe",
			view: { type: "text", text: "204" },
		});
	});
});
