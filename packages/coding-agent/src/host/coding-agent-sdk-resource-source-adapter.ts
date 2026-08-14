import { dirname, join, resolve } from "node:path";
import type {
	CodingAgentExtensionSource,
	CodingAgentExtensionSourceSnapshot,
	CodingAgentResourceContributions,
	CodingAgentSkillContribution,
	CodingAgentSkillInfo,
	CodingAgentSkillPolicy,
	CodingAgentSkillSelector,
	CodingAgentSkillSource,
	CodingAgentSkillSourceSnapshot,
} from "../public-api/sdk/index.js";
import type { ResourceDiagnostic } from "../resources/contracts/diagnostics.js";
import type { Skill } from "../resources/skills/index.js";

interface SkillSourceBinding {
	readonly kind: "skill";
	readonly source: CodingAgentSkillSource;
	snapshot: CodingAgentSkillSourceSnapshot | undefined;
	invalidation: number;
	loadedInvalidation: number;
	unsubscribe: (() => void) | undefined;
}

interface ExtensionSourceBinding {
	readonly kind: "extension";
	readonly source: CodingAgentExtensionSource;
	snapshot: CodingAgentExtensionSourceSnapshot | undefined;
	invalidation: number;
	loadedInvalidation: number;
	unsubscribe: (() => void) | undefined;
}

type ResourceSourceBinding = SkillSourceBinding | ExtensionSourceBinding;

export interface CodingAgentSdkResourceSourceAdapterOptions {
	readonly cwd: string;
	readonly resources?: CodingAgentResourceContributions;
	readonly skillSources?: readonly CodingAgentSkillSource[];
	readonly extensionSources?: readonly CodingAgentExtensionSource[];
}

export interface CodingAgentSdkResourceRefreshResult {
	readonly skillsChanged: boolean;
	readonly extensionsChanged: boolean;
}

/**
 * 稳定 SDK 动态资源来源到现有产品 ResourceLoader 的宿主适配状态。
 *
 * Source 只负责报告失效和提供带 revision 的值；当前 Turn 不会被订阅回调直接修改。
 */
export class CodingAgentSdkResourceSourceAdapter {
	readonly id = "sdk-resource-sources";
	private readonly skillBindings: SkillSourceBinding[];
	private readonly extensionBindings: ExtensionSourceBinding[];
	private operation: Promise<void> = Promise.resolve();
	private closing = false;
	private disposed = false;
	private readonly disposedSources = new Set<ResourceSourceBinding>();

	private constructor(private readonly options: CodingAgentSdkResourceSourceAdapterOptions) {
		this.skillBindings = (options.skillSources ?? []).map((source) => ({
			kind: "skill",
			source,
			snapshot: undefined,
			invalidation: 0,
			loadedInvalidation: -1,
			unsubscribe: undefined,
		}));
		this.extensionBindings = (options.extensionSources ?? []).map((source) => ({
			kind: "extension",
			source,
			snapshot: undefined,
			invalidation: 0,
			loadedInvalidation: -1,
			unsubscribe: undefined,
		}));
		assertUniqueSourceIds(this.skillBindings, "Skill");
		assertUniqueSourceIds(this.extensionBindings, "Extension");
	}

