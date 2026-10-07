import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("release_ci", Path(__file__).with_name("check-release-ci.py"))
release_ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_ci)


class ReleaseSafetyTest(unittest.TestCase):
    def test_exact_sha_and_latest_run_required(self):
        good = dict(headSha="abc", status="completed", conclusion="success", databaseId=1)
        with patch.object(subprocess, "check_output", return_value=json.dumps([good])):
            release_ci.check("abc")
        for runs in ([], [{**good, "headSha": "other"}], [good, {**good, "databaseId": 2, "conclusion": "failure"}]):
            with patch.object(subprocess, "check_output", return_value=json.dumps(runs)):
                with self.assertRaises(RuntimeError):
                    release_ci.check("abc")

    def test_dispatch_input_remains_literal(self):
        workflow = (ROOT / ".github/workflows/release-android.yml").read_text()
        section = workflow.split("- name: Validate version input", 1)[1].split("# Reject", 1)[0]
        script = textwrap.dedent(section.split("run: |", 1)[1]).strip()
        self.assertNotIn("${{ github.event.inputs.version }}", script)
        self.assertEqual(workflow.count("github.event.inputs.version"), 1)
        bash = shutil.which("bash")
        if os.name == "nt":
            bash = r"C:\Program Files\Git\bin\bash.exe"
        self.assertTrue(bash and Path(bash).exists(), "Bash required to verify literal input handling")
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "injected"
            output = Path(directory) / "output"
            inputs = ["$(touch injected; printf 1.2.3)", '`touch injected`1.2.3', '1.2.3"; touch injected; #', "1.2.3\n", "-1.2.3"]
            for version in inputs:
                result = subprocess.run([bash, "-c", script], cwd=directory, env={**os.environ, "RELEASE_VERSION": version, "GITHUB_OUTPUT": str(output)}, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(marker.exists())
            result = subprocess.run([bash, "-c", script], cwd=directory, env={**os.environ, "RELEASE_VERSION": "1.2.3", "GITHUB_OUTPUT": str(output)}, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
