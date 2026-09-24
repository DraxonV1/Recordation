"""Recordation Pydantic models for .rec file format."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Literal, Optional, Union
from pydantic import BaseModel, Field


class ViewportModel(BaseModel):
    width: int = 412
    height: int = 915


class BoundsModel(BaseModel):
    x: float = 0
    y: float = 0
    width: float = 0
    height: float = 0


class SelectorsModel(BaseModel):
    css: str
    xpath: str
    testId: Optional[str] = None
    id: Optional[str] = None
    name: Optional[str] = None
    ariaLabel: Optional[str] = None
    role: Optional[str] = None
    text: Optional[str] = None

    def best_selector(self) -> str:
        """Returns the most reliable selector in priority order."""
        if self.testId:
            return f"[data-testid='{self.testId}']"
        if self.name:
            return f"[name='{self.name}']"
        if self.ariaLabel:
            return f"[aria-label='{self.ariaLabel}']"
        if self.id and not self.id.isdigit():
            return f"#{self.id}"
        return self.css


class TargetModel(BaseModel):
    tag: Optional[str] = None
    text: Optional[str] = None
    selectors: SelectorsModel
    bounds: Optional[BoundsModel] = None

    def get_field_label(self) -> str:
        """Infer friendly field name (e.g. Email, Password, Search)."""
        if self.selectors.ariaLabel:
            return self.selectors.ariaLabel.strip()
        if self.selectors.name:
            return self.selectors.name.strip()
        if self.selectors.testId:
            return self.selectors.testId.strip()
        if self.text and len(self.text) < 25:
            return self.text.strip()
        if self.selectors.id:
            return self.selectors.id.strip()
        return self.selectors.css


class ScrollModel(BaseModel):
    x: float = 0
    y: float = 0


StepType = Literal[
    "navigate",
    "click",
    "dblclick",
    "input",
    "change",
    "select",
    "keydown",
    "submit",
    "scroll",
    "wait"
]


class StepModel(BaseModel):
    id: str
    type: StepType
    url: Optional[str] = None
    timestamp: int
    delayMs: Optional[int] = 0
    target: Optional[TargetModel] = None
    value: Optional[Union[str, int, float, bool]] = None
    key: Optional[str] = None
    scroll: Optional[ScrollModel] = None
    description: Optional[str] = None

    def get_summary(self) -> str:
        """Short human-readable summary of the step."""
        if self.type == "navigate":
            return f"Navigate -> {self.url}"
        if self.type in ("click", "dblclick"):
            target_str = self.target.selectors.best_selector() if self.target else "unknown"
            txt = f" '{self.target.text}'" if (self.target and self.target.text) else ""
            return f"{self.type.upper()}{txt} ({target_str})"
        if self.type == "input":
            target_str = self.target.selectors.best_selector() if self.target else "input"
            val_preview = f'"{self.value}"' if self.value is not None else '""'
            return f"Type {val_preview} into {target_str}"
        if self.type == "select":
            target_str = self.target.selectors.best_selector() if self.target else "select"
            return f"Select '{self.value}' on {target_str}"
        if self.type == "change":
            target_str = self.target.selectors.best_selector() if self.target else "element"
            return f"Change to '{self.value}' on {target_str}"
        if self.type == "keydown":
            return f"Press [{self.key}]"
        if self.type == "submit":
            return f"Submit Form"
        if self.type == "scroll" and self.scroll:
            return f"Scroll to ({self.scroll.x}, {self.scroll.y})"
        if self.type == "wait":
            return f"Wait {self.delayMs}ms"
        return f"{self.type} step"


class MetadataModel(BaseModel):
    title: str = "Recorded Flow"
    description: Optional[str] = ""
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updatedAt: Optional[str] = None
    userAgent: Optional[str] = None
    viewport: ViewportModel = Field(default_factory=ViewportModel)
    device: Optional[str] = "Android Mobile / Lemur"
    startUrl: str = "about:blank"
    durationMs: Optional[int] = 0


class Recording(BaseModel):
    version: str = "1.0.0"
    format: str = "recordation.rec"
    metadata: MetadataModel
    steps: List[StepModel] = Field(default_factory=list)

    @classmethod
    def load(cls, path_or_str: Union[str, Path]) -> Recording:
        """Loads and validates a .rec file."""
        path = Path(path_or_str)
        if path.is_file():
            content = path.read_text(encoding="utf-8")
        else:
            content = str(path_or_str)
        data = json.loads(content)
        return cls.model_validate(data)

    def save(self, path: Union[str, Path]) -> None:
        """Saves recording to a .rec file formatted as JSON."""
        target_path = Path(path)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        self.metadata.updatedAt = datetime.now(timezone.utc).isoformat()
        raw_json = self.model_dump_json(indent=2, exclude_none=True)
        target_path.write_text(raw_json, encoding="utf-8")

    def reindex_steps(self) -> None:
        """Ensure all step IDs are sequential."""
        for i, step in enumerate(self.steps, start=1):
            step.id = f"step_{i}"