	static async create(
		options: CodingAgentSdkResourceSourceAdapterOptions,
	): Promise<CodingAgentSdkResourceSourceAdapter> {
		const adapter = new CodingAgentSdkResourceSourceAdapter(options);
		try {
			adapter.subscribe();
			await adapter.readBindings([...adapter.skillBindings, ...adapter.extensionBindings]);
			return adapter;
		} catch (error) {
			try {
				await adapter.dispose();
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "SDK resource source initialization and cleanup failed");
			}
			throw error;
		}
	}

	readSkillPaths(): readonly string[] {
		return dedupe([
			...(this.options.resources?.skillPaths ?? []),
			...this.skillBindings.flatMap(({ snapshot }) => snapshot?.paths ?? []),
		]);
	}

	readExtensionPaths(): readonly string[] {
		return dedupe([
			...(this.options.resources?.extensionPaths ?? []),
			...this.extensionBindings.flatMap(({ snapshot }) => snapshot?.paths ?? []),
		]);
	}

	transformSkills(base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }): {
		skills: Skill[];
		diagnostics: ResourceDiagnostic[];
	} {
		const skills = new Map(base.skills.map((skill) => [skill.name, skill]));
		for (const contribution of this.options.resources?.skills ?? []) {
			skills.set(contribution.name, toSkill(contribution, "sdk", this.options.cwd));
		}
		for (const { source, snapshot } of this.skillBindings) {
			for (const contribution of snapshot?.skills ?? []) {
				skills.set(contribution.name, toSkill(contribution, `sdk:${source.id}`, this.options.cwd));
			}
		}
		let resolved = [...skills.values()];
		for (const policy of this.readSkillPolicies()) resolved = applySkillPolicy(resolved, policy);
		return { skills: resolved, diagnostics: base.diagnostics };
	}

	refreshInvalidated(): Promise<CodingAgentSdkResourceRefreshResult> {
		return this.enqueueRefresh(() =>
			this.readBindings(
				[...this.skillBindings, ...this.extensionBindings].filter(
					(binding) => binding.invalidation !== binding.loadedInvalidation,
				),
			),
		);
	}

	refreshAll(): Promise<CodingAgentSdkResourceRefreshResult> {
		return this.enqueueRefresh(() => this.readBindings([...this.skillBindings, ...this.extensionBindings]));
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.closing = true;
		for (const binding of [...this.skillBindings, ...this.extensionBindings]) {
			binding.unsubscribe?.();
			binding.unsubscribe = undefined;
		}
		await this.operation;
		const errors: unknown[] = [];
		for (const binding of [...this.skillBindings, ...this.extensionBindings]) {
			if (this.disposedSources.has(binding)) continue;
			try {
				await binding.source.dispose?.();
				this.disposedSources.add(binding);
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length > 0) throw new AggregateError(errors, "Failed to dispose SDK resource sources");
		this.disposed = true;
	}

	private subscribe(): void {
		for (const binding of [...this.skillBindings, ...this.extensionBindings]) {
			binding.unsubscribe = binding.source.subscribe?.(() => {
				if (!this.closing) binding.invalidation += 1;
			});
		}
	}

	private enqueueRefresh(
		operation: () => Promise<CodingAgentSdkResourceRefreshResult>,
	): Promise<CodingAgentSdkResourceRefreshResult> {
		if (this.closing) return Promise.reject(new Error("SDK resource sources are closed"));
		const result = this.operation.then(operation, operation);
		this.operation = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private async readBindings(
		bindings: readonly ResourceSourceBinding[],
	): Promise<CodingAgentSdkResourceRefreshResult> {
		let skillsChanged = false;
		let extensionsChanged = false;
		for (const binding of bindings) {
			const invalidation = binding.invalidation;
			try {
				if (binding.kind === "skill") {
					const next = cloneSkillSnapshot(await binding.source.read());
					skillsChanged ||= binding.snapshot !== undefined && !Object.is(binding.snapshot.revision, next.revision);
					binding.snapshot = next;
				} else {
					const next = cloneExtensionSnapshot(await binding.source.read());
					extensionsChanged ||=
						binding.snapshot !== undefined && !Object.is(binding.snapshot.revision, next.revision);
					binding.snapshot = next;
				}
				binding.loadedInvalidation = invalidation;
			} catch (error) {
				binding.loadedInvalidation = invalidation - 1;
				throw error;
			}
		}
		return { skillsChanged, extensionsChanged };
	}

	private readSkillPolicies(): readonly CodingAgentSkillPolicy[] {
		return [
			...(this.options.resources?.skillPolicy ? [this.options.resources.skillPolicy] : []),
			...this.skillBindings.flatMap(({ snapshot }) => (snapshot?.policy ? [snapshot.policy] : [])),
		];
	}
}

export function projectCodingAgentSkillInfo(skill: Skill): CodingAgentSkillInfo {
	return {
		name: skill.name,
		alias: skill.alias,
		description: skill.description,
		source: skill.source,
		type: skill.type,
		disableModelInvocation: skill.disableModelInvocation,
	};
}

function toSkill(contribution: CodingAgentSkillContribution, source: string, cwd: string): Skill {
	const filePath = contribution.filePath
		? resolve(cwd, contribution.filePath)
		: join(cwd, ".vetta", "sdk-skills", safePathSegment(source), safePathSegment(contribution.name), "SKILL.md");
	return {
		name: contribution.name,
		alias: contribution.alias,
		description: contribution.description,
		filePath,
		baseDir: contribution.baseDir ? resolve(cwd, contribution.baseDir) : dirname(filePath),
		source,
		type: contribution.type ?? "skill",
		disableModelInvocation: contribution.disableModelInvocation ?? false,
		content: contribution.content,
	};
}

function applySkillPolicy(skills: readonly Skill[], policy: CodingAgentSkillPolicy): Skill[] {
	return skills.filter((skill) => {
		if (policy.include && !matchesSelector(skill, policy.include)) return false;
		return !(policy.exclude && matchesSelector(skill, policy.exclude));
	});
}

function matchesSelector(skill: Skill, selector: CodingAgentSkillSelector): boolean {
	if (selector.names && !selector.names.includes(skill.name)) return false;
	if (selector.nameContains && !selector.nameContains.some((fragment) => skill.name.includes(fragment))) return false;
	if (selector.sources && !selector.sources.includes(skill.source)) return false;
	if (selector.types && !selector.types.includes(skill.type)) return false;
	return true;
}

function cloneSkillSnapshot(snapshot: CodingAgentSkillSourceSnapshot): CodingAgentSkillSourceSnapshot {
	return {
		revision: snapshot.revision,
		paths: snapshot.paths ? [...snapshot.paths] : undefined,
		skills: snapshot.skills?.map((skill) => ({
			...skill,
			// agentModes 已废弃（ADR-0071）：无消费者，仅为快照不可变而拷贝容忍字段。
			agentModes: skill.agentModes ? [...skill.agentModes] : undefined,
		})),
		policy: cloneSkillPolicy(snapshot.policy),
	};
}

function cloneExtensionSnapshot(snapshot: CodingAgentExtensionSourceSnapshot): CodingAgentExtensionSourceSnapshot {
	return { revision: snapshot.revision, paths: [...snapshot.paths] };
}

function cloneSkillPolicy(policy: CodingAgentSkillPolicy | undefined): CodingAgentSkillPolicy | undefined {
	if (!policy) return undefined;
	return {
		include: cloneSelector(policy.include),
		exclude: cloneSelector(policy.exclude),
	};
}

function cloneSelector(selector: CodingAgentSkillSelector | undefined): CodingAgentSkillSelector | undefined {
	if (!selector) return undefined;
	return {
		names: selector.names ? [...selector.names] : undefined,
		nameContains: selector.nameContains ? [...selector.nameContains] : undefined,
		sources: selector.sources ? [...selector.sources] : undefined,
		types: selector.types ? [...selector.types] : undefined,
	};
}

function assertUniqueSourceIds(bindings: readonly ResourceSourceBinding[], label: "Skill" | "Extension"): void {
	const ids = new Set<string>();
	for (const { source } of bindings) {
		if (!source.id.trim()) throw new Error(`${label} source id must not be empty`);
		if (ids.has(source.id)) throw new Error(`Duplicate ${label} source id: ${source.id}`);
		ids.add(source.id);
	}
}

function dedupe(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function safePathSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
