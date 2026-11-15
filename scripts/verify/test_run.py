"""Synthetic runner regressions; no network, models or private photos."""
import json
import contextlib
import io
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import run


class RunnerTests(unittest.TestCase):
    def test_eight_connected_boxes(self):
        mask = np.zeros((5, 6), dtype=bool)
        mask[0, 0] = mask[1, 1] = mask[4, 5] = True
        self.assertEqual(run.changed_components(mask), [
            {"bbox": [0, 0, 2, 2], "pixels": 2},
            {"bbox": [5, 4, 6, 5], "pixels": 1}])
        self.assertEqual(run.changed_components(np.zeros((2, 2), dtype=bool)), [])

    def test_exif_diff_threshold_and_every_crop(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            before = Image.new("RGB", (3, 2), (40, 40, 40))
            exif = Image.Exif()
            exif[274] = 6
            before.save(root / "before.jpg", exif=exif)
            oriented = run.rgb(root / "before.jpg")
            self.assertEqual(oriented.size, (2, 3))
            oriented.putpixel((1, 2), (49, 40, 40))
            oriented.save(root / "after.png")
            result = run.clean_diff(root / "before.jpg", root / "after.png", root)
            self.assertEqual(result["changedPixels"], 1)
            self.assertEqual(result["regions"][0]["bbox"], [1, 2, 2, 3])
            self.assertTrue((root / result["regions"][0]["preview"]).is_file())
            oriented.putpixel((1, 2), (48, 40, 40))
            oriented.save(root / "after.png")
            self.assertEqual(run.clean_diff(root / "before.jpg", root / "after.png", root)["changedPixels"], 0)

    def test_exact_psnr_and_missing_structured_driver(self):
        with tempfile.TemporaryDirectory() as folder:
            image = Path(folder) / "flat.png"
            Image.new("RGB", (5, 5), (100, 90, 80)).save(image)
            self.assertEqual(run.psnr(image, image), "infinite")
        with patch.object(run, "command_run", return_value=(0, "unstructured", .1)):
            self.assertFalse(run.driver("unused.mjs", [], {})["ok"])
        with patch.object(run, "command_run", return_value=(1, run.PREFIX + json.dumps({"ok": True}), .1)):
            self.assertFalse(run.driver("unused.mjs", [], {})["ok"])

    def test_existing_output_is_rejected_without_touching_it(self):
        with tempfile.TemporaryDirectory() as folder:
            existing = Path(folder) / "old-report.md"
            existing.write_text("keep")
            with patch.object(sys, "argv", ["run.py", "--out", folder]), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    run.main()
            self.assertEqual(error.exception.code, 2)
            self.assertEqual(existing.read_text(), "keep")

    def test_report_keeps_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            summary = run.write_report(Path(folder), {"mark": {"ok": False, "seconds": .2}}, "http://localhost:5192/")
            self.assertIn("FAIL", summary)
            self.assertFalse(json.loads((Path(folder) / "results.json").read_text())["mark"]["ok"])


if __name__ == "__main__":
    unittest.main()
