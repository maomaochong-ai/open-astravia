/**
 * 能力操作层：三条安装轨道（skills 目录 / plugins 目录 / mcp.json）的差异只在这里展开。
 * 每个操作统一登记 busy id、刷新数据源，并保留错误反馈。
 */
import type { PluginPermission } from "@preload/api";
import { i18n } from "@shared/i18n";
import { abilityToMarketMcpServer, downloadAbility, type MarketAbility } from "@shared/lib/api";
import { authTokenAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useState } from "react";
import { notifyPluginsChanged } from "../../plugins/runtime/plugin-events";
import type { McpSettingsModel } from "../../settings/components/useMcpSettingsModel";
import { type InstallOutcome, installSelectedBundleMembers } from "../lib/install-bundle-members";
import type { AbilityItem, BundleAbility, McpAbility, PluginAbility } from "../types";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface AbilityActions {
	busyIds: ReadonlySet<string>;
	error: string | null;
	install: (item: AbilityItem) => void;
	installBundleMembers: (bundle: BundleAbility, members: AbilityItem[]) => void;
	uninstall: (item: AbilityItem) => void;
	toggle: (item: AbilityItem) => void;
	setPluginPermission: (item: PluginAbility, permission: PluginPermission, granted: boolean) => void;
	setPluginCommand: (item: PluginAbility, command: string, granted: boolean) => void;
	reloadPlugin: (item: PluginAbility) => void;
	uninstallMembers: (members: AbilityItem[]) => void;
	importSkillArchive: (file: File) => void;
	importPluginArchive: (file: File) => void;
	importing: boolean;
}

