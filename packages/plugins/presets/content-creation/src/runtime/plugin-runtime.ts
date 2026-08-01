import type { PluginContext } from "@vetta-org/plugin-sdk";
import { PluginContentProjectRepository } from "./project-repository";
import { ContentCreationWorkspace } from "./workspace";

let workspace: ContentCreationWorkspace | null = null;
let notify: PluginContext["ui"]["notify"] | null = null;

export function initializePluginRuntime(ctx: PluginContext): ContentCreationWorkspace {
	workspace = new ContentCreationWorkspace(new PluginContentProjectRepository(ctx.fs, ctx.storage));
	notify = ctx.ui.notify;
	return workspace;
}

export function getContentCreationWorkspace(): ContentCreationWorkspace {
	if (!workspace) throw new Error("content-creation runtime is not initialized");
	return workspace;
}

export function notifyContentCreationError(message: string, error: unknown): void {
	notify?.({ message, error });
}
