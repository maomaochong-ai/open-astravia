import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";

const CACHE_NAMESPACE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEMPORARY_PREFIX_PATTERN = /^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/;

function isContained(parent: string, target: string): boolean {
	const pathFromParent = relative(parent, target);
	return (
		pathFromParent === "" ||
		(!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent))
	);
}

function assertNamespace(namespace: string): void {
	if (!CACHE_NAMESPACE_PATTERN.test(namespace)) throw new Error(`Invalid cache namespace: ${namespace}`);
}

function assertPathPart(part: string): void {
	if (!part || part.includes("\0") || isAbsolute(part)) throw new Error(`Invalid cache path part: ${part}`);
}

/** 一个业务领域在应用通用缓存根目录下的隔离空间。 */
export class ApplicationCacheNamespace {
	readonly rootDir: string;
	readonly temporaryRootDir: string;

	constructor(
		applicationCacheRoot: string,
		readonly name: string,
	) {
		assertNamespace(name);
		this.rootDir = resolve(applicationCacheRoot, name);
		this.temporaryRootDir = resolve(applicationCacheRoot, ".temp", name);
	}

	path(...parts: string[]): string {
		for (const part of parts) assertPathPart(part);
		const target = resolve(this.rootDir, ...parts);
		if (!isContained(this.rootDir, target)) throw new Error(`Cache path escapes namespace: ${parts.join("/")}`);
		return target;
	}

	async ensure(): Promise<void> {
		await mkdir(this.rootDir, { recursive: true });
	}

	async createTemporaryDirectory(prefix = "work"): Promise<string> {
		if (!TEMPORARY_PREFIX_PATTERN.test(prefix)) throw new Error(`Invalid cache temporary prefix: ${prefix}`);
		await mkdir(this.temporaryRootDir, { recursive: true });
		return mkdtemp(join(this.temporaryRootDir, `${prefix}-`));
	}

	/** 仅清除此命名空间的可重建内容，不影响其他缓存或正式安装目录。 */
	async clear(): Promise<void> {
		await Promise.all([
			rm(this.rootDir, { recursive: true, force: true }),
			rm(this.temporaryRootDir, { recursive: true, force: true }),
		]);
	}
}

/** 主进程通用缓存入口；业务模块必须通过独立 namespace 使用。 */
export class ApplicationCacheService {
	readonly rootDir: string;

	constructor(rootDir = join(getVettaHomePath(), "cache")) {
		this.rootDir = resolve(rootDir);
	}

	namespace(name: string): ApplicationCacheNamespace {
		return new ApplicationCacheNamespace(this.rootDir, name);
	}
}

let desktopApplicationCacheService: ApplicationCacheService | undefined;

export function getApplicationCacheService(): ApplicationCacheService {
	desktopApplicationCacheService ??= new ApplicationCacheService();
	return desktopApplicationCacheService;
}
