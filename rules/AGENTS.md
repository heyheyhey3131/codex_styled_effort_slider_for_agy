# Codex Effort Slider 插件规则

本插件打包并管理本机 Antigravity 的「Codex / Claude 风格推理等级滑条」补丁
（上游开源项目：LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider）。

- 用户提到「滑条、推理等级滑条、effort slider、codex 滑条、Low/Medium/High
  档位滑条、滑条不见了/失效、更新后滑条没了」等需求时，使用
  `codex-effort-slider-manager` 技能处理，不要另起炉灶。
- 补丁的运行时资产在插件目录 `assets/sliderPatch/` 内（lib/client.js、
  tools/*.cjs、install/uninstall 脚本）；安装、卸载、热注入、状态检查一律
  通过该技能文档中记录的插件内工具进行。
- 不要手动编辑 `app.asar` 或 IDE 的 `extension.js` / `product.json`；
  asar 的重打包与 SHA-256 integrity 重算必须走 `tools/patch-asar.cjs`。
- 本补丁与 `third-party-model-patch` 插件的 modelPatch 改写不同文件、
  可共存；任一侧重新 apply 都从当前 app.asar 备份重建，不会清除对方。
  但若用纯净备份整体覆盖 app.asar，两个补丁会同时丢失，需分别重装。
