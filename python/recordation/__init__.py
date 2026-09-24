"""Recordation - Visual Automation Builder.

Record browser flows in Lemur/Kiwi on Android & Desktop Chromium,
and export directly to TrueDriver or standalone Chrome Extensions.
"""

from recordation.models import Recording, StepModel, TargetModel, SelectorsModel
from recordation.optimizer import RecordingOptimizer
from recordation.exporters.truedriver_exporter import TruedriverExporter
from recordation.exporters.extension_exporter import ExtensionExporter
from recordation.exporters.playwright_exporter import PlaywrightExporter

__version__ = "1.0.0"
__all__ = [
    "Recording",
    "StepModel",
    "TargetModel",
    "SelectorsModel",
    "RecordingOptimizer",
    "TruedriverExporter",
    "ExtensionExporter",
    "PlaywrightExporter"
]
