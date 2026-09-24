"""TrueDriver Python automation generator with system Chrome binary detection."""

from __future__ import annotations

from typing import List
from recordation.models import Recording, StepModel


class TruedriverExporter:
    """Exports a Recordation .rec model into a production-grade Python script using truedriver and system Chrome."""

    @staticmethod
    def _sanitize(s: str) -> str:
        return s.replace('\\', '\\\\').replace('"', '\\"').replace("'", "\\'")

    @classmethod
    def export(
        cls,
        recording: Recording,
        headless: bool = False,
        slow_mo: float = 0.5,
        chrome_path: str = ""
    ) -> str:
        meta = recording.metadata
        viewport = meta.viewport

        code: List[str] = [
            '#!/usr/bin/env python3',
            '"""',
            f'Recordation Automation - TrueDriver Engine',
            f'Flow: {meta.title}',
            f'Created: {meta.createdAt}',
            f'Start URL: {meta.startUrl}',
            '"""',
            '',
            'import os',
            'import sys',
            'import time',
            'import shutil',
            'import asyncio',
            'from pathlib import Path',
            'import truedriver',
            '',
            '# System Chrome Binary Resolution',
            'def find_system_chrome() -> str | None:',
            '    """Detects installed system Google Chrome binary across Windows, Linux, and macOS."""',
            '    explicit_override = os.environ.get("CHROME_PATH") or os.environ.get("CHROME_BIN")',
            '    if explicit_override and Path(explicit_override).is_file():',
            '        return explicit_override',
            '',
            '    candidates = []',
            '    if sys.platform == "win32":',
            '        local_app = os.environ.get("LOCALAPPDATA", "")',
            '        prog_files = os.environ.get("ProgramFiles", r"C:\\Program Files")',
            '        prog_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\\Program Files (x86)")',
            '        candidates = [',
            '            Path(prog_files) / "Google/Chrome/Application/chrome.exe",',
            '            Path(prog_files_x86) / "Google/Chrome/Application/chrome.exe",',
            '            Path(local_app) / "Google/Chrome/Application/chrome.exe",',
            '            Path(prog_files) / "BraveSoftware/Brave-Browser/Application/brave.exe"',
            '        ]',
            '    elif sys.platform == "darwin":',
            '        candidates = [',
            '            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),',
            '            Path("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser")',
            '        ]',
            '    else: # Linux / Android termux / container',
            '        for binary in ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium"):',
            '            found = shutil.which(binary)',
            '            if found:',
            '                return found',
            '',
            '    for cand in candidates:',
            '        if cand.is_file():',
            '            return str(cand.resolve())',
            '',
            '    return None',
            '',
            'async def run_flow():',
            '    chrome_bin = find_system_chrome()'
        ]

        if chrome_path:
            code.append(f"    chrome_bin = '{cls._sanitize(chrome_path)}'")

        user_agent_arg = f", user_agent='{cls._sanitize(meta.userAgent)}'" if meta.userAgent else ""

        code.extend([
            '    print(f"[*] Starting TrueDriver with system Chrome: {chrome_bin or \'auto-detect\'}")',
            f'    browser = await truedriver.start(',
            f'        headless={headless},',
            f'        browser_executable_path=chrome_bin,',
            f'        browser_args=["--window-size={viewport.width},{viewport.height}"]'
            f'{user_agent_arg}',
            '    )',
            '',
            '    try:',
            '        tab = browser.main_tab',
            f'        await tab.set_window_size(0, 0, width={viewport.width}, height={viewport.height})',
            ''
        ])

        # Generate each recorded step
        for i, step in enumerate(recording.steps, start=1):
            desc = step.description or f"Step {i}: {step.type}"
            code.append(f"        # [{i}/{len(recording.steps)}] {desc}")

            # Optional delay
            if step.delayMs and step.delayMs > 250:
                sec = round(step.delayMs / 1000.0, 2)
                code.append(f"        await tab.sleep({sec})")

            if step.type == "navigate" and step.url:
                code.append(f"        print('-> Navigating to: {cls._sanitize(step.url)}')")
                code.append(f"        tab = await browser.get('{cls._sanitize(step.url)}')")
                code.append("        await tab.wait_for_ready_state('interactive')")

            elif step.type in ("click", "dblclick"):
                css = cls._sanitize(step.target.selectors.css) if step.target else ""
                xp = cls._sanitize(step.target.selectors.xpath) if step.target else ""
                text_target = cls._sanitize(step.target.text) if (step.target and step.target.text) else ""
                name_target = cls._sanitize(step.target.selectors.name) if (step.target and step.target.selectors.name) else ""
                aria_target = cls._sanitize(step.target.selectors.ariaLabel) if (step.target and step.target.selectors.ariaLabel) else ""

                code.append("        # Resolve element with multi-strategy cascade")
                code.append("        elem = None")
                if name_target:
                    code.append(f"        if not elem: elem = await tab.query_selector('[name=\"{name_target}\"]')")
                if aria_target:
                    code.append(f"        if not elem: elem = await tab.query_selector('[aria-label=\"{aria_target}\"]')")
                if text_target and len(text_target) < 35:
                    code.append(f"        if not elem:")
                    code.append(f"            t_elems = await tab.find_elements_by_text('{text_target}')")
                    code.append("            elem = t_elems[0] if t_elems else None")
                if css:
                    code.append(f"        if not elem and '{css}': elem = await tab.query_selector('{css}')")
                if xp:
                    code.append(f"        if not elem: xp_elems = await tab.xpath('{xp}'); elem = xp_elems[0] if xp_elems else None")

                code.append("        if elem:")
                if step.type == "dblclick":
                    code.append("            await elem.click()")
                    code.append("            await tab.sleep(0.1)")
                    code.append("            await elem.click()")
                else:
                    code.append("            await elem.click()")
                code.append("        else:")
                code.append(f"            print('[WARN] Element not found: {css or name_target or text_target}')")

            elif step.type == "input":
                css = cls._sanitize(step.target.selectors.css) if step.target else ""
                xp = cls._sanitize(step.target.selectors.xpath) if step.target else ""
                val_to_type = cls._sanitize(str(step.value or ""))
                name_target = cls._sanitize(step.target.selectors.name) if (step.target and step.target.selectors.name) else ""
                aria_target = cls._sanitize(step.target.selectors.ariaLabel) if (step.target and step.target.selectors.ariaLabel) else ""

                code.append(f"        val_to_type = '{val_to_type}'")
                code.append("        elem = None")
                if name_target:
                    code.append(f"        if not elem: elem = await tab.query_selector('[name=\"{name_target}\"]')")
                if aria_target:
                    code.append(f"        if not elem: elem = await tab.query_selector('[aria-label=\"{aria_target}\"]')")
                if css:
                    code.append(f"        if not elem and '{css}': elem = await tab.query_selector('{css}')")
                if xp:
                    code.append(f"        if not elem: xp_elems = await tab.xpath('{xp}'); elem = xp_elems[0] if xp_elems else None")
                code.append("        if elem:")
                code.append("            await elem.click()")
                code.append("            await elem.clear_input()")
                code.append("            await elem.send_keys(str(val_to_type))")
                code.append("        else:")
                code.append(f"            print('[WARN] Input field not found: {css}')")

            elif step.type in ("select", "change"):
                css = cls._sanitize(step.target.selectors.css) if step.target else ""
                val = cls._sanitize(str(step.value or ""))

                code.append(f"        val = '{val}'")
                code.append(f"        elem = await tab.query_selector('{css}')")
                code.append("        if elem:")
                code.append("            await elem.set_value(str(val))")
                code.append("        else:")
                code.append(f"            print('[WARN] Select/Change field not found: {css}')")

            elif step.type == "keydown":
                key = step.key or "Enter"
                target_css = step.target.selectors.css if step.target else "body"
                code.append(f"        elem = await tab.query_selector('{cls._sanitize(target_css)}')")
                code.append("        if elem:")
                if key == "Enter":
                    code.append("            await elem.send_keys('\\n')")
                elif key == "Tab":
                    code.append("            await elem.send_keys('\\t')")
                else:
                    code.append(f"            await elem.send_keys('{cls._sanitize(key)}')")

            elif step.type == "submit":
                css = cls._sanitize(step.target.selectors.css) if step.target else "form"
                code.append(f"        elem = await tab.query_selector('{css}')")
                code.append("        if elem:")
                code.append("            await elem.send_keys('\\n')")

            elif step.type == "scroll" and step.scroll:
                code.append(f"        await tab.scroll_down({int(step.scroll.y / 20)})")

            elif step.type == "wait":
                sec = round((step.delayMs or 1000) / 1000.0, 2)
                code.append(f"        await tab.sleep({sec})")

            code.append('')

        # Teardown
        code.extend([
            '        print("[+] Automation flow completed successfully!")',
            '        await tab.sleep(1.0)',
            '    finally:',
            '        await browser.stop()',
            '',
            'if __name__ == "__main__":',
            '    asyncio.run(run_flow())'
        ])

        return '\n'.join(code) + '\n'
