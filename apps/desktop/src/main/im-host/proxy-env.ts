/**
 * Proxy configuration for the im-gateway sidecar.
 *
 * The sidecar is a Go process: its HTTP client honours the HTTPS_PROXY /
 * HTTP_PROXY / NO_PROXY environment variables and nothing else. It does not
 * read the macOS or Windows system proxy settings. Electron/Chromium does,
 * so on a machine where a proxy is configured system-wide but not exported
 * into the environment, Vetta itself reaches the network while the sidecar
 * dials direct and fails — Discord surfaces this as
 * `Get "https://discord.com/api/v9/gateway": EOF` (the TLS handshake being
 * reset), and every other channel behind the same proxy fails likewise.
 *
 * We therefore ask Electron to resolve the proxy the way the rest of the app
 * would, and hand the result to the sidecar as environment variables.
 *
 * Limitation: the env vars apply to the whole sidecar process, so a PAC
 * script that returns different proxies per host cannot be represented
 * faithfully — the resolution for PROBE_URL is applied to all outbound
 * traffic. That matches how the system proxy behaves in the common
 * (non-PAC) case.
 */

/** Env var names Go's http.ProxyFromEnvironment consults, in both casings. */
const PROXY_ENV_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

/**
 * Representative public HTTPS endpoint used to ask Electron "what proxy
 * would you use to reach the internet?". Any public host answers the same
 * way outside of PAC setups; the sidecar's own targets (Discord, Telegram,
 * Slack, Feishu, …) are all public HTTPS endpoints.
 */
const PROBE_URL = "https://discord.com";

/** Hosts the sidecar must always reach directly. */
const NO_PROXY = "127.0.0.1,localhost,::1";

export interface SidecarProxyEnv {
	/** Environment variables to merge into the sidecar's env. Empty = none. */
	readonly env: Record<string, string>;
	/**
	 * Why the env looks the way it does. `inherited` means the parent
	 * process already carries an explicit proxy setting, which always wins
	 * over the system resolution.
	 */
	readonly source: "system" | "inherited" | "direct";
	/** Redacted proxy origin for logging; undefined when going direct. */
	readonly proxy?: string;
}

/**
 * Translate one PAC-style resolution string (Electron's
 * `session.resolveProxy` output) into a proxy URL Go understands.
 *
 * Accepts the entries PAC can return — `DIRECT`, `PROXY host:port`,
 * `HTTPS host:port`, `SOCKS`/`SOCKS5 host:port` — and walks a
 * semicolon-separated fallback list, skipping entries Go cannot use
 * (notably SOCKS4). Returns undefined when the result means "go direct".
 */
export function proxyUrlFromPacResult(pacResult: string): string | undefined {
	for (const rawEntry of pacResult.split(";")) {
		const entry = rawEntry.trim();
		if (entry === "" || entry.toUpperCase() === "DIRECT") continue;

		const match = /^(\S+)\s+(\S+)$/.exec(entry);
		if (!match) continue;
		const [, keyword, hostPort] = match;
		if (hostPort === undefined || keyword === undefined) continue;

		switch (keyword.toUpperCase()) {
			case "PROXY":
				return `http://${hostPort}`;
			case "HTTPS":
				return `https://${hostPort}`;
			// Go's ProxyFromEnvironment dials socks5 itself; socks4 has no
			// support, so fall through to the next PAC entry instead.
			case "SOCKS":
			case "SOCKS5":
				return `socks5://${hostPort}`;
			default:
				continue;
		}
	}
	return undefined;
}

/** Whether the parent process already carries an explicit proxy setting. */
export function hasExplicitProxyEnv(env: NodeJS.ProcessEnv): boolean {
	return PROXY_ENV_KEYS.some((key) => (env[key] ?? "").trim() !== "");
}

/**
 * Build the proxy environment for the sidecar.
 *
 * An explicit proxy already present in the parent environment is left
 * alone: the sidecar inherits it, and silently overriding a deliberate
 * setting would be worse than doing nothing.
 */
export async function resolveSidecarProxyEnv(
	resolveProxy: (url: string) => Promise<string>,
	env: NodeJS.ProcessEnv = process.env,
): Promise<SidecarProxyEnv> {
	if (hasExplicitProxyEnv(env)) {
		return { env: {}, source: "inherited" };
	}

	let pacResult: string;
	try {
		pacResult = await resolveProxy(PROBE_URL);
	} catch {
		// Proxy resolution is best effort: failing it must not stop the
		// bridge from starting.
		return { env: {}, source: "direct" };
	}

	const proxyUrl = proxyUrlFromPacResult(pacResult);
	if (proxyUrl === undefined) {
		return { env: {}, source: "direct" };
	}

	return {
		env: {
			HTTPS_PROXY: proxyUrl,
			HTTP_PROXY: proxyUrl,
			NO_PROXY,
		},
		source: "system",
		proxy: proxyUrl,
	};
}

/**
 * Default resolver backed by Electron's own proxy resolution, so the
 * sidecar follows exactly what Chromium would do. Imported lazily to keep
 * this module loadable in tests without an Electron runtime.
 */
export async function electronProxyResolver(url: string): Promise<string> {
	const { session } = await import("electron");
	return session.defaultSession.resolveProxy(url);
}
