# Team: Runtime

> 本包属于 **Runtime Team**，同组包：`runtime-core`、`runtime-mcp`、`runtime-storage`、`runtime-tools`、`cli-host`

## 职责范围

日志和遥测接口定义，提供 `RuntimeLogger`、`ConsoleRuntimeLogger`。

## 注意事项

- 仅 1 个源文件，无外部包依赖（独立模块）
- 定义的是接口契约，被其他 runtime 包和应用层实现
