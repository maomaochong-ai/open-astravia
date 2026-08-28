export interface RendererStartupOptions<T> {
	resetDevelopmentCache?: () => Promise<void>;
	startRenderer: () => T;
}

/**
 * Keep development cache invalidation ahead of every renderer network request.
 * Electron's session.clearCache() can interrupt in-flight Chromium requests,
 * which leaves the Vite module graph incomplete with ERR_NETWORK_CHANGED.
 */
export async function startRendererAfterSessionPreparation<T>(options: RendererStartupOptions<T>): Promise<T> {
	await options.resetDevelopmentCache?.();
	return options.startRenderer();
}
