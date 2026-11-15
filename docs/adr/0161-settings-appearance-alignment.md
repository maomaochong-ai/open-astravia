# ADR-0161：设置与外观页对齐 0.5.72–0.5.81（B5 批）

## 状态

已接受。范围是 ADR-0157 登记表中 `settings`(27)、`appearance`(1)、`ssh`(1)、`ssh-transport`(0，已在 B1
完成)、`model-select`(1) 与 `desktop`/`ui` 中归属设置与外观页的条目。不改任何插件对外合同。

## 背景

ADR-0157 把 0.5.72→0.5.81 的每个行为变更逐条登记，B5 批负责「设置与外观」这一块。对照参照实现，
这一批的真实需求不是零散样式，而是三件结构性的事：

1. **外观页的「外观」散在四个互不相干的分区里**：语言、外观模式各占一整块卡片网格，界面大小是一张
   独占的卡片，应用图标、宠物形象、侧边栏样式、鼠标指针各占一块。用户想改「这个看起来多大、什么语言、
   什么配色」时要在一屏里跳来跳去，而这一页最常做的正是这三件事。
2. **设置页的控件没有共同皮肤**：下拉带边框、输入框是卡片底、操作按钮又是另一种形态，同一个设置项
   左右两侧经常看起来像来自两个应用。参照实现在 0.5.76 把「下拉 / 输入框 / 操作按钮」收成一套无边框
   底色皮肤，并把设置项行高压矮一档。
3. **SSH 主机只能填 `user@host`、只能用私钥**：不用 ssh config 的用户不容易想到要写 `user@host`，
   需要密码登录的机器则完全没有入口——而密码是远端主机最常见的认证方式。

## 决策

### 1. 外观页：一行一个设置项，语言 / 外观模式 / 界面大小并成一组

`AppearanceSettingsView` 的头部三块（语言、外观模式、界面大小）合并进同一个 `SettingSection`，
每项是一条 `SettingRow`：

| 行 | 控件 | 说明 |
| --- | --- | --- |
| 语言 | `MotionSelect` | 选项带语种自称与图标 |
| 外观模式 | `MotionSelect` | 从三张卡片改为下拉；主题切换的扩散动画仍需要点击坐标，所以在窗口层记最近一次 `pointerdown` |
| 界面大小 | 触发器 + popover | 行内只显示百分比，滑块收进 popover |

分区锚点（`appearance-mode`、`appearance-ui-zoom`）挂在行的包裹 `div` 上而不是行本身：
`SettingRow` 只是一行布局，给它挂 `id` 会让「设置搜索定位到某个分区」跳到一个没有标题的行上。

外观页同时删掉三块内容，理由都是「这一页不该有它」：

- **宠物形象**：它只是装饰，却占了语言区右侧一整列，把语言下拉挤窄；
- **侧边栏样式**：应用只保留经典侧边栏（选项本身已删除，见下）；
- **鼠标指针**：应用统一使用系统指针。

### 2. 界面大小：六档吸附，松手才生效

`UI_ZOOM_STEPS = [0.75, 0.9, 1, 1.1, 1.25, 1.5]`，事实源是 `desktop-config.uiZoomFactor`，
主进程 `ui-zoom-service` 是唯一写入口：设置页滑块、菜单 `Cmd/Ctrl +/-`、`Cmd/Ctrl 0` 都经过它。

- **为什么不用 Chromium 的 `zoomIn/zoomOut/resetZoom` 菜单角色**：角色直接改 webContents 的缩放，
  不经过持久化比例，会和设置页各改各的——菜单放大到 125%，设置页仍显示 100%，重启后又回到菜单的值。
  所以菜单项换成自定义 `click`，走同一个 `stepUiZoom()`。
- **为什么固定档位而不是连续滑块**：「放大一点」的结果不该取决于用户上次拖到哪儿；固定档位也让
  `Cmd +` 每次移动量可预期。
- **为什么松手才生效**：`webContents.setZoomFactor` 会触发整页重排，拖动过程中每个中间值都套一遍，
  界面会在手底下持续跳动。`UiZoomControl` 拖动时只改本地 `draftIndex` 预览，`onIndexCommit` 才写主进程。
- **主窗口重新加载后要重新套**：Chromium 的缩放跟 origin 走，页面重载可能回到它自己记的值，
  所以 `attachUiZoom` 在 `did-finish-load` 再套一次。

