import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import {
	builtinThemesDir,
	devSystemThemesDir,
	stageSystemThemeManifests,
	stageSystemThemesFromArchives,
} from "./stage-system-themes.mjs";

function run(command, args, cwd) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
		child.once("error", reject);
		child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
	});
}

function packageTheme(themeDir) {
	const manifest = JSON.parse(readFileSync(join(themeDir, "theme.json"), "utf8"));
	const releaseDir = join(themeDir, "release");
	const archivePath = join(releaseDir, `${manifest.id}-${manifest.version}.zip`);
	mkdirSync(releaseDir, { recursive: true });
	rmSync(archivePath, { force: true });
	const zip = new AdmZip();
	zip.addLocalFile(join(themeDir, "theme.json"));
	zip.addLocalFolder(join(themeDir, "dist"), "dist");
	zip.writeZip(archivePath);
}

if (process.argv.includes("--development")) {
	stageSystemThemeManifests(devSystemThemesDir, "stage-themes-dev");
} else if (existsSync(builtinThemesDir)) {
	const entries = readdirSync(builtinThemesDir).filter((name) =>
		existsSync(join(builtinThemesDir, name, "theme.json")),
	);
	for (const name of entries) {
		const themeDir = join(builtinThemesDir, name);
		await run("bun", ["run", "build"], themeDir);
		packageTheme(themeDir);
	}
	stageSystemThemesFromArchives(devSystemThemesDir, "build-themes");
}
