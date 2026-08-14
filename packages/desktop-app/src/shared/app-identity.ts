/**
 * Electron `app.getName()` 的唯一事实源。
 *
 * safeStorage 的主密钥按 app 名字定位（macOS 钥匙串条目 `<name> Safe Storage`），
 * 名字不同即是两把互不通用的密钥：同一份密文只能被写入它的那一侧解开。
 * 因此打包版 asar 内 `package.json#name`（`scripts/prepare-pack.js`）与开发态的
 * `app.name` 覆盖必须始终相等，否则 `bun run dev:home` 虽然共享 `~/.vetta`
 * 目录，却读不出打包版写入的 API key，并会用开发态密钥覆盖它。
 * 一致性由 `app-identity.test.ts` 机械校验。
 *
 * 修改此常量会让所有存量用户已保存的凭据无法解密，必须同时提供迁移方案。
 */
export const APP_RUNTIME_NAME = "vetta";
