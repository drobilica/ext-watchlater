#!/usr/bin/env python3
"""Zip the Vite build into dist/clear-watch-later.xpi."""

import shutil
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "build" / "extension"
OUT_DIR = ROOT / "dist"
OUT = OUT_DIR / "clear-watch-later.xpi"


def pack() -> Path:
    manifest = SRC / "manifest.json"
    if not manifest.is_file():
        raise SystemExit("missing build/extension/manifest.json — run: pnpm build")
    icon_src = ROOT / "src" / "icons" / "icon.svg"
    icon_dest = SRC / "icons" / "icon.svg"
    if icon_src.is_file():
        icon_dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(icon_src, icon_dest)
    OUT_DIR.mkdir(exist_ok=True)
    if OUT.exists():
        OUT.unlink()
    with ZipFile(OUT, "w", ZIP_DEFLATED) as archive:
        for path in sorted(SRC.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(SRC).as_posix())
    return OUT


if __name__ == "__main__":
    built = pack()
    print(built)
    print("Firefox → about:debugging#/runtime/this-firefox")
    print("Load Temporary Add-on… → pick that .xpi")
