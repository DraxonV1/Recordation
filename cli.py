#!/usr/bin/env python3
"""Convenience entry point for Recordation CLI."""

import sys
from pathlib import Path

# Add python directory to sys.path
sys.path.insert(0, str(Path(__file__).parent / "python"))

from recordation.cli import cli

if __name__ == "__main__":
    cli()
