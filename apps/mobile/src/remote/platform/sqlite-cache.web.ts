import { MemorySessionCache } from "../cache";

/** Web export keeps the cache in memory; see stores.web.ts. */
export class SqliteSessionCache extends MemorySessionCache {}
