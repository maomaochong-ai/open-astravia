---
title: 清单与权限
description: 声明插件身份、加载入口、样式、权限和 Agent 贡献。
---

`plugin.json` 位于插件归档根目录。宿主在加载代码前用它校验身份、兼容性和权限，因此清单必须与构建产物一致。

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "pluginApiVersion": "^1.0.0",
  "runtime": "module-federation",
  "entry": "dist/mf-manifest.json",
  "moduleFederation": {
    "remoteName": "my_plugin",
    "expose": "./plugin"
  },
  "styles": ["dist/style.css"],
  "permissions": ["ui.slot.global"]
}
```

`id` 发布后应保持稳定；`remoteName` 必须是合法且唯一的 Module Federation 名称；`expose` 要与 Vite 配置一致。版本变化时同步更新清单和发布包。

## 最小权限原则

只声明插件实际使用的权限。常见权限按用途分为 UI 插槽、Agent 提示与工具、文件系统、网络、存储、模型、导航和自动化。声明权限不等于获得权限：用户安装授权和运行时校验仍会生效。

开发时先从最小清单开始。调用宿主 API 报权限错误时，确认该行为确实必要，再增加对应权限并重新走安装授权。不要为了省事复制其他插件的完整权限数组。

## 发布前检查

解压最终 ZIP，确认根目录包含 `plugin.json` 与 `dist/`，清单引用的入口和样式都存在。使用全新安装流程验证权限提示，再逐项触发插件能力；本地开发链接成功不能替代发布包验证。
