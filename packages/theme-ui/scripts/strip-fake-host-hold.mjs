/**
 * Remove fake host_primitive_hold markers:
 *   import type { Button } from ".../button";
 *   type HostButton = typeof Button;
 *   export type { HostButton as _HostPrimitiveHoldButton };
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rendererRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../apps/desktop/src/renderer",
);

function walk(dir, acc = []) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === "__tests__") continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, acc);
		else if (p.endsWith(".tsx")) acc.push(p);
	}
	return acc;
}

let stripped = 0;
for (const file of walk(rendererRoot)) {
	const text = readFileSync(file, "utf8");
	if (!text.includes("_HostPrimitiveHold") && !text.includes("HostButton = typeof Button")) continue;

	const lines = text.split(/\r?\n/);
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/import\s+type\s+\{\s*Button\s*\}\s+from\s+["']@shared\/components\/ui\/button["']/.test(line)) {
			// drop following marker lines
			if (i + 1 < lines.length && /type\s+HostButton\s*=\s*typeof\s+Button/.test(lines[i + 1])) i++;
			if (i + 1 < lines.length && /_HostPrimitiveHoldButton/.test(lines[i + 1])) i++;
			continue;
		}
		if (/_HostPrimitiveHold/.test(line)) continue;
		if (/^\s*type\s+HostButton\s*=\s*typeof\s+Button\s*;?\s*$/.test(line)) continue;
		out.push(line);
	}
	const next = out.join("\n");
	if (next !== text) {
		writeFileSync(file, next.endsWith("\n") ? next : `${next}\n`);
		stripped++;
		console.log("stripped", path.relative(process.cwd(), file).replace(/\\/g, "/"));
	}
}
console.log(`done stripped=${stripped}`);
