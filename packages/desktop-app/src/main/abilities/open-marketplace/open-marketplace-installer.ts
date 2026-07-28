import { chmodSync, cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { GitHubMarketplaceOrigin } from "../../../preload/api-types/abilities.js";
import type { InstalledSkill } from "../../skills/skill-service.js";
import type { MarketplaceAbilityManifest } from "./marketplace-schema.js";
import { assertSafeSkillTree, validateSkillPackage } from "./skill-package.js";

export type OpenMarketplaceSkillManifest = Extract<MarketplaceAbilityManifest, { type: "skill" | "scene" }>;

export interface OpenMarketplaceInstallerDependencies {
	getBaseDir: (type: "skill" | "scene") => string;
	tmpBaseDir: string;
	readManifest: () => Record<string, InstalledSkill>;
	writeManifest: (manifest: Record<string, InstalledSkill>) => void;
	recordInstall: (
		type: "skill" | "scene",
		slug: string,
		version: string,
		metadata: { origin: GitHubMarketplaceOrigin; configVersion: number },
	) => void;
	recordEvent: (input: {
		name: string;
		type: "skill" | "scene";
		source: "market";
		operation: "installed" | "updated";
	}) => void;
}

function ensureDirWritable(dir: string): void {
	if (!existsSync(dir)) return;
	try {
		const mode = statSync(dir).mode & 0o777;
		if ((mode & 0o200) === 0) chmodSync(dir, mode | 0o200);
	} catch {
		// Let the following filesystem operation report the concrete error.
	}
}

export async function installOpenMarketplaceAbility(
	snapshotRoot: string,
	ability: OpenMarketplaceSkillManifest,
	origin: GitHubMarketplaceOrigin,
	dependencies: OpenMarketplaceInstallerDependencies,
): Promise<void> {
	const sourceDir = join(snapshotRoot, ability.source.path);
	validateSkillPackage(sourceDir, ability);

	mkdirSync(dependencies.tmpBaseDir, { recursive: true });
	const stagingParent = await mkdtemp(join(dependencies.tmpBaseDir, "open-ability-"));
	const stagedDir = join(stagingParent, ability.slug);
	const baseDir = dependencies.getBaseDir(ability.type);
	const destinationDir = join(baseDir, ability.slug);
	const backupDir = join(stagingParent, `${ability.slug}.previous`);
	const previousManifest = dependencies.readManifest();
	const previousEntry = previousManifest[ability.slug];
	if (previousEntry && (previousEntry.type === "scene" ? "scene" : "skill") !== ability.type) {
		throw new Error(`Cannot install ${ability.type}:${ability.slug}; the other skill type already uses this slug`);
	}
	let movedPrevious = false;
	let installedNew = false;

	try {
		cpSync(sourceDir, stagedDir, { recursive: true, errorOnExist: true });
		assertSafeSkillTree(stagedDir);
		mkdirSync(baseDir, { recursive: true });
		ensureDirWritable(baseDir);
		if (existsSync(destinationDir)) {
			ensureDirWritable(destinationDir);
			await rename(destinationDir, backupDir);
			movedPrevious = true;
		}
		await rename(stagedDir, destinationDir);
		installedNew = true;

		const installedAt = previousEntry?.installedAt ?? new Date().toISOString();
		const nextManifest: Record<string, InstalledSkill> = {
			...previousManifest,
			[ability.slug]: {
				name: ability.slug,
				version: ability.version,
				installedAt,
				source: "market",
				enabled: previousEntry?.enabled ?? true,
				type: ability.type,
				alias: ability.name,
				marketDescription: ability.description,
			},
		};
		dependencies.writeManifest(nextManifest);
		dependencies.recordInstall(ability.type, ability.slug, ability.version, {
			origin,
			configVersion: ability.configVersion,
		});
		dependencies.recordEvent({
			name: ability.slug,
			type: ability.type,
			source: "market",
			operation: previousEntry ? "updated" : "installed",
		});
	} catch (error) {
		try {
			dependencies.writeManifest(previousManifest);
			if (installedNew && existsSync(destinationDir)) await rm(destinationDir, { recursive: true, force: true });
			if (movedPrevious && existsSync(backupDir)) await rename(backupDir, destinationDir);
		} catch {
			// Preserve the original installation error; recovery is best effort.
		}
		throw error;
	} finally {
		await rm(stagingParent, { recursive: true, force: true });
	}
}
