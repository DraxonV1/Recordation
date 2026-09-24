"""Recordation CLI: Inspect recordings and export to TrueDriver, Extensions, and Playwright."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from recordation.models import Recording, StepModel
from recordation.optimizer import RecordingOptimizer
from recordation.exporters.truedriver_exporter import TruedriverExporter
from recordation.exporters.extension_exporter import ExtensionExporter
from recordation.exporters.playwright_exporter import PlaywrightExporter

console = Console()


@click.group()
@click.version_option(version="1.0.0", prog_name="recordation")
def cli():
    """Recordation - Visual Automation Builder.

    A browser extension that records your actions to export them to executable
    browser automation (Python TrueDriver or standalone Chrome Extensions).
    """
    pass


@cli.command("info")
@click.argument("rec_file", type=click.Path(exists=True, dir_okay=False))
def info_cmd(rec_file: str):
    """Display metadata and flow summary of a .rec file."""
    rec = Recording.load(rec_file)
    meta = rec.metadata

    panel_content = f"""[bold cyan]Title:[/bold cyan] {meta.title}
[bold cyan]Start URL:[/bold cyan] {meta.startUrl}
[bold cyan]Device:[/bold cyan] {meta.device or 'Android / Mobile'}
[bold cyan]Viewport:[/bold cyan] {meta.viewport.width} x {meta.viewport.height}
[bold cyan]Created:[/bold cyan] {meta.createdAt}
[bold cyan]Steps Count:[/bold cyan] {len(rec.steps)}"""

    console.print(Panel(panel_content, title=f"[bold green]Recordation Flow: {Path(rec_file).name}[/bold green]", border_style="cyan"))

    counts = {}
    for s in rec.steps:
        counts[s.type] = counts.get(s.type, 0) + 1

    table = Table(title="Action Distribution", header_style="bold magenta")
    table.add_column("Action Type", style="cyan")
    table.add_column("Count", justify="right", style="green")
    for act, cnt in sorted(counts.items()):
        table.add_row(act.upper(), str(cnt))
    console.print(table)


@cli.command("list")
@click.argument("rec_file", type=click.Path(exists=True, dir_okay=False))
def list_cmd(rec_file: str):
    """List all steps in the recorded flow with selectors and values."""
    rec = Recording.load(rec_file)

    table = Table(title=f"Recorded Steps ({len(rec.steps)}) - {rec.metadata.title}", header_style="bold blue")
    table.add_column("#", justify="right", style="dim", width=4)
    table.add_column("Action", style="bold", width=10)
    table.add_column("Target / Field", width=30)
    table.add_column("Value", width=30)
    table.add_column("Delay", justify="right", width=8)

    type_colors = {
        "navigate": "blue",
        "click": "green",
        "dblclick": "teal",
        "input": "magenta",
        "change": "yellow",
        "select": "yellow",
        "keydown": "red",
        "submit": "bright_red",
        "scroll": "dim"
    }

    for idx, step in enumerate(rec.steps, start=1):
        color = type_colors.get(step.type, "white")
        action_text = f"[{color}]{step.type.upper()}[/{color}]"

        field_target = ""
        if step.type == "navigate":
            field_target = step.url or ""
        elif step.target:
            field_label = step.target.get_field_label()
            selector_brief = step.target.selectors.best_selector()
            field_target = f"[bold]{field_label}[/bold]\n[dim]{selector_brief}[/dim]"

        val_text = ""
        if step.value is not None:
            val_text = f'"{step.value}"'
        elif step.key:
            val_text = f"[{step.key}]"
        elif step.scroll:
            val_text = f"X:{step.scroll.x}, Y:{step.scroll.y}"

        delay_str = f"{step.delayMs or 0}ms"
        table.add_row(str(idx), action_text, field_target, val_text, delay_str)

    console.print(table)


@cli.command("export-py")
@click.argument("rec_file", type=click.Path(exists=True, dir_okay=False))
@click.option("-o", "--output", default="automation.py", help="Output python script filename")
@click.option("--headless", is_flag=True, help="Run browser in headless mode")
@click.option("--chrome-path", default="", help="Custom path to Google Chrome binary")
@click.option("--slow-mo", default=0.5, type=float, help="Delay between actions in seconds")
def export_py_cmd(rec_file: str, output: str, headless: bool, chrome_path: str, slow_mo: float):
    """Export flow to production Python automation using TrueDriver + system Chrome."""
    rec = Recording.load(rec_file)
    code = TruedriverExporter.export(
        recording=rec,
        headless=headless,
        slow_mo=slow_mo,
        chrome_path=chrome_path
    )
    out_path = Path(output)
    out_path.write_text(code, encoding="utf-8")
    console.print(f"[bold green]✓ Successfully exported TrueDriver automation script to:[/bold green] [cyan]{out_path.resolve()}[/cyan]")
    console.print(f"[dim]Run with:[/dim] [bold yellow]python {output}[/bold yellow]")


@cli.command("export-ext")
@click.argument("rec_file", type=click.Path(exists=True, dir_okay=False))
@click.option("-o", "--output-dir", default="./automation_extension", help="Output extension folder")
def export_ext_cmd(rec_file: str, output_dir: str):
    """Export flow into a standalone Chrome Extension for Lemur/Kiwi and Desktop Chrome."""
    rec = Recording.load(rec_file)
    out_path = ExtensionExporter.export(recording=rec, output_dir=output_dir)
    console.print(f"[bold green]✓ Successfully exported standalone Chrome Extension to:[/bold green] [cyan]{out_path.resolve()}[/cyan]")
    console.print("[dim]Load in Kiwi/Lemur Android: Extensions -> Load Unpacked -> select folder.[/dim]")


@cli.command("export-playwright")
@click.argument("rec_file", type=click.Path(exists=True, dir_okay=False))
@click.option("-o", "--output", default="playwright_flow.py", help="Output script path")
@click.option("--async-mode", is_flag=True, help="Generate async Playwright code")
@click.option("--headless", is_flag=True, help="Run headless")
def export_playwright_cmd(rec_file: str, output: str, async_mode: bool, headless: bool):
    """Export flow to Playwright Python script."""
    rec = Recording.load(rec_file)
    code = PlaywrightExporter.export(recording=rec, is_async=async_mode, headless=headless)
    Path(output).write_text(code, encoding="utf-8")
    console.print(f"[bold green]✓ Exported Playwright automation to:[/bold green] [cyan]{output}[/cyan]")


@cli.command("optimize")
@click.argument("rec_file", type=click.Path(exists=True, dir_okay=False))
@click.option("-o", "--output", default=None, help="Output file (default overwrites input)")
@click.option("--max-delay", default=1500, type=int, help="Maximum delay between steps in ms")
def optimize_cmd(rec_file: str, output: Optional[str], max_delay: int):
    """Clean up redundant clicks, debounce inputs, and standardize delays."""
    rec = Recording.load(rec_file)
    orig_count = len(rec.steps)
    optimized = RecordingOptimizer.optimize(rec, max_delay_ms=max_delay)

    save_path = output or rec_file
    optimized.save(save_path)
    console.print(f"[bold green]✓ Optimized recording:[/bold green] {orig_count} steps -> {len(optimized.steps)} steps saved to [cyan]{save_path}[/cyan]")


if __name__ == "__main__":
    cli()
