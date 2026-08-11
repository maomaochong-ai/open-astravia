import type {
	EventBus,
	Extension,
	ExtensionFactory,
	ExtensionRuntime,
	LoadExtensionsResult,
} from "../../extensions/index.js";
import { loadExtensionFromFactory, loadExtensions } from "../../extensions/index.js";

export async function loadExtensionResources(options: {
	paths: string[];
	cwd: string;
	eventBus: EventBus;
	factories: ExtensionFactory[];
}): Promise<LoadExtensionsResult> {
	const result = await loadExtensions(options.paths, options.cwd, options.eventBus);
	const inline = await loadExtensionFactories(options.factories, options.cwd, options.eventBus, result.runtime);
	result.extensions.push(...inline.extensions);
	result.errors.push(...inline.errors, ...detectExtensionConflicts(result.extensions));
	return result;
}

async function loadExtensionFactories(
	factories: ExtensionFactory[],
	cwd: string,
	eventBus: EventBus,
	runtime: ExtensionRuntime,
): Promise<{ extensions: Extension[]; errors: Array<{ path: string; error: string }> }> {
	const extensions: Extension[] = [];
	const errors: Array<{ path: string; error: string }> = [];
	for (const [index, factory] of factories.entries()) {
		const path = `<inline:${index + 1}>`;
		try {
			extensions.push(await loadExtensionFromFactory(factory, cwd, eventBus, runtime, path));
		} catch (error) {
			errors.push({ path, error: error instanceof Error ? error.message : "failed to load extension" });
		}
	}
	return { extensions, errors };
}

function detectExtensionConflicts(extensions: Extension[]): Array<{ path: string; error: string }> {
	const conflicts: Array<{ path: string; error: string }> = [];
	const toolOwners = new Map<string, string>();
	const commandOwners = new Map<string, string>();
	const flagOwners = new Map<string, string>();
	const check = (name: string, owner: string, owners: Map<string, string>, label: string): void => {
		const existing = owners.get(name);
		if (existing && existing !== owner)
			conflicts.push({ path: owner, error: `${label} "${name}" conflicts with ${existing}` });
		else owners.set(name, owner);
	};
	for (const extension of extensions) {
		for (const name of extension.tools.keys()) check(name, extension.path, toolOwners, "Tool");
		for (const name of extension.commands.keys()) check(`/${name}`, extension.path, commandOwners, "Command");
		for (const name of extension.flags.keys()) check(`--${name}`, extension.path, flagOwners, "Flag");
	}
	return conflicts;
}
