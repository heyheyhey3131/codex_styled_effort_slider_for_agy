# Codex 风格推理等级滑条 (Codex Effort Slider)

把本机 Antigravity 内的「仿 Codex / Claude 效果推理等级滑动条」补丁打包成了
一个 Antigravity 插件：在 Customizations（自定义）页面可见、可启用/停用，
并附带 `codex-effort-slider-manager` 技能，让 agent 能随时检查补丁状态、
重新应用、热注入或卸载还原。

## 功能

- 对话输入框底部工具栏常驻 Low / Medium / High 推理档位滑条
  （Agent 权限下拉左侧），同步当前模型可用档位；单档位模型自动置灰锁定。
- 第三方模型（third-party-model-patch 接入的 OpenAI 兼容模型）的档位由代理
  提供：滑条读取 `GET http://127.0.0.1:50999/plugin/effort/levels`，拖动时
  POST `/plugin/effort`，代理按会话把档位写进请求。因此 `none` / `minimal` /
  `default` 也能显示和切换，而原生下拉里每个模型只保留一行（原生 UI 只认
  `low/medium/high/xhigh/max` 五个 token，额外档位无法做成子菜单）。
- 拖拽跨档即时切换（`pointermove` 阶段即调用
  `setModelConfigByLabelForConversation`），1/3 格宽迟滞棘轮防跳闪。
- 双风格物理动效：Codex 风格圆纽光晕 + 22 星尘（Gemini 4 Argon /
  Gemini 3.8 Flash）；Claude Code 风格胶囊点阵抖动扫掠波
  （Claude Opus 5.5 / Claude Sonnet 5.5）。
- 右键 / 长按滑条呼出独立配置面板（动画效果、刻度点、诊断），配置存
  `localStorage["antigravity-codex-effort-slider:v1"]` 并跨窗口同步。
- 安装方式：app.asar 持久补丁（每次启动自动生效）+ CDP 免重启热注入；
  一键卸载还原官方原版文件。
- 更新后修复：`tools/auto-heal.cjs` 逐字比对 asar 内联 payload 与
  `lib/client.js`，缺失或过期即按需重注入。不写开机自启、不建计划任务、
  不写注册表。

## 目录结构

```
antigravity-codex-effort-slider/
├── plugin.json                    # 插件清单
├── README.md
├── assets/
│   ├── logo.svg                   # 插件图标
│   └── sliderPatch/               # 补丁运行时快照（源自上游开源项目）
│       ├── lib/client.js          #   注入负载（自包含 UMD）
│       ├── tools/patch-asar.cjs   #   app.asar 持久补丁/还原
│       ├── tools/inject-cdp.cjs   #   CDP 热注入/卸载（自动发现端口）
│       ├── tools/auto-heal.cjs    #   更新后逐字比对并按需重注入
│       ├── tools/cli-install.cjs  #   编排入口
│       ├── install.cmd / uninstall.cmd / install-asar.ps1
│       └── LICENSE                #   MIT（上游 LLYSH-HANNARI）
├── rules/AGENTS.md                # 触发规则：何时动用本插件
└── skills/
    └── codex-effort-slider-manager/
        └── SKILL.md               # 补丁管理技能（状态/安装/卸载/热注入）
```

## 使用

直接在对话里说即可，例如：

- 「检查推理等级滑条补丁的状态」
- 「Antigravity 刚更新了，重新应用滑条补丁」
- 「对运行中的窗口热注入滑条」/「卸载滑条补丁」

也可以手动运行（Node 18+）：

```bash
node assets/sliderPatch/tools/cli-install.cjs              # 安装
node assets/sliderPatch/tools/cli-install.cjs --uninstall  # 卸载
node assets/sliderPatch/tools/inject-cdp.cjs               # 仅热注入
node assets/sliderPatch/tools/auto-heal.cjs                # 检查并修复（更新后）
```

## 已知信息

- 已验证支持版本：Antigravity 桌面端 2.32.1、Antigravity IDE 2.7.0。
- Antigravity 每次更新都会替换 app.asar 导致补丁失效；更新后运行
  `tools/auto-heal.cjs` 即可重打。**已运行的窗口要重启或 CDP 热注入才会加载新 payload。**
- Antigravity 插件 API 只提供 skills / rules / prompts / assets，不能在渲染进程挂载自定义
  输入框控件；滑条 UI 必须通过 asar 补丁实现，插件负责保存 payload 并按需修复。
- 与 `third-party-model-patch` 插件的 modelPatch 改写不同文件，可共存；
  但用纯净备份整体覆盖 app.asar 会同时清除两者。
- 第三方模型档位依赖该插件的代理（默认 `127.0.0.1:50999`）。代理未运行时
  滑条只显示原生档位，模型行不会重复，也不会报错。
- 插件目录 `assets/sliderPatch/` 是唯一运行时来源，自包含、无外部路径依赖；
  删除其他源码副本不影响滑条。
- 注意：`third-party-model-patch` 的 `assets/preload-inject.js` 内联了一份**旧版**滑条代码
  （带同样的 `__AG_CODEX_EFFORT_SLIDER_START__` 标记）。重跑该插件的模型补丁会把它追加回来，
  覆盖/抵消本插件对 `lib/client.js` 的改动。需要时先重跑本插件的安装或 `auto-heal.cjs`。

## 本机改动记录

### 2026-11-18 · v1.3.1：点击模型行后自动收起下拉栏（ces-menu-autoclose）

原版为了“切完模型马上拖档位”，在捕获阶段吞掉了模型行的 `pointerup/mouseup/click`，
导致**选中模型后下拉栏不自动收回**。本机版本改为：

- 保留模型行识别与 `commitAntigravityModelOption` 自切换路径（不改原生子菜单被隐藏后的选择逻辑）；
- 提交模型时传 `{ keepMenuOpen: false }`，并在下一帧用最新 context 再 `syncModelMenuOpen(false)` 一次，
  确保下拉栏收起；
- 滑条本体（输入框常驻滑条、菜单内滑条、拖拽切档、Claude 主题、设置面板、代理档位）行为不变。

回滚：用同目录的 `client.js.bak-menu-autoclose-<时间戳>` 覆盖 `client.js`，再执行
`node assets/sliderPatch/tools/patch-asar.cjs` 重新注入。
- 本仓库：https://github.com/heyheyhey3131/codex_styled_effort_slider_for_agy
  上游参考（MIT，视觉/交互灵感来源）：
  github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider。

## 免责声明

本插件为第三方非官方社区定制，与 Google / Antigravity、Anthropic、
OpenAI 无任何官方关联；未包含上述公司的任何专有源码。滑条含粒子动态
特效，光敏性癫痫患者请谨慎使用。使用风险自负。
