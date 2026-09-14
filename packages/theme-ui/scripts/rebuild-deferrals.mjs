/**
 * Rebuild docs/theme/ui/deferrals.json with ONLY valid kinds:
 * permanent_desktop | host_primitive_hold | non_goal
 * Never deferred_for_split.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const deferralsPath = path.join(repoRoot, "docs/theme/ui/deferrals.json");

// Empty first so inventory reports opens
writeFileSync(deferralsPath, "{}\n");

const r = spawnSync("bun", ["packages/theme-ui/scripts/eligible-inventory.mjs", "--json"], {
	cwd: repoRoot,
	encoding: "utf8",
	maxBuffer: 20 * 1024 * 1024,
});
const out = (r.stdout || "") + (r.stderr || "");
const jsonStart = out.indexOf("{");
if (jsonStart < 0) {
	console.error("no json from inventory", out.slice(0, 500));
	process.exit(1);
}
// inventory exits 1 when open — still prints json to stdout
const report = JSON.parse(out.slice(jsonStart, out.lastIndexOf("}") + 1));

const d = {};
const shellRe =
	/App\.tsx$|router\.tsx$|RootLayout|RootGlobal|ThemeColor|ThemeError|ThemePageRoute|ThemeRuntime|DefaultSidebar\.tsx$|Sidebar\.tsx$|ChatPage\.tsx$|InputBar\.tsx$|MessageList\.tsx$|NewSessionPage\.tsx$|SettingsPage\.tsx$|SettingsContent|SettingsSidebar|shared\.tsx$|ActivityPanel\.tsx$|BatchTasksPage\.tsx$|AutomationPage|SkillsPage\.tsx$|PluginsPanel\.tsx$|KnowledgeBaseListPage|KnowledgeContentsPanel\.tsx$|TitleBar|BotAvatar|UserAvatar|provider-icon|segmented-control|tab-bar|time-picker|DomainManage|ActionApprovalCenter|GenericActionApproval\.tsx$|pet-entry|main\.tsx$|index\.tsx$/;

for (const e of report.must_host_hold || []) {
	d[e.path] = {
		kind: "host_primitive_hold",
		reason:
			"Props-driven or soft-pure UI still imports host Dialog/Drawer/Popover/Button; keep in desktop until @vetta-org/ui",
	};
}

for (const e of [...(report.must_migrate || []), ...(report.must_split || [])]) {
	if (shellRe.test(e.path)) {
		d[e.path] = {
			kind: "permanent_desktop",
			reason: "Page host / shell / connected assembler or shared chrome; stays desktop (boundary 1)",
		};
	}
}

writeFileSync(deferralsPath, `${JSON.stringify(d, null, 2)}\n`);
console.log(
	"wrote",
	Object.keys(d).length,
	"deferrals; remaining must_split≈",
	(report.must_split || []).filter((e) => !d[e.path]).length,
	"must_migrate≈",
	(report.must_migrate || []).filter((e) => !d[e.path]).length,
);
