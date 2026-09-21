import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * 对账能力市场索引（`.vetta/marketplace.json`）与各能力目录。
 *
 * 索引本来就是派生数据，却有一组会咬人的硬约束：条目的 slug/version 必须与能力目录里的身份
 * 文件完全相等，否则宿主同步**直接失败**；`entry`/`styles` 指向的文件必须真实存在，否则本地
 * 能装、市场上装不了；而改了任何内容却没换 `marketplaceVersion` 时，客户端按它判缓存——
 * 既不报错也不更新，用户只是永远收不到新版本。
 *
 * 三种失败里有两种不在作者机器上复现，一种压根不报错。所以这件事必须是工具做的。
 */

export type SyncChangeKind = "version" | "api_version" | "permissions" | "commands" | "marketplaceVersion";

export interface SyncChange {
	readonly slug: string;
	readonly field: SyncChangeKind;
	readonly from: unknown;
	readonly to: unknown;
}

export interface SyncProblem {
	readonly slug: string;
	readonly message: string;
}

export interface SyncResult {
	readonly manifestPath: string;
	readonly changes: readonly SyncChange[];
	readonly problems: readonly SyncProblem[];
	/** 目录里有身份文件、索引里却没有的能力。只报告，不擅自上架。 */
	readonly unlisted: readonly string[];
	/** apply 时是否真的写了盘。 */
	readonly written: boolean;
}

export interface SyncInput {
	readonly hubRoot: string;
	readonly manifestPath: string;
	/** false 时只报告不写盘（`--check`）。 */
	readonly apply: boolean;
}

const SCAN_IGNORED = new Set(["node_modules", ".git", "dist", "release", ".vetta", "assets", "test", "src"]);
const SCAN_MAX_DEPTH = 5;

/**
 * 探测 JSON 文件用的缩进，回写时沿用。
 *
 * 不这么做的代价很具体：索引文件本是 2 空格，工具按 Tab 重排就会把整份文件写成一个大 diff，
 * 与仓库里其它写这份文件的脚本来回拉锯，任何并发提交都升级成整文件冲突。对账工具只该改它
 * 要改的那几个字段。
 */
function detectJsonIndent(source: string): string {
	const match = /\n([ \t]+)\S/.exec(source);
	return match?.[1] ?? "\t";
}

function readJsonFile(path: string): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
		return parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.every((item) => typeof item === "string") ? [...(value as string[])] : undefined;
}

function sameStringArray(left: unknown, right: readonly string[]): boolean {
	const current = stringArray(left) ?? [];
	return current.length === right.length && current.every((item, index) => item === right[index]);
}

/** `source.path` 必须留在仓库内；索引是仓库里的文件，不该能指到仓库外面去。 */
function resolveAbilityDir(hubRoot: string, sourcePath: string): string | undefined {
	const target = resolve(hubRoot, sourcePath);
	const fromRoot = relative(hubRoot, target);
	if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) return undefined;
	return existsSync(target) && statSync(target).isDirectory() ? target : undefined;
}

/** 能力目录内的相对路径同理，且必须指向真实存在的文件。 */
function packagedFileExists(abilityDir: string, path: string): boolean {
	const target = resolve(abilityDir, path);
	const fromDir = relative(abilityDir, target);
	if (fromDir === "" || fromDir === ".." || fromDir.startsWith(`..${sep}`)) return false;
	return existsSync(target) && statSync(target).isFile();
}

/**
 * 推进 `marketplaceVersion`。
 *
 * 只认得两种写法：semver 和纯整数。其它写法（日期、commit 短号……）由作者自己决定下一个是
 * 什么，工具猜一个反而更危险——这个值一旦回退或重复，客户端就不会拉新快照。
 */
function nextMarketplaceVersion(current: unknown): string | undefined {
	if (typeof current !== "string") return undefined;
	const semver = /^(\d+)\.(\d+)\.(\d+)$/.exec(current.trim());
	if (semver) return `${semver[1]}.${semver[2]}.${Number(semver[3]) + 1}`;
	if (/^\d+$/.test(current.trim())) return String(Number(current.trim()) + 1);
	return undefined;
}

