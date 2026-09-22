import { MemoryKeyValueStore } from "../pairing-store";

/** Web export has no keychain or SQLite; it is a CI smoke target, not a product surface. */
export class SecureKeyValueStore extends MemoryKeyValueStore {}
export class SettingsKeyValueStore extends MemoryKeyValueStore {}
