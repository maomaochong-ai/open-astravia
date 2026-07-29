import { app, BrowserWindow, ipcMain } from "electron";
import type {
	AbilityInstallMetadata,
	AbilityInstallOrigin,
	AddMarketplaceSourceInput,
	UpdateMarketplaceSourceInput,
} from "../../preload/api-types/abilities.js";
import { readAbilityLedger, recordAbilityInstall } from "../abilities/ability-ledger.js";
import { getOpenMarketplaceManager } from "../abilities/open-marketplace/open-marketplace-manager.js";
import { DEFAULT_MARKETPLACE_SOURCE_ID } from "../abilities/open-marketplace/open-marketplace-service.js";
import { readMcpConfig } from "../mcp/mcp-settings-service.js";

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
	return value;
}

function parseAddSourceInput(value: unknown): AddMarketplaceSourceInput {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("addMarketplaceSource requires an input object");
	}
	const input = value as Record<string, unknown>;
	if (input.name !== undefined && typeof input.name !== "string") throw new Error("name must be a string");
	if (input.ref !== undefined && typeof input.ref !== "string") throw new Error("ref must be a string");
	return {
		repository: requireString(input.repository, "repository"),
		...(typeof input.name === "string" ? { name: input.name } : {}),
		...(typeof input.ref === "string" ? { ref: input.ref } : {}),
	};
}

function parseUpdateSourceInput(value: unknown): UpdateMarketplaceSourceInput {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("updateMarketplaceSource requires an input object");
	}
	const input = value as Record<string, unknown>;
	if (input.name !== undefined && typeof input.name !== "string") throw new Error("name must be a string");
	if (input.ref !== undefined && typeof input.ref !== "string") throw new Error("ref must be a string");
	if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
		throw new Error("enabled must be a boolean");
	}
	if (input.autoUpdate !== undefined && typeof input.autoUpdate !== "boolean") {
		throw new Error("autoUpdate must be a boolean");
	}
	return {
		...(typeof input.name === "string" ? { name: input.name } : {}),
		...(typeof input.ref === "string" ? { ref: input.ref } : {}),
		...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
		...(typeof input.autoUpdate === "boolean" ? { autoUpdate: input.autoUpdate } : {}),
	};
}

function parseAbilityInstallOrigin(value: unknown): AbilityInstallOrigin | undefined {
	if (value === undefined) return undefined;
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("origin must be an object");
	}
	const origin = value as Record<string, unknown>;
	if (origin.kind === "server") return { kind: "server" };
	if (origin.kind !== "github-marketplace") throw new Error("origin kind is invalid");
	return {
		kind: "github-marketplace",
		...(origin.sourceId === undefined ? {} : { sourceId: requireString(origin.sourceId, "origin.sourceId") }),
		marketplace: requireString(origin.marketplace, "origin.marketplace"),
		marketplaceVersion: requireString(origin.marketplaceVersion, "origin.marketplaceVersion"),
		repository: requireString(origin.repository, "origin.repository"),
	};
}

function parseMcpInstallMetadata(value: unknown): AbilityInstallMetadata | undefined {
	if (value === undefined) return undefined;
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("recordMcpInstall metadata must be an object");
	}
	const metadata = value as Record<string, unknown>;
	if (
		metadata.configVersion !== undefined &&
		(typeof metadata.configVersion !== "number" ||
			!Number.isInteger(metadata.configVersion) ||
			metadata.configVersion < 1)
	) {
		throw new Error("configVersion must be a positive integer");
	}
	const origin = parseAbilityInstallOrigin(metadata.origin);
	const catalogId = metadata.catalogId === undefined ? undefined : requireString(metadata.catalogId, "catalogId");
	const slug = metadata.slug === undefined ? undefined : requireString(metadata.slug, "slug");
	const runtimeName =
		metadata.runtimeName === undefined ? undefined : requireString(metadata.runtimeName, "runtimeName");
	return {
		...(origin ? { origin } : {}),
		...(typeof metadata.configVersion === "number" ? { configVersion: metadata.configVersion } : {}),
		...(catalogId ? { catalogId } : {}),
		...(slug ? { slug } : {}),
		...(runtimeName ? { runtimeName } : {}),
	};
}

