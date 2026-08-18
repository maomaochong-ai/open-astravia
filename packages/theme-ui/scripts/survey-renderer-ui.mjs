/**
 * Survey renderer .tsx beyond gate open buckets — residual work map.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const rendererRoot = path.join(repoRoot, "apps/desktop-app/src/renderer");
const deferralsPath = path.join(repoRoot, "docs/theme/ui/deferrals.json");
const themeUiRoot = path.join(repoRoot, "packages/theme-ui/src");

function walk(dir, acc = [], filter = (n) => /\.tsx$/.test(n) && !n.endsWith(".test.tsx")) {
	if (!existsSync(dir)) return acc;
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === "__tests__" || e.name === "test") continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, acc, filter);
		else if (filter(e.name)) acc.push(p);
	}
	return acc;
}

function toRel(abs) {
	return path.relative(repoRoot, abs).replace(/\\/g, "/");
}

function hasJsx(text) {
	return /return\s*\([\s\S]*</.test(text) || /return\s+</.test(text);
}

function domainOf(rel) {
	const m = rel.match(/domains\/([^/]+)/);
	if (m) return m[1];
	if (rel.includes("/shared/")) return "shared";
	if (rel.includes("/app-shell/") || rel.includes("/app/")) return "app-shell";
	return "other";
}

const deferrals = existsSync(deferralsPath) ? JSON.parse(readFileSync(deferralsPath, "utf8")) : {};
const byKind = {};
for (const [k, v] of Object.entries(deferrals)) {
	const kind = typeof v === "string" ? "permanent_desktop" : v.kind || "legacy";
	byKind[kind] = (byKind[kind] || 0) + 1;
}

const files = walk(rendererRoot);
const themeFiles = walk(themeUiRoot);

const buckets = {
	no_jsx: [],
	thin_reexport_theme: [],
	has_model_or_view: [], // jsx + data + model/view pattern
	mixed_no_split_pattern: [], // jsx + data, no model/view — potential gap
	pure_no_theme: [], // pure props, no theme-ui — should be migrate or hold
	pure_with_theme: [],
	deferred: [],
};

for (const f of files) {
	const rel = toRel(f);
	const text = readFileSync(f, "utf8");
	const jsx = hasJsx(text);
	const lines = text.split("\n").length;
	const heavy =
		/useAtom|from ["']jotai|store\/atoms/.test(text) ||
		/window\.vetta/.test(text) ||
		/@tanstack\/react-router|useNavigate|useParams|useMatches\b/.test(text);
	const model = /use[A-Z][A-Za-z0-9]*Model\s*\(/.test(text);
	const view = /<[A-Z][A-Za-z0-9]*(View|Frame)\b/.test(text) || /useTheme(Region|Component)/.test(text);
	const theme = /@vetta\/theme-ui/.test(text);
	const d = deferrals[rel];
	const kind = d ? (typeof d === "string" ? "permanent_desktop" : d.kind) : null;

	if (!jsx) {
		buckets.no_jsx.push(rel);
		continue;
	}
	if (kind) {
		buckets.deferred.push({ rel, kind, lines, domain: domainOf(rel) });
	}
	if (theme && lines <= 45 && !heavy) {
		buckets.thin_reexport_theme.push(rel);
		continue;
	}
	if (jsx && heavy && (model || view)) {
		buckets.has_model_or_view.push({ rel, lines, domain: domainOf(rel), model, view });
		continue;
	}
	if (jsx && heavy && !model && !view) {
		buckets.mixed_no_split_pattern.push({ rel, lines, domain: domainOf(rel) });
		continue;
	}
	if (jsx && !heavy) {
		if (theme) buckets.pure_with_theme.push(rel);
		else buckets.pure_no_theme.push({ rel, lines, domain: domainOf(rel), deferred: kind });
	}
}

// domain counts for deferred
const deferDomain = {};
for (const e of buckets.deferred) {
	const key = `${e.kind}@${e.domain}`;
	deferDomain[key] = (deferDomain[key] || 0) + 1;
}

const hostByDomain = {};
const permByDomain = {};
for (const e of buckets.deferred) {
	if (e.kind === "host_primitive_hold") hostByDomain[e.domain] = (hostByDomain[e.domain] || 0) + 1;
	if (e.kind === "permanent_desktop") permByDomain[e.domain] = (permByDomain[e.domain] || 0) + 1;
}

console.log("=== SCALE ===");
console.log(JSON.stringify({
	renderer_tsx: files.length,
	theme_ui_tsx: themeFiles.length,
	deferrals_total: Object.keys(deferrals).length,
	deferrals_by_kind: byKind,
}, null, 2));

console.log("\n=== RESIDUAL PATTERNS (beyond open gate buckets) ===");
console.log(JSON.stringify({
	no_jsx_or_non_component: buckets.no_jsx.length,
	thin_reexport_theme: buckets.thin_reexport_theme.length,
	split_pattern_ok_jsx_data: buckets.has_model_or_view.length,
	mixed_jsx_data_NO_model_view: buckets.mixed_no_split_pattern.length,
	pure_with_theme_import: buckets.pure_with_theme.length,
	pure_no_theme: buckets.pure_no_theme.length,
	pure_no_theme_undeferred: buckets.pure_no_theme.filter((x) => !x.deferred).length,
	deferred_entries_on_jsx: buckets.deferred.length,
}, null, 2));

console.log("\n=== host_primitive_hold by domain ===");
console.log(JSON.stringify(hostByDomain, null, 2));
console.log("\n=== permanent_desktop by domain ===");
console.log(JSON.stringify(permByDomain, null, 2));

console.log("\n=== MIXED without model/view (potential gate gap, first 40) ===");
const mixed = buckets.mixed_no_split_pattern.sort((a, b) => b.lines - a.lines);
for (const e of mixed.slice(0, 40)) {
	console.log(`${e.lines}\t${e.domain}\t${e.rel}`);
}
console.log(`... total mixed_no_split=${mixed.length}`);

console.log("\n=== pure_no_theme undeferred (first 30) ===");
const pureU = buckets.pure_no_theme.filter((x) => !x.deferred).sort((a, b) => b.lines - a.lines);
for (const e of pureU.slice(0, 30)) {
	console.log(`${e.lines}\t${e.domain}\t${e.rel}`);
}
console.log(`... total pure_no_theme_undeferred=${pureU.length}`);

console.log("\n=== host_primitive_hold files (all) ===");
const hosts = buckets.deferred.filter((e) => e.kind === "host_primitive_hold").sort((a, b) => b.lines - a.lines);
for (const e of hosts) {
	console.log(`${e.lines}\t${e.domain}\t${e.rel}`);
}
