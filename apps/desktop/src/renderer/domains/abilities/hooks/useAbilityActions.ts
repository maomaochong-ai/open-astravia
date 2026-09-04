/**
 * 能力操作层：三条安装轨道（skills 目录 / plugins 目录 / mcp.json）的差异只在这里展开。
 * 每个操作统一登记 busy id、刷新数据源，并保留错误反馈。
 */
import type { McpServerConfigData, PluginPermission } from "@preload/api";
import { i18n } from "@shared/i18n";
import { abilityToMarketMcpServer, downloadAbility, type MarketAbility } from "@shared/lib/api";
import { authTokenAtom } from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { notifyPluginsChanged } from "../../plugins/runtime/plugin-events";
import type { McpSettingsModel } from "../../settings/components/useMcpSettingsModel";
import { type InstallOutcome, installSelectedBundleMembers } from "../lib/install-bundle-members";
import type { AbilityItem, AbilityOperation, BundleAbility, McpAbility, PluginAbility } from "../types";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface AbilityActions {
	busyIds: ReadonlySet<string>;
	operationById: ReadonlyMap<string, AbilityOperation>;
	error: string | null;
	install: (item: AbilityItem) => void;
	installBundleMembers: (bundle: BundleAbility, members: AbilityItem[]) => void;
	uninstall: (item: AbilityItem) => void;
	toggle: (item: AbilityItem) => void;
	setPluginPermission: (item: PluginAbility, permission: PluginPermission, granted: boolean) => void;
	/** 装完那次的启用、权限与命令授权一起落盘：草稿在弹窗里攒着，点确认才走到这里。 */
	applyPluginSetup: (
		item: PluginAbility,
		next: { enabled: boolean; grantedPermissions: PluginPermission[]; grantedCommands: string[] },
	) => void;
	setPluginCommand: (item: PluginAbility, command: string, granted: boolean) => void;
	reloadPlugin: (item: PluginAbility) => void;
	uninstallMembers: (members: AbilityItem[]) => void;
	importSkillArchive: (file: File) => void;
	importPluginArchive: (file: File) => void;
	importing: boolean;
	/** 刚装好、待提示配置权限的插件 slug；用完由 dismissPermissionPrompt 清空。 */
	permissionPromptSlug: string | null;
	dismissPermissionPrompt: () => void;
	/** 待提示「安装后还要在对话里完成一步」的 MCP 能力 id。 */
	setupPromptId: string | null;
	promptMcpSetup: (item: McpAbility) => void;
	dismissSetupPrompt: () => void;
}

