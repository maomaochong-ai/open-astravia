import { randomUUID } from "node:crypto";
import type {
	ArtifactRef,
	CapabilityJsonMap,
	Disposable,
	Job,
	JobFailure,
	JobProgress,
	JobStatus,
} from "@vetta/capability-sdk";

const TERMINAL_STATUSES = new Set<JobStatus>(["succeeded", "failed", "cancelled"]);

export interface ManagedJobUpdate {
	status: JobStatus;
	progress?: JobProgress;
	artifacts?: readonly ArtifactRef[];
	error?: JobFailure;
}

export interface ManagedJobDriver {
	refresh?(signal: AbortSignal): Promise<ManagedJobUpdate>;
	cancel?(signal: AbortSignal): Promise<ManagedJobUpdate>;
}

export interface ManagedJobDefinition extends ManagedJobUpdate {
	ownerId: string;
	domain: string;
	operation: string;
	metadata?: CapabilityJsonMap;
	driver?: ManagedJobDriver;
}

interface JobRecord {
	ownerId: string;
	job: Job;
	driver?: ManagedJobDriver;
}

export class JobManager {
	private readonly records = new Map<string, JobRecord>();
	private readonly listeners = new Map<string, Set<(job: Job) => void>>();

	create(definition: ManagedJobDefinition): Job {
		const id = randomUUID();
		const job: Job = {
			id,
			domain: definition.domain,
			operation: definition.operation,
			status: definition.status,
			artifacts: [...(definition.artifacts ?? [])],
			...(definition.progress ? { progress: { ...definition.progress } } : {}),
			...(definition.metadata ? { metadata: { ...definition.metadata } } : {}),
			...(definition.error ? { error: { ...definition.error } } : {}),
		};
		this.records.set(id, { ownerId: definition.ownerId, job, driver: definition.driver });
		return this.clone(job);
	}

	async get(ownerId: string, id: string, signal: AbortSignal): Promise<Job> {
		const record = this.requireRecord(ownerId, id);
		if (!TERMINAL_STATUSES.has(record.job.status) && record.driver?.refresh) {
			this.apply(record, await record.driver.refresh(signal));
		}
		return this.clone(record.job);
	}

	async cancel(ownerId: string, id: string, signal: AbortSignal): Promise<Job> {
		const record = this.requireRecord(ownerId, id);
		if (TERMINAL_STATUSES.has(record.job.status)) return this.clone(record.job);
		if (!record.driver?.cancel) throw new Error(`Job does not support cancellation: ${id}`);
		this.apply(record, await record.driver.cancel(signal));
		return this.clone(record.job);
	}

	subscribe(ownerId: string, id: string, listener: (job: Job) => void): Disposable {
		this.requireRecord(ownerId, id);
		const listeners = this.listeners.get(id) ?? new Set();
		listeners.add(listener);
		this.listeners.set(id, listeners);
		return {
			dispose: () => {
				listeners.delete(listener);
				if (listeners.size === 0) this.listeners.delete(id);
			},
		};
	}

	disposeOwner(ownerId: string): void {
		for (const [id, record] of this.records) {
			if (record.ownerId !== ownerId) continue;
			this.records.delete(id);
			this.listeners.delete(id);
		}
	}

	dispose(): void {
		this.records.clear();
		this.listeners.clear();
	}

	private apply(record: JobRecord, update: ManagedJobUpdate): void {
		const next: Job = {
			...record.job,
			status: update.status,
			artifacts: [...(update.artifacts ?? record.job.artifacts)],
			...(update.progress ? { progress: { ...update.progress } } : {}),
			...(update.error ? { error: { ...update.error } } : {}),
		};
		record.job = next;
		for (const listener of this.listeners.get(next.id) ?? []) listener(this.clone(next));
	}

	private requireRecord(ownerId: string, id: string): JobRecord {
		const record = this.records.get(id);
		if (!record || record.ownerId !== ownerId) throw new Error(`Job is unavailable: ${id}`);
		return record;
	}

	private clone(job: Job): Job {
		return {
			...job,
			artifacts: job.artifacts.map((artifact) => ({ ...artifact })),
			progress: job.progress ? { ...job.progress } : undefined,
			metadata: job.metadata ? { ...job.metadata } : undefined,
			error: job.error ? { ...job.error } : undefined,
		};
	}
}
