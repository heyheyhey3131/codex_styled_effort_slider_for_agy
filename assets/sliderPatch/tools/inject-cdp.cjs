"use strict";

/**
 * Antigravity 本地 CDP 免重启热注入 / 卸载工具 (tools/inject-cdp.cjs)
 *
 * 功能：
 * 1. 自动扫描 %APPDATA%\Antigravity\DevToolsActivePort（及 macOS / Linux 对应目录），
 *    发现所有正在运行的 Antigravity 页面目标（支持多窗口同时注入）。
 * 2. 将 lib/client.js 直接注入到每个页面的 Main World (window)，立即挂载输入框右侧「推理等级」滑条与触发按钮着色。
 * 3. 支持 `--uninstall` 参数一键从正在运行的窗口卸载滑条并恢复原生状态，无需重启客户端。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { execFileSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const CLIENT_JS_PATH = path.join(ROOT_DIR, "lib", "client.js");

function isInjectablePage(target) {
  if (!target || target.type !== "page") return false;
  if (typeof target.webSocketDebuggerUrl !== "string") return false;
  if (!/^ws:\/\/(127\.0\.0\.1|localhost):\d+\//.test(target.webSocketDebuggerUrl)) return false;
  const url = target.url || "";
  if (/^devtools:\/\//i.test(url) || /^data:/i.test(url)) return false;
  return true;
}

function getCandidatePortFiles() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const candidates = [
    path.join(appData, "Antigravity", "DevToolsActivePort"),
    path.join(appData, "Antigravity IDE", "DevToolsActivePort"),
    path.join(home, "Library", "Application Support", "Antigravity", "DevToolsActivePort"),
    path.join(home, ".config", "Antigravity", "DevToolsActivePort")
  ];
  try {
    if (fs.existsSync(appData)) {
      const dirs = fs.readdirSync(appData);
      for (const d of dirs) {
        if (/^antigravity/i.test(d)) {
          const p = path.join(appData, d, "DevToolsActivePort");
          if (!candidates.includes(p)) candidates.unshift(p);
        }
      }
    }
  } catch (e) {}
  return candidates;
}

function fetchJson(port, resourcePath, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: resourcePath,
        timeout: timeoutMs
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(new Error("Invalid JSON from DevTools endpoint"));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("DevTools HTTP timeout")));
    req.on("error", reject);
  });
}

/**
 * DevToolsActivePort 可能属于旧实例而失效（Antigravity 重启后端口会变）。
 * 回退方案：找到 Antigravity 进程正在监听的 127.0.0.1 端口，逐个探测 /json/list。
 */
function listAntigravityPids() {
  const names = ["Antigravity.exe", "Antigravity IDE.exe"];
  const pids = new Set();
  for (const name of names) {
    try {
      const out = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 8000
      });
      for (const line of out.split(/\r?\n/)) {
        const match = line.match(/^"([^"]+)","(\d+)"/);
        if (match) pids.add(match[2]);
      }
    } catch (err) {
      // 进程不存在或 tasklist 不可用
    }
  }
  return pids;
}

function listListeningPorts(pids) {
  if (!pids || pids.size === 0) return [];
  const ports = new Set();
  try {
    const out = execFileSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000
    });
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5) continue;
      const [proto, local, remote, state, pid] = cols;
      if (proto !== "TCP" || state !== "LISTENING" || !pids.has(pid)) continue;
      if (!/^(127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]):/.test(local)) continue;
      const port = Number(local.slice(local.lastIndexOf(":") + 1));
      if (Number.isInteger(port) && port > 0) ports.add(port);
    }
  } catch (err) {
    // netstat 不可用
  }
  return Array.from(ports);
}

async function discoverViaListeningPorts() {
  const pids = listAntigravityPids();
  const ports = listListeningPorts(pids);
  for (const port of ports) {
    try {
      const list = await fetchJson(port, "/json/list", 1200);
      if (!Array.isArray(list)) continue;
      const pages = list.filter(isInjectablePage);
      if (pages.length > 0) return { port, file: "netstat", pages };
    } catch (err) {
      // 继续探测下一个端口
    }
  }
  return null;
}

