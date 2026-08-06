import type { AbilityItem } from "../types";

export type InstallOutcome = "installed" | "needs-setup" | "skipped";

export interface BundleInstallResult {
	installedCount: number;
	setupItem?: AbilityItem;
}

export async function installSelectedBundleMembers(
	members: AbilityItem[],
	installOne: (item: AbilityItem) => Promise<InstallOutcome>,
): Promise<BundleInstallResult> {
	const seen = new Set<string>();
	let installedCount = 0;
	for (const member of members) {
		if (seen.has(member.id)) continue;
		seen.add(member.id);
		if (member.readonly || (member.installed && !member.needsUpdate)) continue;
		const outcome = await installOne(member);
		if (outcome === "needs-setup") return { installedCount, setupItem: member };
		if (outcome === "installed") installedCount += 1;
	}
	return { installedCount };
}
