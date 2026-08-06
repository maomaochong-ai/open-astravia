import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import type {
	AddMarketplaceSourceInput,
	MarketplaceSource,
	UpdateMarketplaceSourceInput,
} from "../../../preload/api-types/abilities.js";
import { DEFAULT_MARKETPLACE_SOURCE_ID } from "./open-marketplace-service.js";

const SOURCE_FILE_VERSION = 1;
const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,95}$/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

interface MarketplaceSourceFile {
	version: typeof SOURCE_FILE_VERSION;
	sources: MarketplaceSource[];
}

export interface MarketplaceSourceStoreOptions {
	filePath?: string;
	now?: () => Date;
	defaultSources?: MarketplaceSource[];
}

function repositoryName(repository: string): string {
	return repository.split("/").at(-1) ?? repository;
}

export function normalizeGitHubRepository(value: string): string {
	const trimmed = value
		.trim()
		.replace(/\.git$/i, "")
		.replace(/\/$/, "");
	const shorthand = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
	if (shorthand) return `https://github.com/${shorthand[1]}/${shorthand[2]}`;
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error("Marketplace repository must be a GitHub owner/repo or URL");
	}
	if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
		throw new Error("Marketplace repository must use https://github.com");
	}
	const segments = parsed.pathname.split("/").filter(Boolean);
	if (segments.length !== 2 || !segments[0] || !segments[1]) {
		throw new Error("Marketplace repository URL must identify exactly one repository");
	}
	return `https://github.com/${segments[0]}/${segments[1]}`;
}

export function marketplaceArchiveUrl(repository: string, ref: string): string {
	return `${repository}/archive/refs/heads/${ref.split("/").map(encodeURIComponent).join("/")}.zip`;
}

function validateRef(value: string | undefined): string {
	const ref = value?.trim() || "main";
	if (!REF_PATTERN.test(ref) || ref.includes("..") || ref.startsWith("/") || ref.endsWith("/")) {
		throw new Error("Marketplace ref is invalid");
	}
	return ref;
}

function sourceIdForRepository(repository: string): string {
	const path = new URL(repository).pathname
		.slice(1)
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-");
	return `github-${path}`.slice(0, 96);
}

function parseSource(value: unknown): MarketplaceSource | null {
	if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
	const source = value as Record<string, unknown>;
	if (
		typeof source.id !== "string" ||
		typeof source.name !== "string" ||
		source.type !== "github" ||
		typeof source.repository !== "string" ||
		typeof source.archiveUrl !== "string" ||
		typeof source.ref !== "string" ||
		typeof source.enabled !== "boolean" ||
		typeof source.builtin !== "boolean" ||
		typeof source.autoUpdate !== "boolean" ||
		typeof source.priority !== "number" ||
		typeof source.createdAt !== "string" ||
		typeof source.updatedAt !== "string"
	) {
		return null;
	}
	if (
		!SOURCE_ID_PATTERN.test(source.id) ||
		!source.name.trim() ||
		!Number.isFinite(source.priority) ||
		!Number.isInteger(source.priority)
	) {
		return null;
	}
	try {
		const repository = normalizeGitHubRepository(source.repository);
		const ref = validateRef(source.ref);
		return {
			id: source.id,
			name: source.name.trim(),
			type: "github",
			repository,
			archiveUrl: source.builtin ? source.archiveUrl : marketplaceArchiveUrl(repository, ref),
			ref,
			enabled: source.enabled,
			builtin: source.builtin,
			autoUpdate: source.autoUpdate,
			priority: source.priority,
			createdAt: source.createdAt,
			updatedAt: source.updatedAt,
		};
	} catch {
		return null;
	}
}

function createDefaultSources(now: Date): MarketplaceSource[] {
	const configuredRepository = process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY?.trim();
	if (!configuredRepository) return [];
	const normalizedRepository = normalizeGitHubRepository(configuredRepository);
	const ref = validateRef(process.env.VETTA_OPEN_MARKETPLACE_REF);
	const timestamp = now.toISOString();
	return [
		{
			id: DEFAULT_MARKETPLACE_SOURCE_ID,
			name: repositoryName(normalizedRepository),
			type: "github",
			repository: normalizedRepository,
			archiveUrl: process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL ?? marketplaceArchiveUrl(normalizedRepository, ref),
			ref,
			enabled: true,
			builtin: true,
			autoUpdate: true,
			priority: 100,
			createdAt: timestamp,
			updatedAt: timestamp,
		},
	];
}

export class MarketplaceSourceStore {
	private readonly filePath: string;
	private readonly now: () => Date;
	private readonly defaultSources: MarketplaceSource[];

