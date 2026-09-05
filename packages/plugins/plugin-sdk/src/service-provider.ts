import type { Disposable } from "./disposable.js";

export type PluginServicePhase =
	| "disabled"
	| "installing"
	| "starting"
	| "ready"
	| "stopping"
	| "stopped"
	| "failed";

export interface PluginServiceStatus {
	serviceId: string;
	phase: PluginServicePhase;
	version: string;
	installed: boolean;
	message?: string;
	recentOutput: string;
}

export interface PluginServiceConnection {
	baseUrl: string;
	/** Present only when the caller explicitly names a credential declared by its own service. */
	credential?: string;
}

export interface PluginServiceHostPlatform {
	tag: `${"win32" | "darwin" | "linux"}-${"x64" | "arm64"}`;
}

export interface PluginServiceArtifactPayload {
	/** Must match one destination declared for the current platform in plugin.json. */
	destination: string;
	/** Base64-encoded archive bytes downloaded and verified by the plugin. */
	data: string;
}

export interface PluginServiceRequest {
	/** Root-relative path on this plugin-owned loopback service. Absolute URLs are rejected. */
	path: string;
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	credentialId?: string;
	headers?: Record<string, string>;
	body?: unknown;
	responseType?: "json" | "text";
	timeoutMs?: number;
}

export interface PluginServiceResponse<T = unknown> {
	ok: boolean;
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: T;
}

export interface PluginServiceApi {
	/** Host platform used by the plugin to select its own runtime download. */
	getPlatform(): Promise<PluginServiceHostPlatform>;
	getStatus(serviceId: string): Promise<PluginServiceStatus>;
	/** Atomically deploy plugin-downloaded artifacts after host-side safety verification. */
	install(serviceId: string, artifacts: PluginServiceArtifactPayload[]): Promise<PluginServiceStatus>;
	start(serviceId: string): Promise<PluginServiceStatus>;
	stop(serviceId: string): Promise<PluginServiceStatus>;
	restart(serviceId: string): Promise<PluginServiceStatus>;
	connection(serviceId: string, credentialId?: string): Promise<PluginServiceConnection>;
	request<T = unknown>(serviceId: string, request: PluginServiceRequest): Promise<PluginServiceResponse<T>>;
	/** Report semantic readiness after the service's domain data has finished loading. */
	reportReady(serviceId: string, ready: boolean): Promise<PluginServiceStatus>;
	onStatusChange(listener: (status: PluginServiceStatus) => void): Disposable;
}
