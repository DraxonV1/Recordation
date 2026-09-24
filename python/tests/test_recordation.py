"""Test suite for Recordation models, optimizer, and exporters."""

import sys
from pathlib import Path

# Ensure python package is in sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

import json
import py_compile
import pytest

from recordation.models import Recording, StepModel, TargetModel, SelectorsModel
from recordation.optimizer import RecordingOptimizer
from recordation.exporters.truedriver_exporter import TruedriverExporter
from recordation.exporters.extension_exporter import ExtensionExporter
from recordation.exporters.playwright_exporter import PlaywrightExporter


@pytest.fixture
def sample_recording_dict():
    return {
        "version": "1.0.0",
        "format": "recordation.rec",
        "metadata": {
            "title": "Test Registration Flow",
            "startUrl": "https://example.org/signup",
            "viewport": {"width": 412, "height": 915},
            "device": "Android Mobile / Lemur"
        },
        "steps": [
            {
                "id": "step_1",
                "type": "navigate",
                "url": "https://example.org/signup",
                "timestamp": 1000,
                "delayMs": 0
            },
            {
                "id": "step_2",
                "type": "click",
                "timestamp": 2000,
                "delayMs": 1000,
                "target": {
                    "tag": "INPUT",
                    "selectors": {
                        "css": "input[name='email']",
                        "xpath": "//input[@name='email']",
                        "name": "email",
                        "id": "user_email",
                        "ariaLabel": "Email"
                    }
                }
            },
            {
                "id": "step_3",
                "type": "input",
                "timestamp": 2500,
                "delayMs": 500,
                "value": "initial_typed@test.com",
                "target": {
                    "tag": "INPUT",
                    "selectors": {
                        "css": "input[name='email']",
                        "xpath": "//input[@name='email']",
                        "name": "email",
                        "id": "user_email",
                        "ariaLabel": "Email"
                    }
                }
            },
            {
                "id": "step_4",
                "type": "input",
                "timestamp": 3500,
                "delayMs": 1000,
                "value": "SecretPassword99!",
                "target": {
                    "tag": "INPUT",
                    "selectors": {
                        "css": "input[name='password']",
                        "xpath": "//input[@name='password']",
                        "name": "password",
                        "ariaLabel": "Password"
                    }
                }
            },
            {
                "id": "step_5",
                "type": "click",
                "timestamp": 4500,
                "delayMs": 1000,
                "target": {
                    "tag": "BUTTON",
                    "text": "Submit Registration",
                    "selectors": {
                        "css": "button.submit-btn",
                        "xpath": "//button[text()='Submit Registration']",
                        "testId": "submit-registration"
                    }
                }
            }
        ]
    }


def test_recording_model_load_save(tmp_path, sample_recording_dict):
    rec_file = tmp_path / "flow.rec"
    rec_file.write_text(json.dumps(sample_recording_dict), encoding="utf-8")

    rec = Recording.load(rec_file)
    assert rec.metadata.title == "Test Registration Flow"
    assert len(rec.steps) == 5
    assert rec.steps[0].type == "navigate"
    assert rec.steps[2].value == "initial_typed@test.com"

    # Save to new path and reload
    out_file = tmp_path / "flow_saved.rec"
    rec.save(out_file)
    assert out_file.is_file()

    reloaded = Recording.load(out_file)
    assert len(reloaded.steps) == 5


def test_optimizer_passes(sample_recording_dict):
    rec = Recording.model_validate(sample_recording_dict)

    # Add duplicate typing steps on step 3 target
    dup_input = StepModel(
        id="step_dup",
        type="input",
        timestamp=2600,
        value="final_typed@test.com",
        target=rec.steps[2].target
    )
    rec.steps.insert(3, dup_input)

    # Add rapid duplicate click
    dup_click = StepModel(
        id="step_click_dup",
        type="click",
        timestamp=4600,
        target=rec.steps[-1].target
    )
    rec.steps.append(dup_click)

    assert len(rec.steps) == 7

    optimized = RecordingOptimizer.optimize(rec, click_threshold_ms=300)
    assert len(optimized.steps) == 5
    assert optimized.steps[2].value == "final_typed@test.com"


def test_truedriver_exporter(tmp_path, sample_recording_dict):
    rec = Recording.model_validate(sample_recording_dict)
    code = TruedriverExporter.export(rec, headless=True)
    assert "import truedriver" in code
    assert "find_system_chrome()" in code
    assert "[name=\"email\"]" in code

    out_py = tmp_path / "truedriver_test.py"
    out_py.write_text(code, encoding="utf-8")
    py_compile.compile(str(out_py), doraise=True)


def test_extension_exporter(tmp_path, sample_recording_dict):
    rec = Recording.model_validate(sample_recording_dict)
    out_dir = tmp_path / "standalone_extension"
    ExtensionExporter.export(rec, out_dir)

    assert (out_dir / "manifest.json").is_file()
    assert (out_dir / "flow.json").is_file()
    assert (out_dir / "background.js").is_file()
    assert (out_dir / "automation_engine.js").is_file()
    assert (out_dir / "popup" / "popup.html").is_file()
    assert (out_dir / "popup" / "popup.js").is_file()

    manifest_data = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest_data["manifest_version"] == 3


def test_playwright_exporter(tmp_path, sample_recording_dict):
    rec = Recording.model_validate(sample_recording_dict)
    code = PlaywrightExporter.export(rec, is_async=False)
    assert "from playwright.sync_api import sync_playwright" in code

    out_py = tmp_path / "playwright_test.py"
    out_py.write_text(code, encoding="utf-8")
    py_compile.compile(str(out_py), doraise=True)