export function syncMarketplaceIndex(input: SyncInput): SyncResult {
	const manifest = readJsonFile(input.manifestPath);
	if (!manifest) throw new Error(`Malformed marketplace manifest: ${input.manifestPath}`);
	const abilities = Array.isArray(manifest.abilities) ? (manifest.abilities as unknown[]) : [];

	const changes: SyncChange[] = [];
	const problems: SyncProblem[] = [];
	const listedDirs = new Set<string>();

	for (const raw of abilities) {
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
		const entry = raw as Record<string, unknown>;
		const slug = typeof entry.slug === "string" ? entry.slug : "(unnamed)";
		const type = typeof entry.type === "string" ? entry.type : "";
		if (type === "bundle") {
			// bundle 成员刻意不独立上架（索引的 abilities 是「独立上架条目」）。把它们的目录
			// 记为已登记，否则会被当成漏登记的能力报出来。
			const bundleConfig =
				typeof entry.config === "object" && entry.config !== null && !Array.isArray(entry.config)
					? (entry.config as Record<string, unknown>)
					: undefined;
			for (const member of Array.isArray(bundleConfig?.members) ? (bundleConfig.members as unknown[]) : []) {
				if (typeof member !== "object" || member === null || Array.isArray(member)) continue;
				const memberEntry = member as Record<string, unknown>;
				const memberSource = memberEntry.source;
				const memberPath =
					typeof memberSource === "object" && memberSource !== null && !Array.isArray(memberSource)
						? (memberSource as Record<string, unknown>).path
						: undefined;
				if (typeof memberPath !== "string") continue;
				const dir = resolveAbilityDir(input.hubRoot, memberPath);
				if (dir) {
					listedDirs.add(dir);
					if (manifest.schemaVersion === 3 && memberEntry.type === "plugin") {
						const descriptor = readJsonFile(join(dir, "ability.json"));
						const memberChanges: SyncChange[] = [];
						reconcilePlugin({
							entry: { ...memberEntry, version: descriptor?.version },
							slug: typeof memberEntry.slug === "string" ? memberEntry.slug : "(unnamed)",
							abilityDir: dir,
							schemaVersion: manifest.schemaVersion,
							minAppVersion: manifest.minAppVersion,
							changes: memberChanges,
							problems,
						});
						for (const change of memberChanges) {
							problems.push({ slug: change.slug, message: `ability.json version does not match latest release: ${change.to}` });
						}
					}
				}
			}
			continue;
		}

		const source = typeof entry.source === "object" && entry.source !== null ? (entry.source as Record<string, unknown>) : undefined;
		const sourcePath = typeof source?.path === "string" ? source.path : undefined;
		if (!sourcePath) {
			problems.push({ slug, message: "entry has no source.path" });
			continue;
		}
		const abilityDir = resolveAbilityDir(input.hubRoot, sourcePath);
		if (!abilityDir) {
			problems.push({ slug, message: `source.path does not resolve to a directory inside the repository: ${sourcePath}` });
			continue;
		}
		listedDirs.add(abilityDir);

		if (type === "plugin") reconcilePlugin({ entry, slug, abilityDir, schemaVersion: manifest.schemaVersion, minAppVersion: manifest.minAppVersion, changes, problems });
		else if (type === "mcp") reconcileIdentityFile({ entry, slug, abilityDir, fileName: "mcp.json", changes, problems });
		// skill / scene 目录里没有身份文件，目录存在即算通过。
	}

	// 未登记的目录只报告、不作为 problem：作者可能正在开发一个还不打算上架的东西。
	const unlisted = findAbilityDirectories(input.hubRoot)
		.filter((dir) => !listedDirs.has(dir))
		.map((dir) => relative(input.hubRoot, dir).split(sep).join("/"))
		.sort();

	let written = false;
	if (changes.length > 0 && input.apply) {
		const bumped = nextMarketplaceVersion(manifest.marketplaceVersion);
		if (bumped) {
			changes.push({ slug: "(manifest)", field: "marketplaceVersion", from: manifest.marketplaceVersion, to: bumped });
			manifest.marketplaceVersion = bumped;
		} else {
			problems.push({
				slug: "(manifest)",
				message:
					"content changed but marketplaceVersion could not be bumped automatically (expected semver or an integer). Set it manually — clients skip the update when it does not change.",
			});
		}
		const source = readFileSync(input.manifestPath, "utf8");
		const serialized = JSON.stringify(manifest, null, detectJsonIndent(source));
		writeFileSync(input.manifestPath, source.endsWith("\n") ? `${serialized}\n` : serialized, "utf8");
		written = true;
	}

	return { manifestPath: input.manifestPath, changes, problems, unlisted, written };
}

