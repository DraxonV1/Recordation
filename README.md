# Recordation 🎬

[![Author](https://img.shields.io/badge/Author-DraxonV1-8a2be2)](https://github.com/DraxonV1)
[![Python Version](https://img.shields.io/badge/python-3.9%20%7C%203.10%20%7C%203.11%20%7C%203.12-blue)](https://python.org)
[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-brightgreen)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Mobile Support](https://img.shields.io/badge/Android-Kiwi%20%7C%20Lemur-orange)](https://github.com/DraxonV1/recordation)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Visual Browser Automation Builder** created by **DraxonV1** for **Kiwi Browser** and **Lemur Browser** on Android, as well as desktop Chromium browsers.

Record exact user interactions on your mobile or desktop browser into standardized `.rec` files, then export them directly into **TrueDriver Python scripts** (with automatic system Chrome detection) or **standalone Chrome extensions** that replay the automation anywhere.

---

## ✨ Features

- **📱 Touchscreen & Mobile Ready:** Designed specifically for Android mobile browsers (Kiwi and Lemur).
- **🕹️ In-Page Floating HUD:** Draggable on-screen widget with step counter, pulse recording indicator, pause/resume, and instant `.rec` download.
- **🎯 Multi-Strategy Selector Engine:** Captures stable element selectors:
  - Semantic form attributes (`name="email"`, `name="password"`)
  - Accessibility labels (`aria-label`)
  - Testing attributes (`data-testid`, `data-cy`)
  - Button/link text content
  - Unique hierarchical CSS paths and XPaths
- **⚡ Multiple Export Targets:**
  - **TrueDriver (`export-py`):** Undetectable CDP automation with automatic system Google Chrome binary discovery (`find_system_chrome()`).
  - **Standalone Extension (`export-ext`):** Unpacked Chrome Extension you can load back into Kiwi, Lemur, or Desktop Chrome to replay the automation.
  - **Playwright (`export-playwright`):** Production-ready Playwright sync or async scripts.
- **🧹 Noise Optimizer (`optimize`):** Merges rapid typing steps, cleans accidental double-clicks, and standardizes pauses.

---

## 🏗️ Architecture

```
recordation/
├── extension/                  # Chrome Extension (Manifest V3)
│   ├── manifest.json           # MV3 extension manifest
│   ├── background.js           # State broker & tab navigation listener
│   ├── content/
│   │   ├── selector-generator.js # Multi-strategy selector builder
│   │   ├── floating-hud.js     # Draggable on-screen mobile HUD
│   │   └── recorder.js         # Event capturer (click, input, select, keydown, submit)
│   ├── popup/                  # Touch-friendly popup controller
│   └── icons/                  # High-DPI extension icons
├── python/
│   └── recordation/
│       ├── models.py           # Pydantic models for .rec format
│       ├── optimizer.py        # Deduplication & debounce heuristics
│       ├── cli.py              # Click + Rich CLI commands
│       └── exporters/
│           ├── truedriver_exporter.py # TrueDriver + System Chrome generator
│           ├── extension_exporter.py  # Standalone replay extension generator
│           └── playwright_exporter.py # Playwright sync/async generator
├── examples/                   # Sample recorded flows
├── pyproject.toml              # Packaging & CLI entry point
└── recordation-extension.zip   # Ready-to-install mobile extension zip
```

---

## 🚀 Quickstart

### 1. Install Extension on Android (Kiwi or Lemur Browser)

1. Download [`recordation-extension.zip`](recordation-extension.zip) to your device (or clone this repository).
2. Open **Kiwi Browser** or **Lemur Browser**.
3. Tap the three-dot menu `⋮` -> **Extensions**.
4. Enable **Developer Mode** (top-right toggle).
5. Tap **+(from .zip / .crx / folder)** and select `recordation-extension.zip` (or select the `extension/` folder).
6. **Recordation** is now installed and ready in your browser toolbar!

### 2. Record an Automation Flow

1. Open any target website (e.g. `https://discord.com/register`).
2. Tap the **Recordation** icon from your browser's menu.
3. Tap **Start Recording**:
   - The popup closes automatically and returns focus to your active tab.
   - A floating **HUD widget** appears on screen showing recording status and live step count.
   - Drag the HUD anywhere on screen so it doesn't obstruct form elements.
4. Perform your exact actions:
   - Click buttons, tabs, links.
   - Type in text fields (passwords, usernames, search queries).
   - Select dropdown items or toggle checkboxes.
   - Navigate across pages or single-page application routes.
5. When finished, tap **Save .rec** on the floating HUD (or tap **Stop & Save** in the popup).
6. The `.rec` file will download to your device immediately.

---

## 💻 Python CLI Tool

Install the companion CLI locally:

```bash
git clone https://github.com/DraxonV1/recordation.git
cd recordation
pip install -e .
```

Verify installation:
```bash
recordation --version
```

### Inspect Recording
```bash
recordation info my_flow.rec
```

### List Recorded Steps with Selectors
```bash
recordation list my_flow.rec
```

### Export to TrueDriver (System Chrome)
Generates an undetectable automation script using `truedriver` that detects installed system Chrome across Windows, Linux, and macOS:
```bash
recordation export-py my_flow.rec -o automation.py

# Run the generated automation:
python automation.py
```

### Export to Standalone Replay Extension
Generates an unpacked Chrome Extension ready to load into Kiwi, Lemur, or Desktop Chrome:
```bash
recordation export-ext my_flow.rec -o ./my_runner_extension
```

To run in Kiwi/Lemur:
1. Transfer `./my_runner_extension` to your device.
2. Go to **Extensions** -> **Load Unpacked**.
3. Open target site, tap the runner extension, and click **Run Automation**.

### Export to Playwright
```bash
recordation export-playwright my_flow.rec -o playwright_script.py
```

### Optimize Recording
Cleans up redundant double-clicks, debounces rapid typing inputs, and clamps excessive idle pauses:
```bash
recordation optimize my_flow.rec -o optimized.rec
```

---

## 📄 .rec File Specification

Recordation files (`.rec`) use a portable JSON format:

```json
{
  "version": "1.0.0",
  "format": "recordation.rec",
  "metadata": {
    "title": "Registration Flow",
    "createdAt": "2026-09-24T12:00:00Z",
    "viewport": { "width": 412, "height": 915 },
    "startUrl": "https://example.com/signup"
  },
  "steps": [
    {
      "id": "step_1",
      "type": "navigate",
      "url": "https://example.com/signup",
      "timestamp": 1774430400000,
      "delayMs": 0
    },
    {
      "id": "step_2",
      "type": "input",
      "value": "user@example.com",
      "target": {
        "tag": "INPUT",
        "selectors": {
          "name": "email",
          "ariaLabel": "Email Address",
          "css": "input[name='email']",
          "xpath": "//input[@name='email']"
        }
      },
      "timestamp": 1774430401500,
      "delayMs": 1500
    }
  ]
}
```

---

## 🧪 Running Tests

```bash
pytest python/tests/test_recordation.py -v
```

---

## 👤 Author

Created by **[DraxonV1](https://github.com/DraxonV1)**.

---

## 📜 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.
