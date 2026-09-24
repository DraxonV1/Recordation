"""Recording optimizer: cleans up raw recordings into clean, fast, deterministic automations."""

from typing import List
from recordation.models import Recording, StepModel


class RecordingOptimizer:
    """Optimizes recorded user actions by removing noise, merging typing, and standardizing delays."""

    @staticmethod
    def merge_inputs(steps: List[StepModel]) -> List[StepModel]:
        """Merges consecutive input steps on the same element, keeping the final string value."""
        if not steps:
            return []

        merged: List[StepModel] = []
        for step in steps:
            if not merged:
                merged.append(step)
                continue

            prev = merged[-1]
            if (
                step.type == "input"
                and prev.type == "input"
                and step.target
                and prev.target
                and step.target.selectors.css == prev.target.selectors.css
            ):
                # Replace previous with latest typed value
                prev.value = step.value
                prev.timestamp = step.timestamp
                prev.description = f"Type '{step.value}'"
            else:
                merged.append(step)

        return merged

    @staticmethod
    def deduplicate_clicks(steps: List[StepModel], threshold_ms: int = 350) -> List[StepModel]:
        """Removes accidental double-clicks or rapid successive clicks on the exact same target."""
        if not steps:
            return []

        cleaned: List[StepModel] = []
        for step in steps:
            if not cleaned:
                cleaned.append(step)
                continue

            prev = cleaned[-1]
            if (
                step.type == "click"
                and prev.type == "click"
                and step.target
                and prev.target
                and step.target.selectors.css == prev.target.selectors.css
                and (step.timestamp - prev.timestamp) < threshold_ms
            ):
                # Skip duplicate click within threshold
                continue
            cleaned.append(step)

        return cleaned

    @staticmethod
    def clamp_delays(steps: List[StepModel], max_delay_ms: int = 1500, min_delay_ms: int = 100) -> List[StepModel]:
        """Clamps long pauses (reading/thinking time) to ensure fast automation runs."""
        for step in steps:
            if step.delayMs is not None:
                if step.delayMs > max_delay_ms:
                    step.delayMs = max_delay_ms
                elif step.delayMs < min_delay_ms and step.type != "navigate":
                    step.delayMs = min_delay_ms
        return steps

    @staticmethod
    def remove_jitter_scrolls(steps: List[StepModel], min_delta: int = 80) -> List[StepModel]:
        """Filters out small jittery scrolling movements."""
        cleaned: List[StepModel] = []
        last_y = 0

        for step in steps:
            if step.type == "scroll" and step.scroll:
                if abs(step.scroll.y - last_y) < min_delta:
                    continue
                last_y = int(step.scroll.y)
            cleaned.append(step)

        return cleaned

    @classmethod
    def optimize(
        cls,
        recording: Recording,
        max_delay_ms: int = 1500,
        min_delay_ms: int = 100,
        click_threshold_ms: int = 350
    ) -> Recording:
        """Runs the full optimization pipeline on a recording."""
        steps = recording.steps
        steps = cls.merge_inputs(steps)
        steps = cls.deduplicate_clicks(steps, threshold_ms=click_threshold_ms)
        steps = cls.remove_jitter_scrolls(steps)
        steps = cls.clamp_delays(steps, max_delay_ms=max_delay_ms, min_delay_ms=min_delay_ms)

        recording.steps = steps
        recording.reindex_steps()
        return recording
