import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createJiti } from "@mariozechner/jiti";

export interface NodeDynamicModuleLoaderOptions {
	readonly aliases?: Readonly<Record<string, string>>;
	readonly virtualModules?: Readonly<Record<string, unknown>>;
}

export interface NodeDynamicModuleLoader {
	importDefault(modulePath: string): Promise<unknown>;
}

/** Creates an uncached Node module loader that can execute JavaScript and TypeScript modules. */
export function createNodeDynamicModuleLoader(
	baseUrl: string,
	options: NodeDynamicModuleLoaderOptions = {},
): NodeDynamicModuleLoader {
	return {
		async importDefault(modulePath) {
			const loader = createJiti(baseUrl, {
				moduleCache: false,
				tryNative: false,
				...(options.aliases ? { alias: { ...options.aliases } } : {}),
				...(options.virtualModules ? { virtualModules: { ...options.virtualModules } } : {}),
			});
			const loaded: unknown = await loader.import(modulePath, { default: true });
			return loaded;
		},
	};
}

export function resolveNodeModuleSpecifier(specifier: string, baseUrl: string): string {
	return createRequire(baseUrl).resolve(specifier);
}

export function nodeFileUrlToPath(url: URL): string {
	return fileURLToPath(url);
}