async function discoverAntigravityTargets() {
  const portFiles = getCandidatePortFiles();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    for (const file of portFiles) {
      if (!fs.existsSync(file)) continue;
      try {
        const content = fs.readFileSync(file, "utf8").trim();
        const firstLine = content.split(/\r?\n/)[0];
        const port = Number(firstLine);
        if (!Number.isInteger(port) || port < 1 || port > 65535) continue;

        const list = await fetchJson(port, "/json/list", 4000);
        if (!Array.isArray(list)) continue;
        const pages = list.filter(isInjectablePage);
        if (pages.length > 0) {
          return { port, file, pages };
        }
      } catch (err) {
        // 继续尝试下一个候选端口文件
      }
    }
    if (attempt < 5) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return discoverViaListeningPorts();
}

function evaluateOverWebSocket(wsUrl, expression, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const WS = globalThis.WebSocket;
    if (typeof WS !== "function") {
      reject(new Error("当前 Node.js 版本未内置全局 WebSocket（建议使用 Node.js 20+）"));
      return;
    }
    const ws = new WS(wsUrl);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      reject(new Error("CDP WebSocket 执行超时"));
    }, timeoutMs);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression,
            returnByValue: true,
            awaitPromise: true
          }
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
        if (msg.id !== 1) return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {}
        if (msg.error) {
          reject(new Error(msg.error.message || "CDP Error"));
          return;
        }
        const exception = msg.result && msg.result.exceptionDetails;
        if (exception) {
          reject(
            new Error(
              (exception.exception && exception.exception.description) ||
                exception.text ||
                "Runtime.evaluate 抛出异常"
            )
          );
          return;
        }
        resolve(msg.result && msg.result.result ? msg.result.result.value : undefined);
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    };

    ws.onerror = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(err && err.message ? err.message : "WebSocket 连接失败"));
    };
  });
}

async function runCli() {
  const args = process.argv.slice(2);
  const isUninstall = args.includes("--uninstall") || args.includes("-u");

  const found = await discoverAntigravityTargets();
  if (!found) {
    console.error("[CodexSlider CDP] 未检测到正在运行的 Antigravity 实例（请确认 Antigravity 已打开）。");
    process.exitCode = 1;
    return;
  }

  const clientCode = fs.readFileSync(CLIENT_JS_PATH, "utf8");

  for (const page of found.pages) {
    const title = page.title || page.url || page.id;
    if (isUninstall) {
      const uninstallExpr = `(() => {
        if (window.__agCodexEffortSliderInstance && typeof window.__agCodexEffortSliderInstance.stop === 'function') {
          window.__agCodexEffortSliderInstance.stop();
        }
        const styleEl = document.getElementById('ag-codex-effort-slider-styles');
        if (styleEl) styleEl.remove();
        document.querySelectorAll('.ces-ag-section, .ces-ag-composer').forEach(function (el) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        });
        const triggerSpan = document.querySelector('[data-testid="model-selector-trigger"] [data-ces-part="trigger-effort"]');
        if (triggerSpan) {
          triggerSpan.style.color = '';
          triggerSpan.style.opacity = '';
          triggerSpan.style.fontWeight = '';
        }
        return { uninstalled: true };
      })()`;
      const res = await evaluateOverWebSocket(page.webSocketDebuggerUrl, uninstallExpr);
      console.log(`[CodexSlider CDP] 已从窗口卸载: ${title}`, res);
    } else {
      const injectExpr = `(() => {
        ${clientCode}
        if (window.AntigravityCodexEffortSlider) {
          window.AntigravityCodexEffortSlider.installCodexEffortSlider({ document, window });
        }
        const trigger = document.querySelector('[data-testid="model-selector-trigger"]');
        return {
          installed: Boolean(window.__agCodexEffortSliderInstance),
          triggerFound: Boolean(trigger),
          triggerText: trigger ? trigger.innerText.trim() : null
        };
      })()`;
      const res = await evaluateOverWebSocket(page.webSocketDebuggerUrl, injectExpr);
      console.log(`[CodexSlider CDP] 已热注入窗口 (port ${found.port}): ${title}`, res);
    }
  }
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error("[CodexSlider CDP] 执行失败:", err.message || err);
    process.exitCode = 1;
  });
}

module.exports = {
  discoverAntigravityTargets,
  evaluateOverWebSocket
};
