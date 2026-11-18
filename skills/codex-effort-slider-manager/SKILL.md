---
name: codex-effort-slider-manager
description: 管理 Antigravity 的「Codex / Claude 风格推理等级滑条」补丁：检查补丁状态、应用/重新应用 app.asar 持久补丁、CDP 免重启热注入、一键卸载还原、Antigravity 更新后重装、排查滑条不显示/失效问题。当用户提到滑条、推理等级滑条、effort slider、codex 滑条、Low/Medium/High 档位、滑条不见了或更新后滑条失效时使用本技能。
---

# Codex Effort Slider Manager

管理本机 Antigravity 的「Codex / Claude 风格推理等级滑条」补丁。补丁把
`lib/client.js`（自包含 UMD 包）内联进 `app.asar` 的 `dist/preload.js`，
通过 `electron.webFrame.executeJavaScript` 注入渲染进程 Main World，在
对话输入框底部工具栏常驻 Low / Medium / High 推理档位滑条；同时修补
Antigravity IDE 的 `extensions/agy` 扩展（反向代理 + View Usage 300ms
防误触），并同步 `product.json` 校验值。

## 0. 插件根目录

本技能位于 `<plugin>/skills/codex-effort-slider-manager/SKILL.md`，
`<plugin>` 即插件根目录。本机绝对路径：

```
C:\Users\30471\.gemini\config\plugins\antigravity-codex-effort-slider
```

补丁运行时资产：`<plugin>/assets/sliderPatch/`，**这是唯一运行时来源**。
所有命令都在 `<plugin>/assets/sliderPatch` 下执行；Node 用系统 PATH 上的
`node`（18+）。插件目录之外不需要任何文件：`lib/client.js` 与 `tools/`
已自包含，删除其他源码副本不会影响滑条功能。

上游开源仓库仅作可选参考（github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider），
不是运行依赖。升级滑条版本时，直接替换插件 assets 内的 `lib/client.js`
与 `tools/` 即可。

## 1. 补丁构成

| 部分 | 目标 | 插件资产 |
| --- | --- | --- |
| 注入负载（UMD，自包含无依赖） | 内联进 `dist/preload.js` 末尾 | `assets/sliderPatch/lib/client.js` |
| asar 持久补丁 | 重写 `dist/preload.js` + 重算偏移与 SHA-256 integrity | `assets/sliderPatch/tools/patch-asar.cjs` |
| CDP 热注入 | 运行中窗口 Main World，免重启 | `assets/sliderPatch/tools/inject-cdp.cjs` |
| 编排入口 | 先 asar 补丁、后 CDP 同步 | `assets/sliderPatch/tools/cli-install.cjs` |
| 双击入口 | `install.cmd` / `uninstall.cmd` → `install-asar.ps1` | `assets/sliderPatch/` |

补丁标记：`/* __AG_CODEX_EFFORT_SLIDER_START__ */` …
`/* __AG_CODEX_EFFORT_SLIDER_END__ */`（只包裹自身片段，剥离时不影响
其他补丁追加的内容）。

备份命名（工具 canonical 行为）：

- 桌面端：asar 同目录 `app.asar.bak`；文件被锁时生成
  `app.asar.codex-staged` + 后台守护进程自动替换。
- IDE：被改文件同目录 `<file>.codex.bak`，`product.json.codex.bak`。
- 本机现存快照：`app.asar.clean-<版本>.bak`（纯净备份）、
  `app.asar.patched`（已打补丁副本），由历史整理产生，可作还原参照。

## 2. 状态检查（只读，随时可跑）

默认 asar 路径：
`%LOCALAPPDATA%\Programs\antigravity\resources\app.asar`。

快速探测（asar 未压缩，可直接搜标记）：

```powershell
Select-String -Path "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar" `
  -Pattern "__AG_CODEX_EFFORT_SLIDER_START__" -List -Encoding utf8