export function registerAbilitiesIpc(): () => void {
	const openMarketplace = getOpenMarketplaceManager(app.getVersion());
	const unsubscribeFromUpdates = openMarketplace.subscribeToUpdates(() => {
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed()) win.webContents.send("vetta:abilities:open-marketplaces-updated");
		}
	});
	// 一次性下发全量台账；读取时顺带剔除漂移条目（ADR-0049）。
	ipcMain.handle("vetta:abilities:get-ledger", () => readAbilityLedger());
	ipcMain.handle("vetta:abilities:list-open-marketplace", async () => {
		const { source: _source, ...snapshot } = await openMarketplace.listSource(DEFAULT_MARKETPLACE_SOURCE_ID);
		return snapshot;
	});
	ipcMain.handle("vetta:abilities:refresh-open-marketplace", async () => {
		const { source: _source, ...snapshot } = await openMarketplace.refreshSource(DEFAULT_MARKETPLACE_SOURCE_ID);
		return snapshot;
	});
	ipcMain.handle("vetta:abilities:list-open-marketplaces", () => openMarketplace.list());
	ipcMain.handle("vetta:abilities:refresh-open-marketplaces", () => openMarketplace.refresh());
	ipcMain.handle("vetta:abilities:list-marketplace-sources", () => openMarketplace.listSources());
	ipcMain.handle("vetta:abilities:add-marketplace-source", (_event, input: unknown) =>
		openMarketplace.addSource(parseAddSourceInput(input)),
	);
	ipcMain.handle("vetta:abilities:update-marketplace-source", (_event, id: unknown, input: unknown) =>
		openMarketplace.updateSource(requireString(id, "id"), parseUpdateSourceInput(input)),
	);
	ipcMain.handle("vetta:abilities:remove-marketplace-source", (_event, id: unknown) =>
		openMarketplace.removeSource(requireString(id, "id")),
	);
	ipcMain.handle("vetta:abilities:refresh-marketplace-source", (_event, id: unknown) =>
		openMarketplace.refreshSource(requireString(id, "id")),
	);
	ipcMain.handle(
		"vetta:abilities:install-open-ability",
		async (_event, type: unknown, slug: unknown, sourceId: unknown) => {
			if ((type !== "skill" && type !== "scene" && type !== "plugin") || typeof slug !== "string" || !slug.trim()) {
				throw new Error("installOpenAbility requires a skill/scene/plugin type and non-empty slug");
			}
			const resolvedSourceId = sourceId === undefined ? undefined : requireString(sourceId, "sourceId");
			await openMarketplace.install(type, slug, resolvedSourceId);
		},
	);

	// 市场 MCP 装完后补记台账：mcp.json 由渲染层整份覆写，主进程无从得知市场版本。
	// 只接受确实已写进 mcp.json 的 server，避免渲染层写出幽灵条目。
	ipcMain.handle(
		"vetta:abilities:record-mcp-install",
		async (_event, runtimeName: unknown, version: unknown, metadata: unknown) => {
			if (typeof runtimeName !== "string" || typeof version !== "string") {
				throw new Error("recordMcpInstall requires runtimeName and version strings");
			}
			if (!runtimeName.trim() || !version.trim()) return;
			const parsedMetadata = parseMcpInstallMetadata(metadata);
			if (parsedMetadata?.runtimeName && parsedMetadata.runtimeName !== runtimeName) {
				throw new Error("metadata.runtimeName must match runtimeName");
			}
			const config = await readMcpConfig();
			if (!config.mcpServers[runtimeName]) return;
			recordAbilityInstall("mcp", runtimeName, version, {
				...parsedMetadata,
				runtimeName,
			});
		},
	);

	return () => {
		unsubscribeFromUpdates();
		ipcMain.removeHandler("vetta:abilities:get-ledger");
		ipcMain.removeHandler("vetta:abilities:record-mcp-install");
		ipcMain.removeHandler("vetta:abilities:list-open-marketplace");
		ipcMain.removeHandler("vetta:abilities:refresh-open-marketplace");
		ipcMain.removeHandler("vetta:abilities:list-open-marketplaces");
		ipcMain.removeHandler("vetta:abilities:refresh-open-marketplaces");
		ipcMain.removeHandler("vetta:abilities:list-marketplace-sources");
		ipcMain.removeHandler("vetta:abilities:add-marketplace-source");
		ipcMain.removeHandler("vetta:abilities:update-marketplace-source");
		ipcMain.removeHandler("vetta:abilities:remove-marketplace-source");
		ipcMain.removeHandler("vetta:abilities:refresh-marketplace-source");
		ipcMain.removeHandler("vetta:abilities:install-open-ability");
	};
}