export function useAbilityActions({ mcp, refresh }: { mcp: McpSettingsModel; refresh: () => void }): AbilityActions {
	const token = useAtomValue(authTokenAtom);
	const [operationById, setOperationById] = useState<ReadonlyMap<string, AbilityOperation>>(
		() => new Map<string, AbilityOperation>(),
	);
	const busyIds = useMemo<ReadonlySet<string>>(() => new Set(operationById.keys()), [operationById]);
	const [error, setError] = useState<string | null>(null);
	const [importing, setImporting] = useState(false);
	const [permissionPromptSlug, setPermissionPromptSlug] = useState<string | null>(null);
	const [setupPromptId, setSetupPromptId] = useState<string | null>(null);

	const run = useCallback(
		(
			id: string,
			initialOperation: AbilityOperation,
			operation: (setOperation: (next: AbilityOperation) => void) => Promise<void>,
		) => {
			setOperationById((prev) => new Map(prev).set(id, initialOperation));
			setError(null);
			const setOperation = (nextOperation: AbilityOperation): void => {
				setOperationById((prev) => new Map(prev).set(id, nextOperation));
			};
			void operation(setOperation)
				.catch((err: unknown) => setError(errorMessage(err)))
				.finally(() => {
					setOperationById((prev) => {
						const next = new Map(prev);
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
			const buffer = await downloadAbility(item.type, item.slug, token);
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

	const finishPluginInstall = useCallback(
		async (item: PluginAbility, setOperation?: (next: AbilityOperation) => void): Promise<void> => {
			if (item.installed) {
				setOperation?.("applyingUpdate");
				await window.vetta.plugins.reload(item.slug);
			}
			notifyPluginsChanged();
			if (item.installed) {
				showToast({
					variant: "success",
					message: i18n.t("abilities:message.updatedAndReloaded", {
						name: item.title,
						version: item.version,
					}),
				});
				return;
			}
			setPermissionPromptSlug(item.slug);
		},
		[],
	);

	const installPlugin = useCallback(
		async (item: PluginAbility, setOperation?: (next: AbilityOperation) => void): Promise<InstallOutcome> => {
			if (item.origin?.kind === "github-marketplace") {
				await window.vetta.abilities.installOpenAbility("plugin", item.slug, item.origin.sourceId);
				await finishPluginInstall(item, setOperation);
				return "installed";
			}
			const buffer = await downloadAbility("plugin", item.slug, token);
			await window.vetta.plugins.installFromArchive(buffer, {
				source: "remote",
				expectedSha256: item.sha256,
			});
			await finishPluginInstall(item, setOperation);
			return "installed";
		},
		[finishPluginInstall, token],
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
					config: item.inlineConfig as unknown as McpServerConfigData,
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
			const preparedServer =
				market && item.origin?.kind === "github-marketplace"
					? await window.vetta.abilities.prepareOpenMcpAbility(item.slug, item.origin.sourceId)
					: undefined;
			if (item.preset) {
				const result = await mcp.onAddBuiltinServer(
					preparedServer ? { ...item.preset, config: preparedServer } : item.preset,
					installOptions,
				);
				// 装完就把「还要在对话里扫码/登录一次」摆到用户面前，否则只剩一个待配置角标。
				if (result === "installed" && item.preset.postInstallSetup) setSetupPromptId(item.id);
				return result;
			}
			if (market) {
				const server = abilityToMarketMcpServer(market);
				await mcp.onAddRemoteServer(
					{
						...server,
						name: item.serverName,
						...(preparedServer ? { config: preparedServer } : {}),
					},
					installOptions,
				);
				return "installed";
			}
			return "skipped";
		},
		[mcp],
	);

	const installOne = useCallback(
		async (item: AbilityItem, setOperation?: (next: AbilityOperation) => void): Promise<InstallOutcome> => {
			if (item.installConflictIds?.length) {
				throw new Error(i18n.t("abilities:error.installSourceConflict"));
			}
			if (item.type === "plugin") return installPlugin(item, setOperation);
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
				if (item.origin?.kind === "github-marketplace") {
					await window.vetta.abilities.removeOpenMcpRuntime(item.slug, item.origin.sourceId);
				}
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
			run(
				bundle.id,
				members.some((member) => member.installed) ? "updating" : "installing",
				async (setOperation) => {
					await installSelectedBundleMembers(members, (member) => installOne(member, setOperation));
				},
			);
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
			run(item.id, item.installed ? "updating" : "installing", async (setOperation) => {
				await installOne(item, setOperation);
			});
		},
		[installOne, run],
	);

	const uninstall = useCallback(
		(item: AbilityItem) => {
			if (item.readonly || item.type === "bundle") return;
			run(item.id, "removing", () => uninstallOne(item));
		},
		[run, uninstallOne],
	);

	const uninstallMembers = useCallback(
		(members: AbilityItem[]) => {
			if (members.length === 0) return;
			const first = members[0];
			if (!first) return;
			run(first.id, "removing", async () => {
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
				run(item.id, item.enabled ? "disabling" : "enabling", async () => {
					for (const member of targets) await toggleOne(member);
				});
				return;
			}
			run(item.id, item.enabled ? "disabling" : "enabling", async () => {
				await toggleOne(item);
			});
		},
		[run, toggleOne],
	);

	const setPluginPermission = useCallback(
		(item: PluginAbility, permission: PluginPermission, granted: boolean) => {
			run(`${item.id}:permission:${permission}`, "saving", async () => {
				if (granted) await window.vetta.plugins.grantPermissions(item.slug, [permission]);
				else await window.vetta.plugins.revokePermissions(item.slug, [permission]);
				notifyPluginsChanged();
			});
		},
		[run],
	);

	const applyPluginSetup = useCallback(
		(
			item: PluginAbility,
			next: { enabled: boolean; grantedPermissions: PluginPermission[]; grantedCommands: string[] },
		) => {
			run(`${item.id}:setup`, "saving", async () => {
				const grant = next.grantedPermissions.filter((permission) => !item.grantedPermissions.includes(permission));
				const revoke = item.grantedPermissions.filter(
					(permission) => !next.grantedPermissions.includes(permission),
				);
				if (grant.length > 0) await window.vetta.plugins.grantPermissions(item.slug, grant);
				if (revoke.length > 0) await window.vetta.plugins.revokePermissions(item.slug, revoke);
				const grantCommands = next.grantedCommands.filter((command) => !item.grantedCommands.includes(command));
				const revokeCommands = item.grantedCommands.filter((command) => !next.grantedCommands.includes(command));
				if (grantCommands.length > 0) await window.vetta.plugins.grantCommands(item.slug, grantCommands);
				if (revokeCommands.length > 0) await window.vetta.plugins.revokeCommands(item.slug, revokeCommands);
				// 授权先于启用：反过来的话插件会以缺权限的状态先 activate 一次并抛错。
				if (next.enabled !== item.enabled) await window.vetta.plugins.setEnabled(item.slug, next.enabled);
				notifyPluginsChanged();
			});
		},
		[run],
	);

	const setPluginCommand = useCallback(
		(item: PluginAbility, command: string, granted: boolean) => {
			run(`${item.id}:command:${command}`, "saving", async () => {
				if (granted) await window.vetta.plugins.grantCommands(item.slug, [command]);
				else await window.vetta.plugins.revokeCommands(item.slug, [command]);
				notifyPluginsChanged();
			});
		},
		[run],
	);

	const reloadPlugin = useCallback(
		(item: PluginAbility) => {
			run(item.id, "reloading", async () => {
				await window.vetta.plugins.reload(item.slug);
				notifyPluginsChanged();
				showToast({
					variant: "success",
					message: i18n.t("abilities:message.reloaded", {
						name: item.title,
						version: item.pendingVersion ?? item.localVersion ?? item.version,
					}),
				});
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
				.then((plugin) => {
					notifyPluginsChanged();
					setPermissionPromptSlug(plugin.id);
				})
				.catch((err: unknown) => setError(errorMessage(err)))
				.finally(() => {
					setImporting(false);
					refresh();
				});
		},
		[refresh],
	);

	const dismissPermissionPrompt = useCallback(() => setPermissionPromptSlug(null), []);
	const promptMcpSetup = useCallback((item: McpAbility) => setSetupPromptId(item.id), []);
	const dismissSetupPrompt = useCallback(() => setSetupPromptId(null), []);

	return {
		busyIds,
		operationById,
		error,
		install,
		installBundleMembers,
		uninstall,
		toggle,
		setPluginPermission,
		applyPluginSetup,
		setPluginCommand,
		reloadPlugin,
		uninstallMembers,
		importSkillArchive,
		importPluginArchive,
		importing,
		permissionPromptSlug,
		dismissPermissionPrompt,
		setupPromptId,
		promptMcpSetup,
		dismissSetupPrompt,
	};
}