```

精确探测（解析 asar 头，只看 `dist/preload.js`）：

```bash
node -e "const {parseAsarArchive}=require('<plugin>/assets/sliderPatch/tools/patch-asar.cjs');const fs=require('fs');const b=fs.readFileSync(process.argv[1]);const {header,payload}=parseAsarArchive(b);const e=header.files.dist.files['preload.js'];const t=payload.subarray(Number(e.offset),Number(e.offset)+e.size).toString('utf8');console.log('preload.js slider marker:', t.includes('__AG_CODEX_EFFORT_SLIDER_START__'));" "<asar-path>"
```

同时检查：

- `app.asar.codex-staged` 是否存在（存在 = 补丁包已生成但被运行中的
  Antigravity 文件锁挡住，守护进程会在应用退出后自动完成替换）。
- IDE（如安装）：`resources/app/extensions/agy/vscode/extension.js` 或
  `.../dist/extension.js` 内是否有标记。
- 用户配置在 `localStorage["antigravity-codex-effort-slider:v1"]`
  （右键滑条呼出配置面板：动画效果、刻度点显示、诊断重置）。

## 3. 应用 / 重新应用补丁

**Antigravity 运行中也能安装**：asar 被锁时自动生成 `.codex-staged` 并
启动静默守护进程，应用退出释放锁后自动原子替换；同时对已运行窗口做
CDP 热注入，无需重启即可生效。

```bash
# 标准安装（asar 持久 + CDP 热同步）
node <plugin>/assets/sliderPatch/tools/cli-install.cjs
```

或双击 `<plugin>/assets/sliderPatch/install.cmd`。

流程：备份当前 asar → `app.asar.bak` → 从备份重建（内联 client.js 进
preload.js 末尾，重算全部偏移与 integrity）→ 原子替换 → CDP 注入所有
运行中窗口。IDE 侧同步处理扩展注入、`product.json` 校验值、清 V8 缓存。
预演/自定义 asar：`node tools/patch-asar.cjs --asar <path>`。

## 4. 卸载与还原

```bash
node <plugin>/assets/sliderPatch/tools/cli-install.cjs --uninstall
```

或双击 `uninstall.cmd`。还原 asar（剥离自身标记后重打包）、IDE 扩展从
`.codex.bak` 还原、`product.json` 校验表还原，并卸载运行中窗口的滑条实例。

## 4.5 更新后按需修复（不写入开机自启）

`tools/auto-heal.cjs` 会解析 `app.asar` 的 `dist/preload.js`，把内联 payload
与 `lib/client.js` 逐字比对：

- 一致 → 退出（healthy），不做任何写入；
- 缺标记或仍是旧版 payload → 以「当前 app.asar」为基础剥离自身标记后重新注入，
  不会回滚 modelPatch 等其他补丁；
- Antigravity 正在运行锁定 asar 时，写入 `app.asar.codex-staged`，
  由后台守护进程在应用退出后完成替换。

```bash
node <plugin>/assets/sliderPatch/tools/auto-heal.cjs --check   # 0=最新 2=需修复 1=无法检查
node <plugin>/assets/sliderPatch/tools/auto-heal.cjs           # 检查并按需修复
```

日志在 `<plugin>/assets/sliderPatch/tools/auto-heal.log`（保留最近 200 行）。
本插件不写注册表、不建计划任务、不写 Startup 目录；只在你显式执行命令时动作。

> 说明：Antigravity 插件 API 只提供 skills / rules / prompts / assets，
> 不能在渲染进程里挂载自定义输入框控件；因此滑条必须通过 asar 补丁实现。
> 插件的职责是保存 payload 与工具，并在版本更新后自动/一键重新注入。

## 5. 仅运行期 CDP 热注入 / 卸载（零文件修改）

不改磁盘文件，只对当前运行中的窗口生效，重启即失效：

```bash
node <plugin>/assets/sliderPatch/tools/inject-cdp.cjs              # 注入
node <plugin>/assets/sliderPatch/tools/inject-cdp.cjs --uninstall  # 卸载
```

端口发现顺序：先读 `%APPDATA%\Antigravity*\DevToolsActivePort`；该文件可能
属于旧实例（Antigravity 重启后端口会变），此时自动回退到
`tasklist` + `netstat`，探测 Antigravity 进程实际监听的 127.0.0.1 端口，
因此无需手动改端口。`data:` 空白页会被跳过，只注入真实应用页面。

> 已运行中的窗口永远加载的是它启动时的 preload。改完 asar 后，
> 要么重启 Antigravity，要么用上面的 CDP 热注入让当前窗口立即生效。

## 6. Antigravity 更新后的标准流程

1. 更新会整体替换 `resources/app.asar`，补丁必然失效。
2. 跑第 2 节状态检查确认标记丢失。
3. 立即执行 `node <plugin>/assets/sliderPatch/tools/auto-heal.cjs` 重打；
   需要完整重装时再跑 `node <plugin>/assets/sliderPatch/tools/cli-install.cjs`。
4. 已运行的窗口需重启或 `inject-cdp.cjs` 热注入后才会加载新 payload。
4. 已验证版本：桌面端 **2.32.1**、IDE **2.7.0**。若新版结构变动导致
   「未在 app.asar 中找到 dist/preload.js 条目」等锚点错误，读取报错指出的
   目标文件，对照上游仓库 `tools/patch-asar.cjs` 更新锚点后重试；payload
   （`lib/client.js`）与版本无关，通常无需改动。

## 7. 与其他补丁共存

- 与 `third-party-model-patch` 插件的 modelPatch **可共存**：modelPatch 改
  `dist/main.js`、`dist/languageServer.js` 等并追加自己的 preload 片段；
  本补丁只往 `dist/preload.js` 末尾追加自身标记包裹的片段。任一侧 apply
  都从「当前 app.asar」备份重建，不会清除对方。
- **例外**：若用纯净备份（如 `app.asar.clean-*.bak`）整体覆盖 app.asar，
  两个补丁同时丢失，需分别重装（先 modelPatch 后本补丁，顺序无关）。
- 排查「滑条不显示」时，先确认标记在位；标记在位但仍不显示，用第 5 节
  对运行中窗口热注入验证 client.js 本身，再看 Antigravity 控制台
  `[CodexSlider]` 日志。

## 8. 注意事项

- 持久替换不强制关闭 Antigravity，但文件锁会推迟到退出后由守护进程完成；
  想立即生效可关闭 Antigravity 后重跑安装。
- 卸载后 IDE 需重启（已自动清 V8 缓存）。
- 安装目录里曾被 NSIS 卸载问题困扰：`app.asar.codex-staged` 是临时文件，
  正常情况下替换完成后自动删除，不要在里面深埋其他文件。
- 光敏性癫痫警示：滑条含粒子/星云动效，快速拖拽有高频微动，敏感用户需谨慎。
