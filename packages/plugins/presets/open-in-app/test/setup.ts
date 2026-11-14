// React 19 要求测试开启 act 环境，否则渲染 hook 的探针会打印未包裹 act 的警告。
// 放在 setup 里，各个测试文件只关心自己的场景，不用重复声明。
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
