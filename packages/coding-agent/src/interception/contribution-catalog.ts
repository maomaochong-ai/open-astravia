export interface ContributionKey {
	readonly sourceId: string;
	readonly localId: string;
}

export interface ContributionRegistration<T> extends ContributionKey {
	readonly revision: string;
	readonly order: number;
	readonly value: T;
}

export interface SourceContribution<T> {
	readonly localId: string;
	readonly order: number;
	readonly value: T;
}

export interface ContributionLease {
	release(): void;
}

interface RegisteredContribution<T> {
	readonly generation: symbol;
	readonly registration: ContributionRegistration<T>;
}

/**
 * Coding Agent 产品级动态贡献目录。
 *
 * 修改面使用 generation-safe lease，读取面只暴露稳定排序的不可变快照。
 * 单次 dispatch 保存 snapshot 后，不受并发注册、替换或释放影响。
 */
export class DynamicContributionCatalog<T> {
	private readonly entries = new Map<string, RegisteredContribution<T>>();

	register(registration: ContributionRegistration<T>): ContributionLease {
		const generation = Symbol(`${registration.sourceId}/${registration.localId}`);
		const key = contributionMapKey(registration);
		this.entries.set(key, { generation, registration });
		return createLease(() => {
			if (this.entries.get(key)?.generation === generation) this.entries.delete(key);
		});
	}

	replaceSource(
		sourceId: string,
		revision: string,
		contributions: readonly SourceContribution<T>[],
	): ContributionLease {
		const generation = Symbol(sourceId);
		const nextLocalIds = new Set(contributions.map((contribution) => contribution.localId));

		for (const [key, entry] of this.entries) {
			if (entry.registration.sourceId === sourceId && !nextLocalIds.has(entry.registration.localId)) {
				this.entries.delete(key);
			}
		}
		for (const contribution of contributions) {
			const registration: ContributionRegistration<T> = {
				sourceId,
				localId: contribution.localId,
				revision,
				order: contribution.order,
				value: contribution.value,
			};
			this.entries.set(contributionMapKey(registration), { generation, registration });
		}

		return createLease(() => {
			for (const [key, entry] of this.entries) {
				if (entry.registration.sourceId === sourceId && entry.generation === generation) {
					this.entries.delete(key);
				}
			}
		});
	}

	snapshot(): readonly ContributionRegistration<T>[] {
		return [...this.entries.values()]
			.map(({ registration }) => registration)
			.sort(
				(left, right) =>
					left.order - right.order ||
					left.sourceId.localeCompare(right.sourceId) ||
					left.localId.localeCompare(right.localId),
			);
	}
}

function contributionMapKey(key: ContributionKey): string {
	return `${key.sourceId}\0${key.localId}`;
}

function createLease(release: () => void): ContributionLease {
	let released = false;
	return {
		release: () => {
			if (released) return;
			released = true;
			release();
		},
	};
}
