/// <reference lib="webworker" />

import { getQuickJS, type QuickJSContext } from "quickjs-emscripten";
import { QUICKJS_PLUGIN_BOOTSTRAP } from "./quickjs-plugin-bootstrap";
import type { QuickJsWorkerInboundMessage, QuickJsWorkerOutboundMessage } from "./quickjs-plugin-protocol";

const workerScope = self as DedicatedWorkerGlobalScope;
const MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;
const STACK_LIMIT_BYTES = 512 * 1024;
const EXECUTION_LIMIT_MS = 1_000;
const MAX_PENDING_JOBS = 100;

let context: QuickJSContext | undefined;
let disposed = false;

function post(message: QuickJsWorkerOutboundMessage): void {
	workerScope.postMessage(message);
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.stack?.trim() || error.message;
	return String(error);
}

function evaluate(code: string, filename: string): void {
	if (!context) throw new Error("QuickJS context is not initialized");
	const deadline = Date.now() + EXECUTION_LIMIT_MS;
	context.runtime.setInterruptHandler(() => Date.now() > deadline);
	const result = context.evalCode(code, filename, { type: "global" });
	try {
		if (result.error) throw new Error(errorMessage(context.dump(result.error)));
	} finally {
		if (result.error) result.error.dispose();
		else result.value.dispose();
		context.runtime.removeInterruptHandler();
	}
}

function runPendingJobs(): void {
	if (!context) return;
	const deadline = Date.now() + EXECUTION_LIMIT_MS;
	context.runtime.setInterruptHandler(() => Date.now() > deadline);
	try {
		const result = context.runtime.executePendingJobs(MAX_PENDING_JOBS);
		if (result.error) {
			const message = errorMessage(context.dump(result.error));
			result.error.dispose();
			throw new Error(message);
		}
	} finally {
		context.runtime.removeInterruptHandler();
	}
}

function jsonCall(name: string, ...args: unknown[]): void {
	evaluate(`${name}(...${JSON.stringify(args)})`, `vetta:${name}`);
	runPendingJobs();
}

async function initialize(message: Extract<QuickJsWorkerInboundMessage, { type: "initialize" }>): Promise<void> {
	if (context) throw new Error("QuickJS worker is already initialized");
	const QuickJS = await getQuickJS();
	if (disposed) return;
	context = QuickJS.newContext();
	context.runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
	context.runtime.setMaxStackSize(STACK_LIMIT_BYTES);
	const emitHandle = context.newFunction("__vettaHostEmit", (payloadHandle) => {
		try {
			const payload = JSON.parse(context?.getString(payloadHandle) ?? "null") as QuickJsWorkerOutboundMessage;
			post(payload);
		} catch (error) {
			post({ type: "error", message: `QuickJS bridge message failed: ${errorMessage(error)}` });
		}
		return context?.undefined;
	});
	context.setProp(context.global, "__vettaHostEmit", emitHandle);
	emitHandle.dispose();
	evaluate(QUICKJS_PLUGIN_BOOTSTRAP, "vetta:bootstrap");
	jsonCall("__vettaInitialize", {
		plugin: message.plugin,
		permissions: message.permissions,
		settings: message.settings,
		locale: message.locale,
	});
	evaluate(message.code, message.filename);
	evaluate("__vettaRunActivate()", "vetta:activate");
	runPendingJobs();
	post({ type: "ready" });
}

function disposeContext(): void {
	if (disposed) return;
	disposed = true;
	if (!context) return;
	try {
		evaluate("__vettaRunDeactivate()", "vetta:deactivate");
		runPendingJobs();
	} catch (error) {
		post({ type: "error", message: errorMessage(error) });
	} finally {
		context.dispose();
		context = undefined;
	}
}

workerScope.onmessage = (event: MessageEvent<QuickJsWorkerInboundMessage>): void => {
	const message = event.data;
	void (async () => {
		try {
			switch (message.type) {
				case "initialize":
					await initialize(message);
					break;
				case "action":
					jsonCall("__vettaDispatchAction", message.event);
					break;
				case "hostResponse":
					jsonCall("__vettaResolveHostCall", message.callId, message.ok, message.value);
					break;
				case "settingsChanged":
					jsonCall("__vettaSettingsChanged", message.values);
					break;
				case "localeChanged":
					jsonCall("__vettaLocaleChanged", message.locale);
					break;
				case "dispose":
					disposeContext();
					post({ type: "disposed" });
					workerScope.close();
					break;
			}
		} catch (error) {
			post({ type: "error", message: errorMessage(error) });
		}
	})();
};
