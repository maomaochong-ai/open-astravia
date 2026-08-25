# 新增 Monorepo 包（TypeScript workspace）

先确定归属：可交付的应用放 `apps/*`，可复用模块放 `packages/*`（见 [`AGENTS.md`](../AGENTS.md) 的目录约定）。本文以新增 `packages/*` 下的 `@vetta/*` 包为例；放到 `apps/*` 时把下文路径中的 `packages` 换成 `apps` 即可。

新增包时**不能只改包目录**。漏接 TypeScript path map 是常见问题：有 `dist/` 时类型检查看起来正常，干净树或未 build 时出现 `TS2307 Cannot find module '@vetta/…'`。

## Checklist

### 1. 包 scaffold（`packages/<name>/`）

- `package.json`：`name`（`@vetta/<name>`）、`type: "module"`、`main` / `types` / `exports` 指向 `dist/`、`scripts.build`（通常 `tsgo -p tsconfig.build.json`）
- `tsconfig.build.json`：extend `../../tsconfig.base.json`，配置 `rootDir` / `outDir`，`include: ["src/**/*.ts"]`
- `src/` 与公开入口（`index.ts` 及 subpath exports）
- 可选：`README.md`、`CHANGELOG.md`

### 2. Workspace 注册

- 根目录 `package.json` → `workspaces` 增加 `"packages/<name>"`（或嵌套路径）
- 执行 `bun install`，消费方使用 `"@vetta/<name>": "workspace:*"`

### 3. TypeScript path maps（指向源码，不是 dist）— **最易漏**

类型检查应解析 **源码**，与其它 `@vetta/*` 包一致。不要只依赖 `package.json` → `dist/*.d.ts`。

| 文件 | 需要添加 |
|------|----------|
| 根 `tsconfig.json` → `compilerOptions.paths` | `"@vetta/<name>": ["./packages/<name>/src/index.ts"]`，`"@vetta/<name>/*": ["./packages/<name>/src/*"]` |
| 根 `tsconfig.json` → `include` | `"packages/<name>/src/**/*"`（若有测试一并加入） |
| `apps/desktop/tsconfig.json` → `paths` | **仅当** desktop 引用该包时：`"@vetta/<name>": ["../../packages/<name>/src/index.ts"]`，`"@vetta/<name>/*": ["../../packages/<name>/src/*"]` |

其它自带 `paths` 的消费方（若有）同样处理。

**原因：** 根 `tsgo --noEmit` 与 desktop `tsc` 走这些 map。未配置时，只有存在 `dist/` 才像正常；clean checkout 会挂。

### 4. 构建顺序

- 不维护手写构建 layer。包提供 `scripts.build`，并在正确的 `dependencies`、`optionalDependencies`、`peerDependencies` 或 `devDependencies` 中声明内部 workspace 依赖；Turborepo 从 manifest 推导任务顺序。
- 新包需要参与某个产品构建时，优先让该产品通过真实 workspace 依赖引用它；只有构建期工具等不属于运行时依赖的任务才增加显式 Turbo filter 或任务依赖。
- 运行时仍需要 `dist/`（主进程 resolve、发布）。Path map 只服务 **类型检查**。

### 5. 消费方

- 依赖声明：`"@vetta/<name>": "workspace:*"`
- 优先使用包声明的 subpath export（`@vetta/<name>/foo`），不要 deep import 到其它包的 `src/`

### 6. 验证

```bash
# 建议：无 dist 时类型检查也应通过
rm -rf packages/<name>/dist   # 可选压力测试
bun run check                 # Biome + 根 tsgo + desktop tsc
cd packages/<name> && bun run build
bunx turbo run build --dry=json --filter=@vetta/<name>
```

## 不在本文范围

- `packages/plugins` 下的 preset / external → 见 `packages/plugins/AGENTS.md`（根 workspace 下的插件约定）
- Go 包（`apps/api`、`apps/im-gateway`）→ 无 TS path map 要求
