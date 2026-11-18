"use strict";

/**
 * Antigravity 更新后自动修复滑条补丁 (tools/auto-heal.cjs)
 *
 * 背景：Antigravity 每次版本更新都会整体替换 resources/app.asar，
 * 已注入的滑条补丁必然丢失，表现为「滑条不见了」或「滑条回到旧位置」。
 *
 * 本脚本可重复执行、幂等：
 * 1. 读取 app.asar 的 dist/preload.js，检查内联的 payload 是否与 lib/client.js 完全一致；
 * 2. 一致则直接退出（healthy）；
 * 3. 不一致（缺标记 / 仍是旧版代码）则以当前 app.asar 为基础重新注入，
 *    剥离自身旧标记后再追加最新 payload，不会破坏 modelPatch 等其他补丁；
 * 4. Antigravity 正在运行导致文件被锁时，写入 app.asar.codex-staged 并交由后台守护进程
 *    在应用退出后自动完成替换。
 *
 * 用法：
 *   node tools/auto-heal.cjs           # 检查并在需要时修复
 *   node tools/auto-heal.cjs --check   # 只检查：0=已是最新，2=需要修复，1=无法检查
 *   node tools/auto-heal.cjs --quiet   # 无控制台输出（供开机自启使用）
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  parseAsarArchive,
  createPatchedAsarBuffer,
  tryWriteFileAtomically,
  findDefaultAsarPath
} = require("./patch-asar.cjs");

const ROOT_DIR = path.resolve(__dirname, "..");
const CLIENT_JS_PATH = path.join(ROOT_DIR, "lib", "client.js");
const LOG_PATH = path.join(__dirname, "auto-heal.log");
const LOG_MAX_LINES = 200;

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const quiet = args.includes("--quiet");

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  if (!quiet) console.log(`[CodexSlider AutoHeal] ${message}`);
  try {
    fs.appendFileSync(LOG_PATH, line + "\n", "utf8");
    const text = fs.readFileSync(LOG_PATH, "utf8");
    const lines = text.trim().split(/\r?\n/);
    if (lines.length > LOG_MAX_LINES) {
      fs.writeFileSync(LOG_PATH, lines.slice(-LOG_MAX_LINES).join("\n") + "\n", "utf8");
    }
  } catch (err) {
    // 忽略日志写入失败
  }
}

function readPreloadText(asarPath) {
  const raw = fs.readFileSync(asarPath);
  const { header, payload } = parseAsarArchive(raw);
  const entry =
    header.files && header.files.dist && header.files.dist.files && header.files.dist.files["preload.js"];
  if (!entry || entry.offset === undefined) {
    throw new Error("未在 app.asar 中找到 dist/preload.js 条目");
  }
  const offset = Number(entry.offset);
  return payload.subarray(offset, offset + entry.size).toString("utf8");
}

function main() {
  const asarPath = findDefaultAsarPath();
  if (!fs.existsSync(asarPath)) {
    log(`未找到 app.asar: ${asarPath}`);
    return 1;
  }
  if (!fs.existsSync(CLIENT_JS_PATH)) {
    log(`未找到 payload: ${CLIENT_JS_PATH}`);
    return 1;
  }

  const clientCode = fs.readFileSync(CLIENT_JS_PATH, "utf8");
  const expectedLiteral = JSON.stringify(clientCode);

  let preloadText;
  try {
    preloadText = readPreloadText(asarPath);
  } catch (err) {
    log(`读取 preload.js 失败: ${err.message || err}`);
    return 1;
  }

  const hasMarker = preloadText.includes("__AG_CODEX_EFFORT_SLIDER_START__");
  const healthy = preloadText.includes(expectedLiteral);

  if (healthy) {
    log(`补丁已是最新 (${asarPath})`);
    return 0;
  }

  log(hasMarker ? "检测到旧版滑条 payload，准备重新注入最新版本" : "未检测到滑条补丁，准备注入");

  if (checkOnly) {
    log("--check 模式：仅报告，不写入");
    return 2;
  }

  let patchedBuffer;
  try {
    patchedBuffer = createPatchedAsarBuffer(asarPath, clientCode);
  } catch (err) {
    log(`重建 app.asar 失败: ${err.message || err}`);
    return 1;
  }

  const result = tryWriteFileAtomically(asarPath, patchedBuffer);
  if (result.written) {
    log(`已写入最新滑条补丁: ${asarPath} (${patchedBuffer.length} bytes)`);
    return 0;
  }

  if (result.stagedPath) {
    log(
      result.deferred
        ? `Antigravity 正在运行，已生成 ${result.stagedPath}，关闭应用后自动替换`
        : `已生成 ${result.stagedPath}，但后台替换进程启动失败，请关闭 Antigravity 后重跑本脚本`
    );
    return 0;
  }

  log("写入 app.asar 失败，且未能生成待替换包");
  return 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    log(`执行异常: ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
