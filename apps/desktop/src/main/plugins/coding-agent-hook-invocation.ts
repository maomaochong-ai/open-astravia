import type { PluginCodingAgentHookEvent } from "@vetta-org/plugin-sdk";
import type { DesktopPluginHookBinding } from "./coding-agent-hook-registry.js";

export interface DesktopPluginHookInvocation {
	readonly pluginId: string;
	readonly hookId: string;
	readonly handlerId: string;
	readonly activationId?: string;
	readonly session: { readonly id: string; readonly cwd: string; readonly scenario: string };
	readonly event: PluginCodingAgentHookEvent;
}

export type DesktopPluginHookInvoker = (
	invocation: DesktopPluginHookInvocation,
	signal?: AbortSignal,
) => Promise<unknown>;

let currentInvoker: DesktopPluginHookInvoker | undefined;

export function setDesktopPluginHookInvoker(invoker: DesktopPluginHookInvoker | undefined): void {
	currentInvoker = invoker;
}

export async function invokeDesktopPluginHook(
	binding: DesktopPluginHookBinding,
	session: DesktopPluginHookInvocation["session"],
	event: PluginCodingAgentHookEvent,
	signal?: AbortSignal,
): Promise<unknown> {
	if (!currentInvoker) throw new Error("Desktop Plugin Hook renderer bridge is unavailable");
	const result = await currentInvoker(
		{
			pluginId: binding.pluginId,
			hookId: binding.id,
			handlerId: binding.handlerId,
			activationId: binding.activationId,
			session,
			event,
		},
		signal,
	);
	return result;
}
