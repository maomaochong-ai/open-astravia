/**
 * Must-split + migration closure gate (strict backlog clear).
 *
 * Exit 1 unless:
 *   must_split_open == 0
 *   must_migrate_open == 0
 *   must_host_hold_open == 0
 *   no bad deferrals (split-wait forbidden; pure permanent mask forbidden)
 *
 * deferrals.json kinds: permanent_desktop | host_primitive_hold | non_goal
 *
 * Anti-gaming:
 * - stub useXxxModel(){ return true } does not count as model
 * - null-only *View.tsx sibling does not count as view
 * - void View import alone does not count as usesView
 * - permanent_desktop cannot mask substantial pure presentation (→ must_migrate / must_host_hold)
 * - hasHostUi only counts value imports / real JSX host usage — not `import type`
 * - host_primitive_hold without real host value usage → bad_deferral
 * - _HostPrimitiveHold* marker exports → bad_deferral
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const rendererRoot = path.join(repoRoot, "apps/desktop-app/src/renderer");
const deferralsPath = path.join(repoRoot, "docs/theme/ui/deferrals.json");
const wantJson = process.argv.includes("--json");

const FORBIDDEN_SPLIT_WAIT =
	/split model|pending split|continue slice|尚未拆|等拆|must.?split|not required for theme|presentation leaf pending|composition still coupled|data tree|slice-then-migrate|unlock after|unsplit|Eligible presentation/i;

const PERMANENT_REASON_OK =
	/shell|container|entry|assembler|page host|model-hook|data-module|connected|host entry|host shell|wiring only|ipc host|registry host/i;

function walk(dir, acc = []) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === "__tests__" || e.name === "test") continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, acc);
		else if (/\.tsx$/.test(e.name) && !e.name.endsWith(".test.tsx")) acc.push(p);
	}
	return acc;
}

function toRel(abs) {
	return path.relative(repoRoot, abs).replace(/\\/g, "/");
}

function loadDeferrals() {
	if (!existsSync(deferralsPath)) return {};
	const raw = JSON.parse(readFileSync(deferralsPath, "utf8"));
	const out = {};
	for (const [k, v] of Object.entries(raw)) {
		if (typeof v === "string") out[k] = { kind: "permanent_desktop", reason: v };
		else if (v && typeof v === "object") {
			out[k] = {
				kind: v.kind ?? "legacy",
				reason: v.reason ?? v.unlock ?? "",
			};
		}
	}
	return out;
}

function hasJsx(text) {
	return /return\s*\([\s\S]*</.test(text) || /return\s+</.test(text);
}

function classNameCount(text) {
	return (text.match(/className=/g) || []).length;
}

/** Stub model: only returns true / literal, no real state. */
function hasStubModel(text) {
	return (
		/function\s+use[A-Z][A-Za-z0-9]*Model\s*\([^)]*\)\s*\{[\s\S]*?return\s+true\s*;?\s*\}/.test(text) ||
		/const\s+use[A-Z][A-Za-z0-9]*Model\s*=\s*\([^)]*\)\s*=>\s*true\b/.test(text) ||
		/function\s+use[A-Z][A-Za-z0-9]*Model\s*\([^)]*\)\s*\{\s*return\s+true\s*;?\s*\}/.test(text)
	);
}

