/**
 * 画布位图的跨会话缓存。
 *
 * 位图本身是 useFrameRasters 的组件 state，画布一关就没了——于是每次进画布都要把
 * 全部 frame 重新挂 iframe、渲染、截图一遍，二十帧的设计稿就是二十帧一起转圈，
 * 挨个消解。缓存的作用是让上一次的成果先顶上：进画布立刻有画面，刷新在后台跑。
 *
 * 为什么是 IndexedDB 而不是 ctx.storage：位图是纯派生数据，必须能删（frame 删了、
 * 设计稿删了），而 storage API 只有 readJson/writeJson/putBlob 一类的写入口，没有
 * 删除能力，拿它做缓存等于让磁盘只涨不落。也不写进 sidecar 的 .snapshots/——那是
 * 用户项目里的目录，几 MB 的派生位图不该落在那儿。
 */

const DB_NAME = "vetta-ui-design";
const STORE = "rasters";
const DB_VERSION = 1;

/** `${vetdPath}::${frameId}`——设计文档之间天然隔离，同一份里按 frame 取。 */
function keyOf(vetdPath: string, frameId: string): string {
	return `${vetdPath}::${frameId}`;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise<IDBDatabase | null>((resolve) => {
		try {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
			};
			request.onsuccess = () => resolve(request.result);
			// 缓存不可用不该让画布挂掉：隐私模式、配额耗尽都可能走到这里，
			// 退回「每次进画布重新截」的老行为即可。
			request.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
	return dbPromise;
}

function runStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
	return openDb().then(
		(db) =>
			new Promise<T | null>((resolve) => {
				if (!db) return resolve(null);
				try {
					const request = run(db.transaction(STORE, mode).objectStore(STORE));
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => resolve(null);
				} catch {
					resolve(null);
				}
			}),
	);
}

/** 读回这份设计稿已缓存的位图。缺失/失败一律当作没有缓存。 */
export async function loadRasters(
	vetdPath: string,
	frameIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
	const found = new Map<string, string>();
	await Promise.all(
		frameIds.map(async (frameId) => {
			const value = await runStore<unknown>("readonly", (store) => store.get(keyOf(vetdPath, frameId)));
			if (typeof value === "string") found.set(frameId, value);
		}),
	);
	return found;
}

export async function saveRaster(vetdPath: string, frameId: string, dataUrl: string): Promise<void> {
	await runStore("readwrite", (store) => store.put(dataUrl, keyOf(vetdPath, frameId)));
}

/**
 * 删掉这份设计稿里已经不存在的 frame 的位图。只在打开设计稿时对账一次：删 frame 的
 * 那一刻不清，反正下次打开就收掉了，而画布运行期间反复扫全库不值当。
 *
 * 整份设计稿被删除的情况不处理——没有全局索引就无从知道哪些 vetdPath 已经不在了，
 * 为几百 KB 的条目维护一张索引不划算。
 */
export async function pruneRasters(vetdPath: string, keep: readonly string[]): Promise<void> {
	const alive = new Set(keep.map((frameId) => keyOf(vetdPath, frameId)));
	const prefix = `${vetdPath}::`;
	const keys = await runStore<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
	if (!keys) return;
	await Promise.all(
		keys.map(async (key) => {
			if (typeof key !== "string" || !key.startsWith(prefix) || alive.has(key)) return;
			await runStore("readwrite", (store) => store.delete(key));
		}),
	);
}
