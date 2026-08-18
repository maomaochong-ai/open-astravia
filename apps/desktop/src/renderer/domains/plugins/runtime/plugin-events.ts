export const PLUGINS_CHANGED_EVENT = "vetta:plugins-changed";

let resolvePluginHostReady: (() => void) | undefined;
let pluginHostReadyPromise = new Promise<void>((resolve) => {
	resolvePluginHostReady = resolve;
});

function debugPluginAgent(message: string, data?: Record<string, unknown>): void {
	console.info(`[plugin-agent] ${message}${data ? ` ${JSON.stringify(data)}` : ""}`);
}

export function notifyPluginsChanged(): void {
	window.dispatchEvent(new Event(PLUGINS_CHANGED_EVENT));
}

export function markPluginHostLoading(): void {
	debugPluginAgent("host loading");
	pluginHostReadyPromise = new Promise<void>((resolve) => {
		resolvePluginHostReady = resolve;
	});
}

export function markPluginHostReady(): void {
	debugPluginAgent("host ready");
	resolvePluginHostReady?.();
	resolvePluginHostReady = undefined;
}

export async function waitForPluginHostReady(timeoutMs = 5000): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;
	debugPluginAgent("wait host ready start", { timeoutMs });
	try {
		await Promise.race([
			pluginHostReadyPromise,
			new Promise<void>((resolve) => {
				timeout = setTimeout(() => {
					timedOut = true;
					resolve();
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
		debugPluginAgent("wait host ready end", { timedOut });
	}
}