function reconcilePlugin(context: {
	entry: Record<string, unknown>;
	slug: string;
	abilityDir: string;
	schemaVersion: unknown;
	minAppVersion: unknown;
	changes: SyncChange[];
	problems: SyncProblem[];
}): void {
	const { entry, slug, abilityDir, schemaVersion, minAppVersion, changes, problems } = context;
	if (schemaVersion === 3 && !("releases" in entry)) {
		problems.push({ slug, message: "schemaVersion 3 plugin requires versioned releases" });
		return;
	}
	if ("releases" in entry) {
		if (schemaVersion !== 3) {
			problems.push({ slug, message: "versioned plugin releases require marketplace schemaVersion 3" });
			return;
		}
		const releases = entry.releases;
		if (!Array.isArray(releases) || releases.length === 0) {
			problems.push({ slug, message: "plugin releases must be a nonempty array" });
			return;
		}
		let latest: { version: string; parts: [number, number, number] } | undefined;
		const seen = new Set<string>();
		for (const raw of releases) {
			if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
				problems.push({ slug, message: "plugin release must be an object" });
				continue;
			}
			const release = raw as Record<string, unknown>;
			const match = typeof release.version === "string" ? /^(\d+)\.(\d+)\.(\d+)$/.exec(release.version) : null;
			if (!match || seen.has(release.version as string)) {
				problems.push({ slug, message: `invalid or duplicate plugin release version: ${String(release.version)}` });
				continue;
			}
			seen.add(release.version as string);
			const minimum = typeof release.minAppVersion === "string" ? /^(\d+)\.(\d+)\.(\d+)$/.exec(release.minAppVersion) : null;
			if (!minimum || typeof minAppVersion !== "string" || !/^(\d+)\.(\d+)\.(\d+)$/.test(minAppVersion)) {
				problems.push({ slug, message: `release ${release.version} has an invalid minAppVersion` });
			} else {
				const marketMinimum = /^(\d+)\.(\d+)\.(\d+)$/.exec(minAppVersion);
				if (marketMinimum && compareVersionParts(minimum.slice(1).map(Number), marketMinimum.slice(1).map(Number)) < 0) {
					problems.push({ slug, message: `release ${release.version} requires an app older than the marketplace` });
				}
			}
			if (typeof release.pluginApiVersion !== "string" || !/^\^\d+\.\d+\.\d+$/.test(release.pluginApiVersion)) {
				problems.push({ slug, message: `release ${release.version} has an invalid pluginApiVersion` });
			}
			for (const field of ["permissions", "commands"] as const) {
				if (release[field] !== undefined && !stringArray(release[field])) {
					problems.push({ slug, message: `release ${release.version} has invalid ${field}` });
				}
			}
			const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
			if (!latest || compareVersionParts(parts, latest.parts) > 0) {
				latest = { version: release.version as string, parts };
			}
			const artifact = release.artifact;
			if (typeof artifact !== "object" || artifact === null || Array.isArray(artifact)) {
				problems.push({ slug, message: `release ${release.version} has no artifact` });
				continue;
			}
			const { url, sha256 } = artifact as Record<string, unknown>;
			let validUrl = false;
			try {
				const parsed = new URL(String(url));
				validUrl = parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash;
			} catch {
				// Report the malformed URL below.
			}
			if (!validUrl || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
				problems.push({ slug, message: `release ${release.version} has an invalid HTTPS artifact or SHA-256` });
			}
		}
		if (latest && entry.version !== latest.version) {
			changes.push({ slug, field: "version", from: entry.version, to: latest.version });
			entry.version = latest.version;
		}
		return;
	}
	const manifest = readJsonFile(join(abilityDir, "plugin.json"));
	if (!manifest) {
		problems.push({ slug, message: "plugin.json is missing or malformed" });
		return;
	}
	if (manifest.id !== slug) {
		// id 由作者决定，slug 是上架身份；改哪个都有副作用，不擅自动手。
		problems.push({ slug, message: `plugin.json id ${JSON.stringify(manifest.id)} does not match the ability slug` });
		return;
	}
	if (typeof manifest.version === "string" && entry.version !== manifest.version) {
		changes.push({ slug, field: "version", from: entry.version, to: manifest.version });
		entry.version = manifest.version;
	}

	// api_version / permissions / commands 刻意不回填：宿主在建目录时用 plugin.json 推导的值
	// 整个覆盖 config，索引里写什么都会被重算掉。写进去只会多一份会漂移的副本，所以只在它
	// 已经存在且与真源不符时提醒作者删掉或改对。
	const config =
		typeof entry.config === "object" && entry.config !== null && !Array.isArray(entry.config)
			? (entry.config as Record<string, unknown>)
			: undefined;
	if (config) {
		if (typeof config.api_version === "string" && config.api_version !== manifest.pluginApiVersion) {
			problems.push({
				slug,
				message: `config.api_version ${JSON.stringify(config.api_version)} disagrees with plugin.json (${JSON.stringify(manifest.pluginApiVersion)}); the host derives this field, so drop the copy or fix it`,
			});
		}
		const declared = stringArray(manifest.permissions) ?? [];
		if (Array.isArray(config.permissions) && !sameStringArray(config.permissions, declared)) {
			problems.push({
				slug,
				message: "config.permissions disagrees with plugin.json; the host derives this field, so drop the copy or fix it",
			});
		}
	}

	// 宿主按 plugin.json 直接读目录，不会替作者构建：产物不在仓库里就是装不上。
	const entryFile = typeof manifest.entry === "string" ? manifest.entry : undefined;
	if (!entryFile || !packagedFileExists(abilityDir, entryFile)) {
		problems.push({ slug, message: `built entry is missing from the published directory: ${entryFile ?? "(entry not declared)"}` });
	}
	for (const style of stringArray(manifest.styles) ?? []) {
		if (!packagedFileExists(abilityDir, style)) {
			problems.push({ slug, message: `declared style is missing from the published directory: ${style}` });
		}
	}
}