**红绿灯**：本批最初只做比例，后来由共享皮肤/红绿灯批次（`docs/adr/0163-shared-skin-theme-depth-and-traffic-lights.md`）
把 `trafficLightPositionFor` / `parseTitlebarCenter` 接进了同一个 `ui-zoom-service`：比例变化、全屏进出、
还原与重新显示都会把原生按钮对到实测的页头中线。本批不重复实现，只保留 `attachUiZoom` 作为统一挂载点。

### 3. 新会话页装饰：两个设置项 + popover 挑选

装饰件与纹理原先各是一排四张方格卡片，摊在页面上占掉两屏。改成 `SettingRow` + `DecorPicker`：
行内只显示当前选项名，点开 popover 才看到方格网格，选中后自动收起。方格预览本身（含马里奥砖块、
纹理实景）原样复用，没有降级成图标。

### 4. 移除侧边栏样式与鼠标指针选项

两项都从外观页删除，`SETTINGS_SECTION` 里的对应锚点一并删除（否则设置搜索会跳到不存在的区段）。

- **侧边栏样式**：外观页入口与 `SETTINGS_SECTION["appearance-sidebar"]` 锚点删除，设置页不再提供切换。
  **底层实现已在后续迭代删净**（本轮）：`shared/theme/sidebar-style.ts`、`sidebarStyleAtom`、
  `useSidebarStyle` 与三组中英文案一起删除，`styles.css` 里 11 条 `[data-sidebar-style]` 选择器
  改为无条件规则——侧边栏只剩「贴紧窗口左侧 + 右侧一条分隔线」一种形态。
  删除而不是继续保留开关的理由：设置页已没有切换入口，留着属性开关等于给一条永远走不到的分支
  留位置，而旧版本存下的 `floating` 仍会让同一份代码在别人机器上呈现另一种形态。
- **鼠标指针**：外观页不再提供该项。**底层能力暂时保留**：插件 `appearance` 命令与主题变更审批面板
  仍能读取/设置 `cursorStyle`，因为它属于插件对外合同（`packages/plugins`），删除它需要版本推进与
  兼容层，不在本批范围。这是一处刻意的部分对齐，见「后果」。

### 5. 默认模型：模型设置页顶部的统一选择器

原先只有自定义服务商的模型行能点星标设默认，预设服务商没有入口；同一个「默认模型」在两处对不上。
改为：

- 新增 `ModelsDefaultModelSection`，放在模型设置页第一块，用宿主的 `ModelSelect`（与输入栏同源）；
- 模型行删掉星标按钮与「默认」角标；
- `useModelsSettingsModel` 的 `onSetDefaultModel(providerName, modelId)` 换成
  `onChangeDefaultModel(modelKey | null)`，选择器可以直接设、也可以清空；
- 改默认模型时同步写 `localStorage` 里「上次选的模型」，否则设了默认的新会话不生效。

思考档位沿用输入栏「按模型记忆」的那份 `reasoningByModelAtom`：在设置里选过的档位，新会话发消息时
直接按它走，不需要两处各存一份。

### 6. Agent 个性化：人设即时生效，自定义指令进弹窗

人设下拉改为即时保存（换人设是「换个助手」，不该还要再点「应用」）；自定义指令可以很长，摊在设置页
会把人设和它自己挤成两段，改为设置项右侧一个「编辑」按钮，点开 Dialog 编辑，点「应用」才写入。
关闭弹窗未应用则丢弃草稿，回到已保存内容。`dirty` 相应只看自定义指令。

### 7. 预设服务商移除前二次确认

移除会连同本机保存的 API Key 与模型配置一起删掉且不可撤销。`remove` 改为先弹 `confirmDialogAtom`，
真正执行放在确认回调里；点「取消」什么都不会发生。

### 8. SSH 主机：表单拆字段 + 对话框 + 密码登录

- **拆成「主机地址 / 端口 / 用户名」**：`host` 与 `username` 两个输入框，提交时用 `composeTarget()`
  拼成 `user@host` 存进 `target`——**存储格式不变**，旧主机照常读取，`~/.ssh/config` 别名仍然可用
  （别名的用户名留空）。反过来 `splitTarget()` 在编辑时把 `user@host` 拆回两个框；直接在主机地址里
  粘贴 `user@host` 时也会自动拆开。
- **改为对话框**：新增/编辑不再在列表行内就地展开，`SshHostForm` 删除。理由是行内展开会把已有条目
  推到屏幕外，而编辑时最需要的正是对照已有主机名。
