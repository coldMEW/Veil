#!/usr/bin/env python3
"""Local verification orchestrator. Python 3.11+, Pillow and numpy; no remote image APIs."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from urllib.parse import urlsplit

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
PREFIX = "VEIL_VERIFY_JSON "


def stop_process(process: subprocess.Popen) -> None:
    """Stop only our owned process tree, including Vite/npx descendants."""
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
    if os.name != "nt":
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def spawn(command: list[str], **kwargs) -> subprocess.Popen:
    options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
    return subprocess.Popen(command, cwd=ROOT, **options, **kwargs)


def command_run(command: list[str], env: dict[str, str], timeout: int = 600) -> tuple[int, str, float]:
    started = time.monotonic()
    process = spawn(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace")
    try:
        output, _ = process.communicate(timeout=timeout)
        return process.returncode, output, time.monotonic() - started
    except subprocess.TimeoutExpired:
        stop_process(process)
        process.communicate()
        return 124, "Verification command timed out.", time.monotonic() - started
    except BaseException:
        stop_process(process)
        raise


def rgb(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return ImageOps.exif_transpose(image).convert("RGB")


def psnr(original: Path, shielded: Path) -> float | str:
    a, b = rgb(original), rgb(shielded)
    if a.size != b.size:
        a = a.resize(b.size, Image.Resampling.LANCZOS)
    delta = np.asarray(a, dtype=np.float32) - np.asarray(b, dtype=np.float32)
    mse = float(np.mean(delta * delta, dtype=np.float64))
    return round(10 * math.log10(255 * 255 / mse), 6) if mse else "infinite"


def changed_components(mask: np.ndarray) -> list[dict]:
    """Exact eight-connected components via row runs/union-find; no scipy dependency."""
    parent: list[int] = []
    bounds: list[list[int]] = []
    areas: list[int] = []

    def find(label: int) -> int:
        while parent[label] != label:
            parent[label] = parent[parent[label]]
            label = parent[label]
        return label

    def union(a: int, b: int) -> int:
        a, b = find(a), find(b)
        if a == b:
            return a
        parent[b] = a
        x0, y0, x1, y1 = bounds[b]
        bounds[a] = [min(bounds[a][0], x0), min(bounds[a][1], y0),
                     max(bounds[a][2], x1), max(bounds[a][3], y1)]
        areas[a] += areas[b]
        return a

    previous: list[tuple[int, int, int]] = []
    for y, row in enumerate(mask):
        edges = np.flatnonzero(np.diff(np.pad(row.astype(np.int8), (1, 1))))
        current = []
        cursor = 0
        for start, end in zip(edges[::2].tolist(), edges[1::2].tolist()):
            label = len(parent)
            parent.append(label)
            bounds.append([start, y, end, y + 1])
            areas.append(end - start)
            while cursor < len(previous) and previous[cursor][1] < start:
                cursor += 1
            j = cursor
            while j < len(previous) and previous[j][0] <= end:
                label = union(label, previous[j][2])
                j += 1
            current.append((start, end, label))
        previous = current
    return sorted([{"bbox": bounds[i], "pixels": areas[i]}
                   for i in range(len(parent)) if find(i) == i],
                  key=lambda component: component["pixels"], reverse=True)


def clean_diff(original: Path, cleaned: Path, out: Path, min_pixels: int = 1) -> dict:
    before, after = rgb(original), rgb(cleaned)
    if before.size != after.size:
        raise ValueError("Clean changed oriented dimensions; pixel comparison invalid.")
    delta = np.abs(np.asarray(before, dtype=np.int16) - np.asarray(after, dtype=np.int16))
    changed = np.max(delta, axis=2) > 8
    components = changed_components(changed)
    regions = [c for c in components if c["pixels"] >= min_pixels]
    crop_dir = out / "clean-regions"
    crop_dir.mkdir(exist_ok=True)
    for index, region in enumerate(regions, 1):
        x0, y0, x1, y1 = region["bbox"]
        crop_box = (max(0, x0 - 12), max(0, y0 - 12), min(before.width, x1 + 12), min(before.height, y1 + 12))
        a, b = before.crop(crop_box), after.crop(crop_box)
        side = Image.new("RGB", (a.width * 2, a.height), "white")
        side.paste(a, (0, 0))
        side.paste(b, (a.width, 0))
        file = crop_dir / f"region-{index:04d}.png"
        side.save(file)
        region["preview"] = file.relative_to(out).as_posix()
    # Keep every exact component bbox, even tiny re-encoding noise; previews use an explicit floor.
    (out / "clean-components.json").write_text(json.dumps(components, indent=2), encoding="utf-8")
    Image.fromarray(changed.astype(np.uint8) * 255).save(out / "clean-diff-mask.png")
    return {"width": before.width, "height": before.height, "threshold": "max RGB absolute difference >8",
            "changedPixels": int(changed.sum()), "changedPercent": round(100 * float(changed.mean()), 6),
            "totalComponents": len(components), "previewMinPixels": min_pixels,
            "regions": regions, "allComponentBounds": "clean-components.json",
            "comparisonNote": "Watermark disabled for Clean; JPEG export may still change pixels globally."}


def driver(name: str, args: list[str], env: dict[str, str], timeout: int = 600) -> dict:
    code, output, elapsed = command_run([shutil.which("node") or "node", str(ROOT / "scripts/verify" / name), *args], env, timeout)
    result = None
    for line in output.splitlines():
        if line.startswith(PREFIX):
            result = json.loads(line[len(PREFIX):])
    # Do not store arbitrary driver stdout: private-photo errors could contain input details.
    if result is None:
        return {"ok": False, "error": "driver-output-missing", "exitCode": code, "seconds": round(elapsed, 3)}
    result["ok"] = bool(result.get("ok")) and code == 0
    result.update(exitCode=code, seconds=round(elapsed, 3))
    return result


def unit(env: dict[str, str], out: Path) -> dict:
    npx = shutil.which("npx") or "npx"
    commands = [[npx, "tsc", "--noEmit", "-p", "tsconfig.json"],
                [npx, "vitest", "run", "--testTimeout=20000"], [npx, "vite", "build"]]
    checks = []
    for index, command in enumerate(commands):
        code, output, elapsed = command_run(command, env)
        plain = re.sub(r"\x1b\[[0-9;]*m", "", output)
        (out / f"unit-{index + 1}.log").write_text(plain, encoding="utf-8")
        check = {"command": "npx " + " ".join(command[1:]), "exitCode": code, "seconds": round(elapsed, 3)}
        passed = re.findall(r"Tests\s+(\d+) passed", plain)
        if passed:
            check["passed"] = int(passed[-1])
        checks.append(check)
    return {"ok": all(c["exitCode"] == 0 for c in checks), "checks": checks,
            "seconds": round(sum(c["seconds"] for c in checks), 3)}


def write_report(out: Path, results: dict[str, dict], url: str) -> str:
    rows = ["| Step | Result | Seconds |", "| --- | --- | ---: |"]
    for name, result in results.items():
        status = "SKIP" if result.get("skipped") else "PASS" if result.get("ok") else "FAIL"
        rows.append(f"| {name} | {status} | {result.get('seconds', 0):.3f} |")
    summary = "\n".join(rows)
    text = f"# Veil verification\n\nURL: {url}\n\n{summary}\n"
    for name, result in results.items():
        text += f"\n## {name}\n\n```json\n{json.dumps(result, indent=2, allow_nan=False)}\n```\n"
    text += "\nPrivate artifacts remain in this external output directory. No OCR strings are collected.\n"
    (out / "report.md").write_text(text, encoding="utf-8")
    (out / "results.json").write_text(json.dumps(results, indent=2, allow_nan=False), encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:5191/")
    parser.add_argument("--serve", action="store_true", help="Start/stop an owned Vite process; URL port must be free.")
    parser.add_argument("--out", type=Path, default=ROOT.parent / "scratch-eval" / ("verify-" + dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")))
    parser.add_argument("--photo", type=Path, help="Optional PRIVATE local photo; never copied into the repository.")
    parser.add_argument("--min-region-pixels", type=int, default=1, help="Minimum connected-component area for crop previews; use1 for every component. All boxes are always retained in JSON.")
    args = parser.parse_args()
    out = args.out.resolve()
    if out == ROOT or ROOT in out.parents:
        parser.error("--out must be outside the repository (private verification artifacts).")
    if out.exists() and any(out.iterdir()):
        parser.error("--out must be new or empty; previous verification artifacts are never reused or deleted.")
    if args.min_region_pixels < 1:
        parser.error("--min-region-pixels must be >=1")
    if args.photo and not args.photo.is_file():
        parser.error("--photo is not a local file")
    parsed = urlsplit(args.url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        parser.error("--url must be an http(s) app URL")
    out.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "VEIL_URL": args.url.rstrip("/") + "/", "VEIL_OUT": str(out), "NO_COLOR": "1"}
    results: dict[str, dict] = {}
    server = None
    server_log = None
    try:
        if args.serve:
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            if parsed.hostname not in ("localhost", "127.0.0.1", "::1") or parsed.scheme != "http":
                raise ValueError("--serve needs a local http URL")
            try:
                probe = socket.create_connection((parsed.hostname, port), timeout=1)
            except OSError:
                pass
            else:
                probe.close()
                raise ValueError("Chosen --serve port is occupied; use a free URL port.")
            server_log = (out / "vite.log").open("w", encoding="utf-8")
            server = spawn([shutil.which("npx") or "npx", "vite", "--port", str(port), "--strictPort", "--host", parsed.hostname],
                           env=env, stdout=server_log, stderr=subprocess.STDOUT)
            ready = False
            for _ in range(120):
                if server.poll() is not None:
                    break
                try:
                    with urllib.request.urlopen(args.url, timeout=1) as response:
                        ready = response.status == 200
                    if ready:
                        break
                except (OSError, ValueError):
                    time.sleep(.5)
            if not ready:
                raise RuntimeError("Owned Vite server did not become ready")
        else:
            with urllib.request.urlopen(args.url, timeout=10) as response:
                if response.status != 200:
                    raise RuntimeError("App URL is not ready")
        for name, file, extra in [("face", "face-eval.mjs", ["public/demo/source"]),
                                  ("trace", "e2e-trace.mjs", [])]:
            print(f"Running {name}...", flush=True)
            results[name] = driver(file, extra, env)
            print(f"{name}: {'PASS' if results[name]['ok'] else 'FAIL'}", flush=True)
        # Explicit12MP export-size case derived from the public fictional demo. Not a natural12MP-detail benchmark.
        size_source = out / "mark-12mp-input.jpg"
        rgb(ROOT / "public/demo/source/selfie-1.jpg").resize((3000, 4000), Image.Resampling.LANCZOS).save(size_source, quality=95)
        env["VEIL_MARK_12MP"] = str(size_source)
        print("Running mark...", flush=True)
        mark = driver("e2e-shield.mjs", [], env)
        if (out / "shielded.jpg").is_file() and (out / "shielded-12mp.jpg").is_file():
            shielded, large = out / "shielded.jpg", out / "shielded-12mp.jpg"
            mark.update(psnrDb=psnr(ROOT / "public/demo/source/selfie-1.jpg", shielded),
                        fileMB=round(shielded.stat().st_size / 1_000_000, 6),
                        file12mpMB=round(large.stat().st_size / 1_000_000, 6),
                        psnr12mpDb=psnr(size_source, large),
                        sizeFixture="3000x4000 upscaled public fictional demo; not native12MP detail")
            mark["ok"] = bool(mark.get("ok")) and bool(mark["madeFromYourPhoto"]) and large.stat().st_size < 4_000_000
        results["mark"] = mark
        print(f"mark: {'PASS' if mark['ok'] else 'FAIL'}", flush=True)
        if args.photo:
            print("Running private clean (no OCR text collected)...", flush=True)
            clean = driver("e2e-clean.mjs", [str(args.photo.resolve()), str(out / "cleaned.jpg")], env, 900)
            if clean.get("ok"):
                clean["diff"] = clean_diff(args.photo, out / "cleaned.jpg", out, args.min_region_pixels)
            results["clean"] = clean
        else:
            results["clean"] = {"ok": True, "skipped": True, "reason": "No --photo supplied", "seconds": 0}
        print("Running unit/type/build...", flush=True)
        results["unit"] = unit(env, out)
    except KeyboardInterrupt:
        results["runner"] = {"ok": False, "error": "interrupted", "seconds": 0}
    except Exception as error:
        # Exception class only: do not serialize private paths, pixels, OCR or browser error contents.
        results["runner"] = {"ok": False, "error": type(error).__name__, "seconds": 0}
    finally:
        if server:
            stop_process(server)
        if server_log:
            server_log.close()
        print(write_report(out, results, args.url), flush=True)
        print(f"Report: {out / 'report.md'}", flush=True)
    return 0 if results and all(r.get("ok") for r in results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
