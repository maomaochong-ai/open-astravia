import { createRequire } from "node:module";
import { join, sep } from "node:path";

const require = createRequire(import.meta.url);

export function resolveInstalledPackageRoot(dep, fromDir) {
	let entry;
	try {
		entry = require.resolve(dep, { paths: [fromDir] });
	} catch (entryError) {
		try {
			entry = require.resolve(`${dep}/package.json`, { paths: [fromDir] });
		} catch {
			throw entryError;
		}
	}

	const marker = `${join("node_modules", dep)}${sep}`;
	const idx = entry.lastIndexOf(marker);
	if (idx < 0) {
		throw new Error(`prepare-pack: cannot locate ${dep} package root in ${entry}`);
	}
	return entry.slice(0, idx + marker.length - 1);
}