export function useAbilityActions({ mcp, refresh }: { mcp: McpSettingsModel; refresh: () => void }): AbilityActions {
	const token = useAtomValue(authTokenAtom);
	const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set<string>());
	const [error, setError] = useState<string | null>(null);
	const [importing, setImporting] = useState(false);

	const run = useCallback(
		(id: string, operation: () => Promise<void>) => {
			setBusyIds((prev) => new Set(prev).add(id));
			setError(null);
			void operation()
				.catch((err: unknown) => setError(errorMessage(err)))
				.finally(() => {
					setBusyIds((prev) => {
						const next = new Set(prev);
						next.delete(id);
						return next;
					});
					refresh();
				});
		},
		[refresh],
	);

	const installSkill = useCallback(
		async (item: AbilityItem): Promise<InstallOutcome> => {
			if (item.type !== "skill" && item.type !== "scene") return "skipped";
			if (item.origin?.kind === "github-marketplace") {
				await window.vetta.abilities.installOpenAbility(item.type, item.slug, item.origin.sourceId);
				return "installed";
			}
			if (!token) throw new Error(i18n.t("abilities:error.notLoggedIn"));
			const buffer = await downloadAbility(token, item.type, item.slug);
			await window.vetta.skills.installFromMarket(item.slug, buffer, item.type, {
				alias: item.title,
				marketDescription: item.description,
				version: item.version,
				sha256: item.sha256,
			});
			return "installed";
		},
		[token],
	);

	const installPlugin = useCallback(
		async (item: PluginAbility): Promise<InstallOutcome> => {
			if (item.origin?.kind === "github-marketplace") {
				await window.vetta.abilities.installOpenAbility("plugin", item.slug, item.origin.sourceId);
				notifyPluginsChanged();
				return "installed";
			}
			if (!token) throw new Error(i18n.t("abilities:error.notLoggedIn"));
			const buffer = await downloadAbility(token, "plugin", item.slug);
			await window.vetta.plugins.installFromArchive(buffer, {
				source: "remote",
				expectedSha256: item.sha256,
			});
			notifyPluginsChanged();
			return "installed";
		},
		[token],
	);

	const installMcp = useCallback(
		async (item: McpAbility): Promise<InstallOutcome> => {
			// bundle 的私有内联成员：没有市场行，配置直接来自 bundle 声明
			if (item.inlineConfig) {
				await mcp.onAddRemoteServer({
					id: item.slug,
					name: item.serverName,
					display_name: item.title,
					description: item.description,
					icon: item.icon,
					config: item.inlineConfig,
				});
				return "installed";
			}
			const market = item.market as (MarketAbility & { configVersion?: number }) | undefined;
			const installOptions = market
				? {
						abilityVersion: market.version,
						...(item.origin ? { origin: item.origin } : {}),
						...(market.configVersion ? { configVersion: market.configVersion } : {}),
						catalogId: item.id,
						slug: item.slug,
						runtimeName: item.serverName,
					}
				: undefined;
			if (item.preset) {
				return mcp.onAddBuiltinServer(item.preset, installOptions);
			}
			if (market) {
				await mcp.onAddRemoteServer({ ...abilityToMarketMcpServer(market), name: item.serverName }, installOptions);
				return "installed";
			}
			return "skipped";
		},
		[mcp],
	);

	const installOne = useCallback(
		async (item: AbilityItem): Promise<InstallOutcome> => {
			if (item.installConflictIds?.length) {
				throw new Error(i18n.t("abilities:error.installSourceConflict"));
			}
			if (item.type === "plugin") return installPlugin(item);
			if (item.type === "mcp") return installMcp(item);
			if (item.type === "bundle") return "skipped";
			return installSkill(item);
		},
		[installMcp, installPlugin, installSkill],
	);

	const uninstallOne = useCallback(
		async (item: AbilityItem): Promise<void> => {
			if (item.type === "plugin") {
				await window.vetta.plugins.uninstall(item.slug);
				notifyPluginsChanged();
			} else if (item.type === "mcp") {
				await mcp.onDeleteServer(item.serverName);
			} else if (item.type === "skill" || item.type === "scene") {
				await window.vetta.skills.uninstall(item.slug, item.type);
			} else {
				return;
			}
		},
		[mcp],
	);

	const installBundleMembers = useCallback(
		(bundle: BundleAbility, members: AbilityItem[]) => {
			if (members.length === 0) return;
			run(bundle.id, async () => {
				await installSelectedBundleMembers(members, installOne);
			});
		},
		[installOne, run],
	);

	const install = useCallback(
		(item: AbilityItem) => {
			if (item.readonly) return;
			if (item.type === "bundle") return;
			if (item.installConflictIds?.length) {
				setError(i18n.t("abilities:error.installSourceConflict"));
				return;
			}
			run(item.id, async () => {
				await installOne(item);
			});
		},
		[installOne, run],
	);

	const uninstall = useCallback(
		(item: AbilityItem) => {
			if (item.readonly || item.type === "bundle") return;
			run(item.id, () => uninstallOne(item));
		},
		[run, uninstallOne],
	);

	const uninstallMembers = useCallback(
		(members: AbilityItem[]) => {
			if (members.length === 0) return;
			const first = members[0];
			if (!first) return;
			run(first.id, async () => {
				for (const member of members) {
					await uninstallOne(member);
				}
			});
		},
		[run, uninstallOne],
	);

	const toggleOne = useCallback(
		async (item: AbilityItem): Promise<void> => {
			if (item.type === "plugin") {
				await window.vetta.plugins.setEnabled(item.slug, !item.enabled);
				notifyPluginsChanged();
				return;
			}
			if (item.type === "mcp") {
				await mcp.onToggleDisabled(item.serverName);
				return;
			}
			if (item.type === "skill" || item.type === "scene") {
				await window.vetta.skills.toggle(item.slug);
			}
		},
		[mcp],
	);

	const toggle = useCallback(
		(item: AbilityItem) => {
			if (item.readonly) return;
			if (item.type === "bundle") {
				const targets = item.memberItems.filter((member) => member.installed && member.enabled === item.enabled);
				run(item.id, async () => {
					for (const member of targets) await toggleOne(member);
				});
				return;
			}
			run(item.id, async () => {
				await toggleOne(item);
			});
		},
		[run, toggleOne],
	);

	const setPluginPermission = useCallback(
		(item: PluginAbility, permission: PluginPermission, granted: boolean) => {
			run(`${item.id}:permission:${permission}`, async () => {
				if (granted) await window.vetta.plugins.grantPermissions(item.slug, [permission]);
				else await window.vetta.plugins.revokePermissions(item.slug, [permission]);
				notifyPluginsChanged();
			});
		},
		[run],
	);

	const setPluginCommand = useCallback(
		(item: PluginAbility, command: string, granted: boolean) => {
			run(`${item.id}:command:${command}`, async () => {
				if (granted) await window.vetta.plugins.grantCommands(item.slug, [command]);
				else await window.vetta.plugins.revokeCommands(item.slug, [command]);
				notifyPluginsChanged();
			});
		},
		[run],
	);

	const reloadPlugin = useCallback(
		(item: PluginAbility) => {
			run(item.id, async () => {
				await window.vetta.plugins.reload(item.slug);
				notifyPluginsChanged();
			});
		},
		[run],
	);

	const importSkillArchive = useCallback(
		(file: File) => {
			setImporting(true);
			setError(null);
			void file
				.arrayBuffer()
				.then((buffer) => window.vetta.skills.importCustom(buffer))
				.catch((err: unknown) => setError(errorMessage(err)))
				.finally(() => {
					setImporting(false);
					refresh();
				});
		},
		[refresh],
	);

	const importPluginArchive = useCallback(
		(file: File) => {
			setImporting(true);
			setError(null);
			void file
				.arrayBuffer()
				.then((buffer) => window.vetta.plugins.installFromArchive(buffer, { source: "archive" }))
				.then(() => {
					notifyPluginsChanged();
				})
				.catch((err: unknown) => setError(errorMessage(err)))
				.finally(() => {
					setImporting(false);
					refresh();
				});
		},
		[refresh],
	);

	return {
		busyIds,
		error,
		install,
		installBundleMembers,
		uninstall,
		toggle,
		setPluginPermission,
		setPluginCommand,
		reloadPlugin,
		uninstallMembers,
		importSkillArchive,
		importPluginArchive,
		importing,
	};
}