	constructor(options: MarketplaceSourceStoreOptions = {}) {
		this.filePath = options.filePath ?? join(getVettaHomePath(), "open-marketplaces", "sources.json");
		this.now = options.now ?? (() => new Date());
		this.defaultSources = options.defaultSources ?? createDefaultSources(this.now());
	}

	list(): MarketplaceSource[] {
		const file = this.readFile();
		if (file) {
			const configuredBuiltins = this.defaultSources.filter((source) => source.builtin);
			const configuredBuiltinIds = new Set(configuredBuiltins.map((source) => source.id));
			const sources = file.sources.filter((source) => !source.builtin || configuredBuiltinIds.has(source.id));
			let changed = sources.length !== file.sources.length;
			for (const configured of configuredBuiltins) {
				const index = sources.findIndex((source) => source.id === configured.id);
				const current = sources[index];
				if (!current) {
					sources.push({ ...configured });
					changed = true;
					continue;
				}
				if (
					current.name !== configured.name ||
					current.repository !== configured.repository ||
					current.archiveUrl !== configured.archiveUrl ||
					current.ref !== configured.ref ||
					current.priority !== configured.priority ||
					!current.builtin
				) {
					sources[index] = {
						...current,
						name: configured.name,
						repository: configured.repository,
						archiveUrl: configured.archiveUrl,
						ref: configured.ref,
						builtin: true,
						priority: configured.priority,
						updatedAt: this.now().toISOString(),
					};
					changed = true;
				}
			}
			if (changed) this.writeFile(sources);
			return sources.sort((a, b) => a.priority - b.priority);
		}
		const sources = this.defaultSources.map((source) => ({ ...source }));
		this.writeFile(sources);
		return sources;
	}

	add(input: AddMarketplaceSourceInput): MarketplaceSource {
		const sources = this.list();
		const repository = normalizeGitHubRepository(input.repository);
		if (sources.some((source) => source.repository.toLowerCase() === repository.toLowerCase())) {
			throw new Error(`Marketplace source already exists: ${repository}`);
		}
		const ref = validateRef(input.ref);
		const id = sourceIdForRepository(repository);
		if (sources.some((source) => source.id === id)) {
			throw new Error(`Marketplace source id already exists: ${id}`);
		}
		const timestamp = this.now().toISOString();
		const source: MarketplaceSource = {
			id,
			name: input.name?.trim() || repositoryName(repository),
			type: "github",
			repository,
			archiveUrl: marketplaceArchiveUrl(repository, ref),
			ref,
			enabled: true,
			builtin: false,
			autoUpdate: true,
			priority: Math.max(1000, ...sources.map((item) => item.priority + 10)),
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.writeFile([...sources, source]);
		return source;
	}

	update(id: string, input: UpdateMarketplaceSourceInput): MarketplaceSource {
		const sources = this.list();
		const index = sources.findIndex((source) => source.id === id);
		const current = sources[index];
		if (index < 0 || !current) throw new Error(`Marketplace source not found: ${id}`);
		if (current.builtin && (input.name !== undefined || input.ref !== undefined)) {
			throw new Error("Built-in marketplace source configuration cannot be changed");
		}
		const ref = input.ref === undefined ? current.ref : validateRef(input.ref);
		const next: MarketplaceSource = {
			...current,
			...(input.name?.trim() ? { name: input.name.trim() } : {}),
			...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
			...(input.autoUpdate !== undefined ? { autoUpdate: input.autoUpdate } : {}),
			ref,
			archiveUrl: ref === current.ref ? current.archiveUrl : marketplaceArchiveUrl(current.repository, ref),
			updatedAt: this.now().toISOString(),
		};
		sources[index] = next;
		this.writeFile(sources);
		return next;
	}

	remove(id: string): void {
		const sources = this.list();
		const current = sources.find((source) => source.id === id);
		if (!current) return;
		if (current.builtin) throw new Error("Built-in marketplace sources cannot be removed");
		this.writeFile(sources.filter((source) => source.id !== id));
	}

	private readFile(): MarketplaceSourceFile | null {
		if (!existsSync(this.filePath)) return null;
		try {
			const raw: unknown = JSON.parse(readFileSync(this.filePath, "utf-8"));
			if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
			const file = raw as Record<string, unknown>;
			if (file.version !== SOURCE_FILE_VERSION || !Array.isArray(file.sources)) return null;
			const sources = file.sources.map(parseSource).filter((source): source is MarketplaceSource => source !== null);
			return { version: SOURCE_FILE_VERSION, sources };
		} catch {
			return null;
		}
	}

	private writeFile(sources: MarketplaceSource[]): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		atomicWriteJSON(this.filePath, { version: SOURCE_FILE_VERSION, sources });
	}
}
