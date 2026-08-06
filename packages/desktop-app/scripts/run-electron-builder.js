import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const buildStageDir = join(tmpdir(), "vetta-desktop-build");
const builderConfigPath = join(buildStageDir, "electron-builder.json");
const runtimeCoreLinuxSandboxDir = join(import.meta.dirname, "..", "..", "runtime-core", "sandbox", "linux");
const buildInnoInstallerPath = join(import.meta.dirname, "build-inno-installer.mjs");

const platformArgMap = {
	linux: "--linux",
	mac: "--mac",
	win: "--win",
};

const archArgMap = {
	arm64: "--arm64",
	ia32: "--ia32",
	universal: "--universal",
	x64: "--x64",
};

const defaultTargetsByPlatform = {
	linux: ["AppImage"],
	mac: ["dmg", "zip"],
	win: ["inno"],
};

function resolveDefaultPlatform() {
	if (process.platform === "darwin") return "mac";
	if (process.platform === "win32") return "win";
	if (process.platform === "linux") return "linux";
	throw new Error(`Unsupported host platform for electron-builder: ${process.platform}`);
}

function parseCommaSeparatedValue(raw, fallback) {
	if (!raw) return [...fallback];
	return raw
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

function parseCliOptions(argv) {
	const options = {
		archs: [],
		platform: undefined,
		publish: undefined,
		targets: [],
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const nextArg = argv[index + 1];

		if (arg === "--platform") {
			if (!nextArg) throw new Error("Missing value for --platform");
			options.platform = nextArg.trim();
			index += 1;
			continue;
		}

		if (arg === "--arch") {
			if (!nextArg) throw new Error("Missing value for --arch");
			options.archs.push(...parseCommaSeparatedValue(nextArg.trim(), []));
			index += 1;
			continue;
		}

		if (arg === "--target") {
			if (!nextArg) throw new Error("Missing value for --target");
			options.targets.push(...parseCommaSeparatedValue(nextArg.trim(), []));
			index += 1;
			continue;
		}

		if (arg === "--publish") {
			if (!nextArg) throw new Error("Missing value for --publish");
			options.publish = nextArg.trim();
			index += 1;
			continue;
		}

		throw new Error(`Unknown argument: ${arg}`);
	}

	return options;
}

function resolveArchitectures(cliArchs) {
	const archs = cliArchs.length > 0 ? cliArchs : [process.arch];
	for (const arch of archs) {
		if (!(arch in archArgMap)) {
			throw new Error(`Unsupported desktop build arch: ${arch}`);
		}
	}
	return archs;
}

function assertBuildStageExists() {
	if (!existsSync(builderConfigPath)) {
		throw new Error(`electron-builder config not found: ${builderConfigPath}. Run prebuild:pack first.`);
	}
}

function assertLinuxSandboxBinaries(archs) {
	for (const arch of archs) {
		const binaryPath = join(runtimeCoreLinuxSandboxDir, arch, "bwrap");
		if (!existsSync(binaryPath)) {
			throw new Error(
				`Missing bundled bubblewrap for Linux arch ${arch}: ${binaryPath}. Build or provide the matching bwrap binary before packaging Linux artifacts.`,
			);
		}
	}
}

function main() {
	assertBuildStageExists();
	const cliOptions = parseCliOptions(process.argv.slice(2));

	const platform = cliOptions.platform || resolveDefaultPlatform();
	if (!(platform in platformArgMap)) {
		throw new Error(`Unsupported desktop build platform: ${platform}`);
	}

	const archs = resolveArchitectures(cliOptions.archs);
	if (platform === "linux") {
		assertLinuxSandboxBinaries(archs);
	}

	const targets = cliOptions.targets.length > 0 ? cliOptions.targets : defaultTargetsByPlatform[platform];
	const usesInno = targets.some((target) => target.toLowerCase() === "inno");
	if (usesInno && (platform !== "win" || targets.length !== 1)) {
		throw new Error("The inno target must be the only target of a Windows build.");
	}
	if (usesInno && process.platform !== "win32") {
		throw new Error("The inno target requires a Windows build host.");
	}
	if (usesInno && cliOptions.publish) {
		throw new Error("The inno target creates custom artifacts; publish them through the release workflow.");
	}
	const electronBuilderTargets = usesInno ? ["dir"] : targets;
	const publishModes = new Set(["always", "never", "onTag", "onTagOrDraft"]);
	if (cliOptions.publish && !publishModes.has(cliOptions.publish)) {
		throw new Error(`Unsupported electron-builder publish mode: ${cliOptions.publish}`);
	}
	const args = [
		"electron-builder",
		`--project=${buildStageDir}`,
		`--config=${builderConfigPath}`,
		platformArgMap[platform],
		...electronBuilderTargets,
		...archs.map((arch) => archArgMap[arch]),
		...(cliOptions.publish ? [`--publish=${cliOptions.publish}`] : []),
	];

	console.log(
		`[run-electron-builder] platform=${platform} archs=${archs.join(",")} targets=${targets.join(",")} stage=${buildStageDir}`,
	);

	if (process.platform === "win32") {
		const command = ["bunx", ...args.map((value) => (value.includes(" ") ? `"${value}"` : value))].join(" ");
		execSync(command, {
			stdio: "inherit",
		});
	} else {
		execFileSync("bunx", args, {
			stdio: "inherit",
		});
	}

	if (usesInno) {
		for (const arch of archs) {
			execFileSync(process.platform === "win32" ? "node.exe" : "node", [buildInnoInstallerPath, "--arch", arch], {
				stdio: "inherit",
			});
		}
	}
}

main();