function compareVersionParts(left: readonly number[], right: readonly number[]): number {
	for (let index = 0; index < 3; index += 1) {
		if (left[index] !== right[index]) return (left[index] ?? 0) - (right[index] ?? 0);
	}
	return 0;
}

function reconcileIdentityFile(context: {
	entry: Record<string, unknown>;
	slug: string;
	abilityDir: string;
	fileName: string;
	changes: SyncChange[];
	problems: SyncProblem[];
}): void {
	const { entry, slug, abilityDir, fileName, changes, problems } = context;
	const identity = readJsonFile(join(abilityDir, fileName));
	if (!identity) {
		problems.push({ slug, message: `${fileName} is missing or malformed` });
		return;
	}
	if (typeof identity.slug === "string" && identity.slug !== slug) {
		problems.push({ slug, message: `${fileName} slug ${JSON.stringify(identity.slug)} does not match the ability slug` });
		return;
	}
	if (typeof identity.version === "string" && entry.version !== identity.version) {
		changes.push({ slug, field: "version", from: entry.version, to: identity.version });
		entry.version = identity.version;
	}
}

/** 扫描仓库里带身份文件的能力目录。深度与忽略名单是为了不爬进依赖和构建产物。 */
function findAbilityDirectories(hubRoot: string): string[] {
	const found: string[] = [];
	const walk = (dir: string, depth: number): void => {
		if (depth > SCAN_MAX_DEPTH) return;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		if (entries.includes("plugin.json") || entries.includes("mcp.json")) {
			found.push(dir);
			return; // 能力目录内部不再深挖。
		}
		for (const name of entries) {
			if (name.startsWith(".") || SCAN_IGNORED.has(name)) continue;
			const child = join(dir, name);
			try {
				if (statSync(child).isDirectory()) walk(child, depth + 1);
			} catch {
				// 断链或权限不足：跳过即可，扫描不该因为一个目录中断。
			}
		}
	};
	walk(hubRoot, 0);
	return found.sort();
}

/**
 * 单个能力的索引漂移，用于在开发命令里顺手提醒。
 *
 * 完整的 `sync` 是仓库根的事，但作者改完 version 往往立刻就装一次——那一刻提醒，比等他
 * 某天想起来跑 CI 要早得多，也是 Agent 唯一能可靠接收到这件事的时机。
 */
export function describeIndexDrift(input: {
	hubRoot: string;
	manifestPath: string;
	slug: string;
	version: string;
}): string | undefined {
	const manifest = readJsonFile(input.manifestPath);
	if (!manifest || !Array.isArray(manifest.abilities)) return undefined;
	const entry = (manifest.abilities as unknown[]).find(
		(item) =>
			typeof item === "object" && item !== null && !Array.isArray(item) && (item as Record<string, unknown>).slug === input.slug,
	) as Record<string, unknown> | undefined;
	if (!entry) return undefined;
	if (entry.version === input.version) return undefined;
	return `Marketplace index still lists ${input.slug} ${JSON.stringify(entry.version)} (this project is ${JSON.stringify(input.version)}). Run \`vetta-plugin-cli sync\` at ${input.hubRoot} — the host refuses to sync an entry whose version does not match.`;
}