function callsRealModel(text) {
	if (!/use[A-Z][A-Za-z0-9]*Model\s*\(/.test(text)) return false;
	if (hasStubModel(text)) return false;
	return true;
}

/** Find co-located FooView.tsx paths for Foo.tsx */
function siblingViewPaths(abs) {
	const dir = path.dirname(abs);
	const base = path.basename(abs, ".tsx");
	return [
		path.join(dir, `${base}View.tsx`),
		path.join(dir, "views", `${base}View.tsx`),
		path.join(dir, `${base.replace(/Page$/, "")}PageView.tsx`),
	];
}

function isNullOnlyViewFile(viewAbs) {
	if (!existsSync(viewAbs)) return true;
	const raw = readFileSync(viewAbs, "utf8");
	const text = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
	const classes = classNameCount(text);
	const hasElementReturn = /return\s*\(\s*</.test(text) || /return\s+</.test(text);
	const onlyNull = /return\s+null\b/.test(text) && !hasElementReturn;
	// Marker stubs: tiny file, no className, only null
	if (onlyNull && classes === 0) return true;
	if (classes === 0 && text.split("\n").length <= 12 && /export function \w+View/.test(text) && onlyNull) {
		return true;
	}
	return false;
}

function realSiblingViewExists(abs) {
	for (const p of siblingViewPaths(abs)) {
		if (existsSync(p) && !isNullOnlyViewFile(p)) return true;
	}
	return false;
}

/**
 * Uses a real View/Frame in JSX, or theme component registry.
 * Does NOT count: void View import, comments, or null-only sibling file.
 */
function usesRealView(text) {
	if (/useTheme(Region|Component)\s*\(/.test(text)) return true;
	// JSX open tags ending with View/Frame
	if (/<[A-Z][A-Za-z0-9]*(View|Frame)\b/.test(text)) return true;
	return false;
}

const HOST_UI_PATH =
	/components\/ui\/(dialog|drawer|popover|button|dropdown-menu|select|switch|textarea|input)/i;

/**
 * True only when host UI is used as a **value** (runtime) dependency.
 * Does NOT count: `import type { Button } from ".../button"`, type re-exports, markers.
 */
function hasValueHostUi(text) {
	// Strip block/line comments lightly
	const raw = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
	// Remove pure type imports entirely
	const withoutTypeImports = raw.replace(/import\s+type\s+[\s\S]*?from\s+["'][^"']+["']\s*;?/g, "");
	// Value import lines that reference host ui modules
	const importLines = withoutTypeImports.match(/^\s*import\s+(?!type\b)[^;]+from\s+["'][^"']+["']\s*;?/gm) || [];
	for (const line of importLines) {
		if (HOST_UI_PATH.test(line)) return true;
		if (/from\s+["']@?radix-ui\//.test(line) || /from\s+["']radix-ui["']/.test(line)) return true;
	}
	// JSX tags for common host primitives that are typically only from host ui when imported as value
	// Require co-presence of a value import path somewhere (already checked) — fallback: explicit jsx + non-type import of Button etc.
	// Multi-line import { \n Button \n } from ".../button"
	const multi = withoutTypeImports.match(/import\s+(?!type\b)[\s\S]*?from\s+["'][^"']+["']/g) || [];
	for (const block of multi) {
		if (HOST_UI_PATH.test(block)) return true;
		if (/from\s+["']@?radix-ui\//.test(block)) return true;
	}
	return false;
}

function hasFakeHostHoldMarker(text) {
	return /_HostPrimitiveHold/.test(text);
}

function classify(abs, text, deferrals) {
	const rel = toRel(abs);
	const lines = text.split("\n").length;

	if (/\/onboarding\/|\/pet\/|\/quickpanel\//.test(rel)) {
		return { status: "non_goal", rel, lines };
	}
	// Host design-system chrome (Dialog/Button implementations) — not business views.
	// Migration target is @vetta/ui when primitives land, not theme-ui business domains.
	if (/\/shared\/components\/ui\//.test(rel)) {
		return {
			status: "permanent_desktop",
			rel,
			lines,
			reason: "host design-system primitive implementation (chrome); leave until @vetta/ui",
		};
	}

	const hasTheme = /@vetta\/theme-ui/.test(text);
	const hasAtom = /useAtom|from ["']jotai|store\/atoms/.test(text);
	const hasIpc = /window\.vetta/.test(text);
	const hasRouter = /@tanstack\/react-router|useNavigate|useParams|useMatches\b/.test(text);
	const hasI18n = /react-i18next|useTranslation/.test(text);
	const hasHostUi = hasValueHostUi(text);
	const hasExport = /export function|export const \w+\s*=|export class|export default function/.test(text);
	const jsx = hasJsx(text);
	const dataHeavy = hasAtom || hasIpc || hasRouter;
	const d = deferrals[rel];
	const classes = classNameCount(text);
	// Substantial presentation: many classNames, or a large file that still owns layout classes.
	// Pure wiring shells (0 className, even if long) are not treated as presentation leaves.
	const substantialUi = classes > 3 || (lines > 100 && classes >= 1);

	// Explicit non_goal deferral (plugin private host shell, etc.) — even if dataHeavy
	if (d?.kind === "non_goal") {
		return { status: "non_goal", rel, lines, reason: d.reason };
	}
	// Theme runtime / route shells are host infrastructure, not themable business views
	if (/\/shared\/theme\/(runtime|pages)\//.test(rel)) {
		return {
			status: "permanent_desktop",
			rel,
			lines,
			reason: "theme runtime/page host shell",
		};
	}

	const isThinReexport =
		hasTheme && lines <= 45 && !dataHeavy && (/^export \{/.test(text.trim()) || /from ["']@vetta\/theme-ui/.test(text));
	const isAdapter =
		hasTheme &&
		lines <= 70 &&
		!dataHeavy &&
		(hasI18n || /ACHIEVEMENT_|useCodeClipboard|as Theme|formatResetCountdown/.test(text));
	if (isThinReexport || isAdapter) return { status: "migrated", rel, lines };

	if (!hasExport) return { status: "skip", rel, lines };

	if (/\/hooks\//.test(rel) || /use[A-Z]\w+Model\.tsx?$/.test(path.basename(abs))) {
		return { status: "permanent_desktop", rel, lines, reason: "model-hook" };
	}
	if (/\/store\/|\/services\//.test(rel) && !jsx) {
		return { status: "permanent_desktop", rel, lines, reason: "data-module" };
	}

	// Null-only marker view files themselves are skip / not presentation
	if (/View\.tsx$/.test(abs) && isNullOnlyViewFile(abs)) {
		return { status: "skip", rel, lines, reason: "null-view-marker" };
	}

	const callsModel = callsRealModel(text);
	const usesView = usesRealView(text);
	const realSibling = realSiblingViewExists(abs);

	// Thin connected container: only wires model hook -> *View (data lives in hook file)
	if (jsx && callsModel && usesView && lines <= 50) {
		if (classes <= 6) {
			return { status: "split_ok", rel, lines, reason: "thin-model-container" };
		}
	}

	// Container already split: real model + real View JSX (or theme), not stub/null markers
	if (jsx && dataHeavy && usesView && callsModel) {
		if (classes <= 15 || lines <= 120) {
			return { status: "split_ok", rel, lines, reason: "container-with-view" };
		}
	}
	// Sibling real view + real model, even if slightly larger wiring file
	if (jsx && dataHeavy && callsModel && realSibling && usesView) {
		if (classes <= 15 || lines <= 120) {
			return { status: "split_ok", rel, lines, reason: "container-with-sibling-view" };
		}
	}

	// Props view without data
	if (jsx && !dataHeavy) {
		// Fake type-only host-hold markers never qualify as host UI
		if (hasFakeHostHoldMarker(text) && !hasHostUi) {
			return { status: "must_migrate", rel, lines, soft: hasI18n ? "i18n" : "pure", reason: "fake-host-hold-marker" };
		}
		if (hasHostUi) {
			if (d?.kind === "host_primitive_hold") {
				return { status: "host_primitive_hold", rel, lines, reason: d.reason };
			}
			// permanent_desktop cannot mask host-primitive pure UI
			if (d?.kind === "permanent_desktop" && !substantialUi && PERMANENT_REASON_OK.test(d.reason || "")) {
				return { status: "permanent_desktop", rel, lines, reason: d.reason };
			}
			return { status: "must_host_hold", rel, lines };
		}
		// host_primitive_hold without real value host UI → must migrate (fake hold)
		if (d?.kind === "host_primitive_hold") {
			return { status: "must_migrate", rel, lines, soft: hasI18n ? "i18n" : "pure", reason: "invalid-host-hold" };
		}
		if (d?.kind === "permanent_desktop") {
			// Only thin host shells may use permanent_desktop for pure files
			if (!substantialUi && PERMANENT_REASON_OK.test(d.reason || "")) {
				return { status: "permanent_desktop", rel, lines, reason: d.reason };
			}
			// Substantial pure presentation wrongly marked permanent → must migrate
			return { status: "must_migrate", rel, lines, soft: hasI18n ? "i18n" : "pure", reason: "invalid-permanent-pure" };
		}
		if (d?.kind === "non_goal") {
			return { status: "non_goal", rel, lines, reason: d.reason };
		}
		if (hasTheme) return { status: "migrated", rel, lines };
		return { status: "must_migrate", rel, lines, soft: hasI18n ? "i18n" : "pure" };
	}

	// Mixed render + data without clear view separation
	if (jsx && dataHeavy) {
		if (d?.kind === "permanent_desktop" && PERMANENT_REASON_OK.test(d.reason || "")) {
			// permanent only for true shells — not if substantial mixed UI without real split
			if (!substantialUi || /shell|container|entry|assembler|page host|connected/i.test(d.reason || "")) {
				// still require non-substantial OR explicit shell language; large mixed still must_split
				if (!substantialUi || lines <= 100) {
					return { status: "permanent_desktop", rel, lines, reason: d.reason };
				}
			}
		}
		return { status: "must_split", rel, lines, tags: { hasAtom, hasIpc, hasRouter } };
	}

	return { status: "skip", rel, lines };
}

const deferrals = loadDeferrals();
const badDeferrals = [];
for (const [p, d] of Object.entries(deferrals)) {
	if (
		!["permanent_desktop", "host_primitive_hold", "non_goal"].includes(d.kind) ||
		FORBIDDEN_SPLIT_WAIT.test(d.reason || "")
	) {
		badDeferrals.push({ path: p, kind: d.kind, reason: d.reason });
		continue;
	}
	const abs = path.join(repoRoot, p);
	if (!existsSync(abs) || !abs.endsWith(".tsx")) continue;
	const text = readFileSync(abs, "utf8");
	if (hasFakeHostHoldMarker(text)) {
		badDeferrals.push({
			path: p,
			kind: d.kind,
			reason: "fake _HostPrimitiveHold* marker / type-only Button gaming",
		});
	}
	if (d.kind === "host_primitive_hold" && !hasValueHostUi(text)) {
		badDeferrals.push({
			path: p,
			kind: d.kind,
			reason: "host_primitive_hold without value import of host Dialog/Drawer/Popover/Button/Select/Switch",
		});
	}
	if (d.kind === "permanent_desktop") {
		const dataHeavy =
			/useAtom|from ["']jotai|store\/atoms/.test(text) ||
			/window\.vetta/.test(text) ||
			/@tanstack\/react-router|useNavigate|useParams|useMatches\b/.test(text);
		const jsx = hasJsx(text);
		const lines = text.split("\n").length;
		const classes = classNameCount(text);
		const substantialUi = classes > 3 || (lines > 100 && classes >= 1);
		if (jsx && !dataHeavy && substantialUi) {
			badDeferrals.push({
				path: p,
				kind: d.kind,
				reason: `substantial pure UI cannot be permanent_desktop (${lines}L/${classes} className)`,
			});
		}
	}
}

const buckets = {
	migrated: [],
	split_ok: [],
	must_split: [],
	must_migrate: [],
	must_host_hold: [],
	host_primitive_hold: [],
	permanent_desktop: [],
	non_goal: [],
	skip: [],
};

for (const f of walk(rendererRoot)) {
	const text = readFileSync(f, "utf8");
	const c = classify(f, text, deferrals);
	(buckets[c.status] || buckets.skip).push(c);
}

const summary = {
	migrated: buckets.migrated.length,
	split_ok: buckets.split_ok.length,
	must_split_open: buckets.must_split.length,
	must_migrate_open: buckets.must_migrate.length,
	must_host_hold_open: buckets.must_host_hold.length,
	host_primitive_hold: buckets.host_primitive_hold.length,
	permanent_desktop: buckets.permanent_desktop.length,
	non_goal: buckets.non_goal.length,
	bad_deferrals: badDeferrals.length,
};

const report = {
	summary,
	must_split: buckets.must_split.map((e) => ({ path: e.rel, lines: e.lines })),
	must_migrate: buckets.must_migrate.map((e) => ({ path: e.rel, lines: e.lines, soft: e.soft })),
	must_host_hold: buckets.must_host_hold.map((e) => ({ path: e.rel, lines: e.lines })),
	bad_deferrals: badDeferrals,
};

if (wantJson) console.log(JSON.stringify(report, null, 2));
else {
	console.log("=== must-split inventory gate ===");
	console.log(JSON.stringify(summary, null, 2));
	console.log("\n--- MUST_SPLIT ---");
	for (const e of report.must_split) console.log(`must_split\t${e.lines}\t${e.path}`);
	console.log("\n--- MUST_MIGRATE ---");
	for (const e of report.must_migrate) console.log(`must_migrate\t${e.soft || ""}\t${e.lines}\t${e.path}`);
	console.log("\n--- MUST_HOST_HOLD ---");
	for (const e of report.must_host_hold) console.log(`must_host_hold\t${e.lines}\t${e.path}`);
	if (badDeferrals.length) {
		console.log("\n--- BAD DEFERRALS ---");
		for (const b of badDeferrals.slice(0, 80))
			console.log(`bad\t${b.kind}\t${b.path}\t${(b.reason || "").slice(0, 90)}`);
	}
}

const fail =
	summary.must_split_open > 0 ||
	summary.must_migrate_open > 0 ||
	summary.must_host_hold_open > 0 ||
	summary.bad_deferrals > 0;

if (fail) {
	console.error(
		`\nFAILED must_split=${summary.must_split_open} must_migrate=${summary.must_migrate_open} must_host_hold=${summary.must_host_hold_open} bad_deferrals=${summary.bad_deferrals}`,
	);
	process.exit(1);
}
console.error("\nOK: must-split backlog clear");
process.exit(0);
