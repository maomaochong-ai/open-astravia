export interface HttpProxySupport {
	install(): void;
}

/** Loads and installs optional proxy support without leaking loader failures. */
export async function setupHttpProxy(
	load: () => Promise<HttpProxySupport>,
	warn: (message: string) => void = (message) => console.warn(message),
): Promise<void> {
	try {
		const support = await load();
		support.install();
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		warn(`[ai] HTTP proxy support disabled: failed to load undici (${reason})`);
	}
}