- **密码登录**：认证方式用 `SegmentedControl` 在「私钥 / 密码」间切换，Tab 自身 `self-start`
  以免撑满整行。口令只在提交时单向传给主进程：

  - `SshHostInput.authMethod` 传到 `normalizeSshHostInput`，密码方式**丢弃私钥路径**（两种认证方式的
    残留混在一起只会让人猜「到底用哪个」）；
  - 主进程 `ipc/ssh.ts` 的 `syncHostPassword` 把口令写进 `CredentialVault`（`sshCredentialRef(hostId, "password")`），
    配置里只出现 `authMethod`，**不落明文**；切回私钥时 `vault.remove` 清掉旧口令，删除主机时一并清；
  - 连接时 `buildSshArgv` 追加 `-o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no`：
    不这样做的话 ssh 会先拿本机所有私钥逐个试错，很快就会撞到服务端的 `MaxAuthTries`，用户看到的是
    「密码正确但连不上」；
  - 已有 askpass 链路负责取口令：存档的凭据每轮认证只用一次，失败后清除并改为当场询问（原有行为）。


### 9. 应用图标与字体：同一张卡片里的两行（本轮修订）

参照实现把「应用图标」放在语言 / 外观模式 / 界面大小那一组的最后一行。本节把本仓的两处偏差收敛掉，
并记录一条本仓独有的取舍。

**① 应用图标：默认图标用 Astravia 官方图标，不用参照实现的像素形象。**

- `APP_ICON_IDS` 的 `default` 仍是出厂项，但它现在指向本仓自己的 Astravia 图标
  （`apps/desktop/build/icon.png` 的 824 本体裁切后生成的 `settings/assets/app-icons/default.png`），
  文案也从「默认」改为「Astravia」。其余 10 个场景图标沿用既有素材。
- 理由：本项目是 Astravia，不是参照实现。出厂图标是用户第一眼看到的应用身份，把它设成对方的
  品牌形象会让「这是哪个产品」出现两种答案。ADR-0172 的品牌采纳范围据此收窄为「场景图标与
  Dock 边距规范」，不含出厂图标。
- **展开列表的形状**：`SquircleIcon` 的 `clip-path` 从极坐标扰动（`50 + 6·cos(4θ)`，四角内掐，
  看起来像四瓣花）换成真正的超椭圆（n=5）参数方程，与 macOS 应用图标一致。十一个图标同形状、
  同裁切，不再出现「有的像方块有的像花」。
- **打包白名单**：`build-resource-filters.mjs` 的 `app-icons/**/*` 与对应断言早已在位；
  缺了它打包后运行时读不到图标、切换静默失败，这条断言是防止再次丢失的唯一守卫。

**② 字体：并进同一张卡片，紧跟应用图标之后，且不带副标题与描述。**

- 原来的字体是独立分区：一个 `SettingHeading`「字体」+ 一行「字体系列」。标题与行标题说的是同一件事，
  还额外多出一条分区间距。
- 现在它是 `appearance-language` 那张卡片的最后一行（`border={false}` 收尾），锚点仍是
  `appearance-font`，所以设置搜索照旧能定位；`data-font-role="global"` 也保留，用例靠它找元素。
- 该行没有 `description`：字体选择器的内容（每个选项用自己的字体栈渲染）已经自解释；
  `fontFamily` 这个 i18n 键、`labels.fontFamily` 字段与调用点一并删除，避免留下没人读的死文案。
- 宽度策略沿用第 2 节修订：调用点不再写死 `w-[…]`；字体触发器保留 `min-w-[140px] shrink-0`，
  因为它的选项文案长度差异最大，给下限是为了不让行内控件跟着抖——这是下限，不是定宽。

**验证**：`AppearanceSettingsView.test.tsx` 的字体用例同时断言三件事——字体行落在
`appearance-language` 卡片内、同一卡片内能查到 `appearance-app-icon`、页面上不再有「字体」这个
分区标题；任何一条回退都会让该用例变红。

## 备选方案

- **保留卡片式外观页，只调间距**：成本最低，但「语言 / 模式 / 大小」仍是三块互不相邻的区域，
  这一页最常做的三件事仍要跨屏找。
- **界面大小用连续滑块**：手感更自由，但落点不确定，且与快捷键「逐档」不一致。
- **把红绿灯位置也放进本批**：会让本批跨到 `layout`/`window` 的表，且需要渲染进程上报页头中线
  这条新 IPC；拆开做各自可验证，最终由 0163 批接进了同一个 service。
