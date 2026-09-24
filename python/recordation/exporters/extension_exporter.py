"""Chrome Extension Replay Exporter: Packages a recording into a standalone runnable Chrome extension."""

from __future__ import annotations

import json
from pathlib import Path
from recordation.models import Recording


class ExtensionExporter:
    """Exports a Recordation .rec model into a complete, standalone Chrome Extension."""

    @classmethod
    def export(cls, recording: Recording, output_dir: str | Path) -> Path:
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / "popup").mkdir(exist_ok=True)
        (out / "icons").mkdir(exist_ok=True)

        meta = recording.metadata
        safe_title = meta.title.replace('"', '\\"')

        # 1. manifest.json
        manifest = {
            "manifest_version": 3,
            "name": f"Runner: {meta.title}",
            "version": "1.0.0",
            "description": f"Standalone Automation Runner for {meta.title}",
            "action": {
                "default_popup": "popup/popup.html",
                "default_icon": {
                    "16": "icons/icon16.png",
                    "48": "icons/icon48.png",
                    "128": "icons/icon128.png"
                }
            },
            "background": {
                "service_worker": "background.js",
                "type": "module"
            },
            "permissions": [
                "storage",
                "tabs",
                "scripting",
                "activeTab"
            ],
            "host_permissions": [
                "<all_urls>"
            ]
        }
        (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        # 2. flow.json (embedded recording data)
        (out / "flow.json").write_text(recording.model_dump_json(indent=2), encoding="utf-8")

        # 3. background.js
        bg_code = """/**
 * Standalone Automation Background Service Worker
 */

let isRunning = false;
let flowData = null;

async function loadFlow() {
  if (!flowData) {
    const res = await fetch(chrome.runtime.getURL('flow.json'));
    flowData = await res.json();
  }
  return flowData;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_RUNNER') {
    startAutomation().then(sendResponse);
    return true;
  }
});

async function startAutomation() {
  const flow = await loadFlow();
  if (!flow || !flow.steps || flow.steps.length === 0) {
    return { success: false, error: 'No steps in flow' };
  }

  isRunning = true;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || !activeTab.id) {
    isRunning = false;
    return { success: false, error: 'No active tab found' };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ['automation_engine.js']
    });

    const res = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'EXECUTE_FLOW',
      flow: flow
    });

    isRunning = false;
    return { success: true, result: res };
  } catch (err) {
    isRunning = false;
    return { success: false, error: err.message };
  }
}
"""
        (out / "background.js").write_text(bg_code, encoding="utf-8")

        # 4. automation_engine.js
        engine_code = """/**
 * In-Page Replay Automation Engine
 */

(function() {
  if (window.__RECORDATION_RUNNER__) return;
  window.__RECORDATION_RUNNER__ = true;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function findElement(step) {
    if (!step.target || !step.target.selectors) return null;
    const s = step.target.selectors;

    // 1. Try semantic name attribute
    if (s.name) {
      try {
        const el = document.querySelector(`[name="${s.name}"]`);
        if (el) return el;
      } catch (e) {}
    }

    // 2. Try aria-label
    if (s.ariaLabel) {
      try {
        const el = document.querySelector(`[aria-label="${s.ariaLabel}"]`);
        if (el) return el;
      } catch (e) {}
    }

    // 3. Try testId
    if (s.testId) {
      try {
        const el = document.querySelector(`[data-testid="${s.testId}"]`);
        if (el) return el;
      } catch (e) {}
    }

    // 4. Try Text match for buttons/links/options
    if (step.target.text && step.target.text.length < 35) {
      const tag = (step.target.tag || 'button').toLowerCase();
      const elements = Array.from(document.querySelectorAll(tag));
      for (const el of elements) {
        if (el.textContent && el.textContent.trim().includes(step.target.text.trim())) {
          return el;
        }
      }
    }

    // 5. Try CSS
    if (s.css) {
      try {
        const el = document.querySelector(s.css);
        if (el) return el;
      } catch (e) {}
    }

    // 6. Try XPath
    if (s.xpath) {
      try {
        const result = document.evaluate(s.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (result.singleNodeValue) return result.singleNodeValue;
      } catch (e) {}
    }

    return null;
  }

  // Visual execution highlight
  function highlight(el) {
    if (!el) return;
    const origOutline = el.style.outline;
    const origBoxShadow = el.style.boxShadow;
    el.style.outline = '3px solid #6366f1';
    el.style.boxShadow = '0 0 12px #6366f1';
    setTimeout(() => {
      el.style.outline = origOutline;
      el.style.boxShadow = origBoxShadow;
    }, 400);
  }

  async function executeStep(step) {
    const delay = Math.max(step.delayMs || 200, 150);
    await sleep(Math.min(delay, 1500));

    if (step.type === 'navigate' && step.url) {
      if (window.location.href !== step.url) {
        window.location.href = step.url;
        return;
      }
    }

    if (step.type === 'click' || step.type === 'dblclick') {
      const el = findElement(step);
      if (!el) throw new Error('Target element not found: ' + (step.target?.selectors?.css || step.target?.text));
      highlight(el);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(150);
      el.click();
      if (step.type === 'dblclick') {
        await sleep(50);
        el.click();
      }
      return;
    }

    if (step.type === 'input') {
      const el = findElement(step);
      if (!el) throw new Error('Input field not found: ' + step.target?.selectors?.css);
      highlight(el);

      const val = step.value !== null && step.value !== undefined ? step.value : '';
      el.focus();
      el.value = '';
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (step.type === 'select') {
      const el = findElement(step);
      if (!el) return;
      highlight(el);
      el.value = step.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (step.type === 'keydown') {
      const el = findElement(step) || document.activeElement || document.body;
      const key = step.key || 'Enter';
      el.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
      return;
    }

    if (step.type === 'scroll' && step.scroll) {
      window.scrollTo({ left: step.scroll.x, top: step.scroll.y, behavior: 'smooth' });
      return;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'EXECUTE_FLOW') {
      (async () => {
        const flow = msg.flow;
        for (let i = 0; i < flow.steps.length; i++) {
          try {
            await executeStep(flow.steps[i]);
          } catch (err) {
            console.warn('[Recordation Runner] Step', i + 1, 'warning:', err.message);
          }
        }
        sendResponse({ success: true, message: 'Flow finished' });
      })();
      return true;
    }
  });

})();
"""
        (out / "automation_engine.js").write_text(engine_code, encoding="utf-8")

        # 5. popup/popup.html
        popup_html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Run: {safe_title}</title>
  <style>
    body {{
      width: 300px;
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
    }}
    h1 {{
      font-size: 15px;
      margin: 0 0 4px 0;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }}
    .subtitle {{
      font-size: 11px;
      color: #94a3b8;
      margin-bottom: 14px;
    }}
    .btn {{
      width: 100%;
      min-height: 44px;
      border: none;
      border-radius: 8px;
      background: #6366f1;
      color: #ffffff;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      margin-top: 6px;
      transition: background 0.15s;
    }}
    .btn:active {{
      background: #4f46e5;
    }}
    .status {{
      margin-top: 10px;
      font-size: 12px;
      text-align: center;
      color: #10b981;
    }}
  </style>
</head>
<body>
  <h1>{safe_title}</h1>
  <div class="subtitle">Recordation Replay Engine ({len(recording.steps)} steps)</div>

  <button class="btn" id="btn-run">&#9658; Run Automation</button>
  <div class="status" id="status-text"></div>

  <script src="popup.js"></script>
</body>
</html>
"""
        (out / "popup" / "popup.html").write_text(popup_html, encoding="utf-8")

        # 6. popup/popup.js
        popup_js = """document.addEventListener('DOMContentLoaded', () => {
  const btnRun = document.getElementById('btn-run');
  const statusText = document.getElementById('status-text');

  btnRun.addEventListener('click', async () => {
    btnRun.disabled = true;
    statusText.textContent = 'Running automation on active tab...';
    statusText.style.color = '#fbbf24';

    try {
      const res = await chrome.runtime.sendMessage({ type: 'START_RUNNER' });
      if (res && res.success) {
        statusText.textContent = 'Automation finished!';
        statusText.style.color = '#10b981';
      } else {
        statusText.textContent = 'Status: ' + (res?.error || 'Completed');
        statusText.style.color = '#cbd5e1';
      }
    } catch (e) {
      statusText.textContent = 'Error: ' + e.message;
      statusText.style.color = '#ef4444';
    } finally {
      btnRun.disabled = false;
    }
  });
});
"""
        (out / "popup" / "popup.js").write_text(popup_js, encoding="utf-8")

        # 7. Copy icons from main extension
        main_icon_dir = Path("extension/icons")
        if main_icon_dir.is_dir():
            import shutil
            for ic in ("icon16.png", "icon48.png", "icon128.png"):
                src_icon = main_icon_dir / ic
                if src_icon.is_file():
                    shutil.copy2(src_icon, out / "icons" / ic)

        return out
