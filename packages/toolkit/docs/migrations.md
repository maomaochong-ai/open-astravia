# Migration Guide

本指南说明如何选择和使用 `@vetta/toolkit` 的迁移能力，并统一消费包中的目录结构与职责边界。

## 选择迁移器

| 场景 | 使用模块 |
| --- | --- |
| 单个 JSON 文档通过 `schemaVersion` 演进 | `@vetta/toolkit/versioned-config` |
| 移动、拆分、合并或删除实际文件和目录 | `@vetta/toolkit/file-migrations` |
| Node.js 中读取、迁移、校验并回写单个配置文件 | `@vetta/toolkit/config-store` |

不要用文件迁移代替 JSON schema 迁移。一个文档内部字段变化时，应使用 `versioned-config`；只有磁盘布局发生变化时才使用 `file-migrations`。

## Versioned Config

推荐目录结构：

```text
feature/
  migrate-config.ts
  migrations/
    001_to_2.ts
    002_to_3.ts
  schema.ts
  store.ts
```

职责划分：

- `migrate-config.ts`：注册迁移链并调用 Toolkit。
- `migrations/NNN_to_N.ts`：只完成一个版本到下一个版本的数据转换。
- `schema.ts`：定义当前版本类型和运行时校验。
- `store.ts`：负责读取、迁移、校验和必要的迁移回写。

迁移入口保持简短：

```ts
import { migrateVersionedConfig, type VersionedConfigMigrationResult } from "@vetta/toolkit/versioned-config";
import { featureMigration001To2 } from "./migrations/001_to_2";
import { featureMigration002To3 } from "./migrations/002_to_3";
import { FEATURE_SCHEMA_VERSION } from "./schema";

const FEATURE_MIGRATIONS = [featureMigration001To2, featureMigration002To3] as const;

export function migrateFeatureConfig(value: unknown): VersionedConfigMigrationResult {
	return migrateVersionedConfig(value, {
		currentVersion: FEATURE_SCHEMA_VERSION,
		migrations: FEATURE_MIGRATIONS,
	});
}
```

单次迁移独立保存：

```ts
import type { VersionedConfigMigration } from "@vetta/toolkit/versioned-config";

export const featureMigration001To2: VersionedConfigMigration = {
	fromVersion: 1,
	toVersion: 2,
	migrate(config) {
		return {
			...config,
			newField: config.newField ?? "default",
		};
	},
};
```

## 执行顺序

消费方应按照固定顺序处理持久化数据：

1. 将磁盘或插件存储内容解析为 `unknown`。
2. 使用 `migrateVersionedConfig` 连续迁移到当前版本。
3. 使用 TypeBox、Zod 或已有校验器验证当前版本结构。
4. 将通过校验的数据装配为内存运行对象。
5. 当 `migrated === true` 时回写当前版本文档。

不要在迁移前用当前版本 schema 校验旧数据，否则合法旧文档会在迁移前被拒绝。迁移函数也不应返回带服务实例、URL、缓存或 UI 状态的运行对象。

## 运行态分离

持久化文档和运行态数据应分别处理：

```text
visible-document.json       # 用户内容、稳定标识、长期配置
hidden-runtime.json         # jobs、进度、错误、临时状态
```

如果旧文档混有运行态字段，应在迁移前提取这些字段，再让版本迁移负责从可见文档中删除它们。运行态恢复和节点状态推导应放在独立模块，不要塞进 `migrations/002_to_3.ts`。

## File Migrations

文件迁移同样采用单版本文件和集中入口：

```text
migrations/
  index.ts
  000_to_1.ts
  001_to_2.ts
```

入口通过 `runFileMigrations` 注册有序迁移，并为当前功能设置独立的 `statePath`。每个迁移必须幂等，只操作传入 context 根目录下经过校验的相对路径，不得自行拼接或访问根目录外路径。

文件迁移适合：

- 将旧文件移动到新目录。
- 把单文件拆分为多个文件。
- 合并历史目录结构。
- 删除已确认不再使用的旧布局。

## 校验与测试

每次新增 schema 版本至少覆盖：

- 上一个版本可以迁移到当前版本。
- 多个历史版本可以连续迁移到当前版本。
- 当前版本返回 `migrated: false`。
- 高于当前版本的文档被明确拒绝。
- 迁移结果通过当前版本运行时 schema 校验。
- 迁移回写不会重新引入已移除的字段。

禁止使用无校验的类型断言代替运行时校验。消费包已经使用 TypeBox 或 Zod 时，应继续使用同一种方案，避免为单个迁移引入第二套 schema 库。