- **SSH 继续用单一 `target` 字段**：改动最小，但用户必须知道 `user@host` 这个约定，且密码登录没入口。
- **把口令存进 `desktop-config.json`**：实现最快，但那份文件常被整份备份、贴进 issue，明文口令
  进了配置就等于泄漏——这也是 `SshHost` 从一开始就只存 `credentialRef` 的原因。

## 后果

- 正面：外观页从「六个分区」收成「一组设置项 + 主题 + 字体 + 装饰」；界面大小有确定档位且与快捷键
  同源；默认模型在模型页有唯一入口；SSH 支持密码登录，口令进凭据库。设置项行高从 64px 收到 41px，
  同一屏能看到更多项。
- 代价：`ui-zoom` 新增主进程服务、IPC 通道、preload 合同与 `StepSlider` 公共组件（`packages/ui`）；
  `SshHost` 多一个 `authMethod` 字段（向后兼容：缺省等同 `key`）。
- **已知的部分对齐**：
  1. 鼠标指针选项只删了设置页入口，插件合同与审批面板仍保留 `cursorStyle`（见决策 4）；
  2. ~~侧边栏样式同样只删入口，底层规则由侧边栏批次处理~~ —— **已收敛**：本轮连同
     `sidebar-style.ts` / `sidebarStyleAtom` / `useSidebarStyle` / i18n 文案与 `[data-sidebar-style]`
     规则一并删除，不再存在第二种侧边栏形态；
  3. 设置页皮肤：共享常量（`SELECT_TRIGGER_CLASS` / `SELECT_PANEL_CLASS` / `INPUT_FILL_CLASS` /
     `TEXTAREA_FILL_CLASS` / `Button variant="field"`）已由 ADR-0163 批次在 `packages/ui` 落地；本批已把它们
     接入到 `MotionSelect`、`SettingsFormFields`（`InputField` / `TextareaField`）、`RuntimeConfigurationSections`
     的数字输入框、外观页的缩放与装饰触发器，以及设置域 30 余处操作按钮。个别仍自写 `border` 的局部控件
     （服务商图标框、开关等）不是本批条目，保留不动；
  4. ~~「应用图标」入口（3kko / 76hy / 7esp）未做~~ —— **已落地**，见第 9 节；
  5. 浅色 muted/card 层次、mono accent 等主题色条目属 `theme` 表（ADR-0163），不在本批。
- 风险：
  1. `uiZoomFactor` 是新的配置字段，旧版本读不到会忽略（`parseDesktopConfig` 只认识已知字段，未知字段原样保留）；
  2. 密码登录依赖系统安全存储。`CredentialVault.put` 在 `safeStorage` 不可用时会抛错，`syncHostPassword`
     吞掉这次失败：主机本身已登记为 `authMethod: "password"`，连接时 askpass 找不到存档就当场询问用户。
     也就是说「存不下口令」表现为每次连接都问一次，不会被静默降级成私钥登录；
  3. `SshHost.authMethod` 是可选字段，缺省等同 `key`，本仓读写两条路径都兼容旧记录。反向不成立：
     旧版本读到 `authMethod: "password"` 会忽略该字段，而该主机的 `identityFile` 已被密码方式丢弃，
     于是它会按 ssh-agent / 默认身份尝试连接——降级结果是「可能连不上」，不会带错凭据登录；

## 验证

| 行为 | 用例 |
| --- | --- |
| 六档吸附、`Cmd +/-` 逐档、到头不越界 | `apps/desktop/src/shared/ui-zoom.test.ts` |
| 菜单缩放不用 role，`Cmd+0 / +Plus / += / -` 都在 | `apps/desktop/src/main/app-menu.test.ts` |
| 拖动只改预览、松手才写主进程、取消回到已生效档 | `UiZoomControl.test.tsx` |
| 原生 `StepSlider`：拖动只上报预览、松手才提交、点标签直接提交、禁用无效、`motion-reduce:transition-none` | `packages/ui/src/step-slider.test.tsx` |
| 装饰件与纹理在设置行内、popover 里挑选、选中态 | `AppearanceSettingsView.test.tsx` |
| 默认模型选择器写回、清空、思考档位同源 | `ModelsDefaultModelSection.test.tsx` |
| SSH 字段拆分与拼回、密码随提交传出、不回填旧口令 | `useSshHostsSettingsModel.test.tsx` |
| 密码登录丢弃私钥、argv 只尝试口令认证 | `packages/ssh-transport/src/ssh-host.test.ts` |

未运行的验证：`verify:ui:*`（本批未获授权，也不构成默认门禁）；界面大小与密码登录在真实 Desktop
上的观感与连接效果需用户在开发环境验收。
