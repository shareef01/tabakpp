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
tag_spec = importlib.util.spec_from_file_location("resolve_tag", Path(__file__).with_name("resolve-release-tag.py"))
resolve_tag = importlib.util.module_from_spec(tag_spec)
tag_spec.loader.exec_module(resolve_tag)


def fake_runner(tag_sha=None, release=None, ancestor=True):
    """Simulates git/gh for resolve-release-tag. release: None | dict(isDraft, assets)."""
    calls = []

    def run(args):
        calls.append(args)
        if args[:2] == ["git", "ls-remote"]:
            out = "" if tag_sha is None else f"aaa\trefs/tags/v1.2.3\n{tag_sha}\trefs/tags/v1.2.3^{{}}\n"
            return subprocess.CompletedProcess(args, 0, out, "")
        if args[:3] == ["gh", "release", "view"]:
            if release is None:
                return subprocess.CompletedProcess(args, 1, "", "release not found")
            body = {"isDraft": release.get("isDraft", False), "assets": [{"name": n} for n in release.get("assets", [])]}
            return subprocess.CompletedProcess(args, 0, json.dumps(body), "")
        if args[:3] == ["git", "merge-base", "--is-ancestor"]:
            return subprocess.CompletedProcess(args, 0 if ancestor else 1, "", "")
        raise AssertionError(f"unexpected command {args}")
    run.calls = calls
    return run


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

    # F-11: a run that pushed the tag but failed before/while publishing must be
    # retryable without moving the immutable tag.
    def test_new_version_releases_main_head(self):
        self.assertEqual(resolve_tag.resolve("1.2.3", "main", fake_runner()), ("new", "main"))

    def test_tag_without_release_resumes_at_the_tagged_commit(self):
        run = fake_runner(tag_sha="tagged")
        self.assertEqual(resolve_tag.resolve("1.2.3", "main", run), ("resume", "tagged"))
        # The peeled commit of the annotated tag is used, not the tag object.
        self.assertNotIn("aaa", resolve_tag.resolve("1.2.3", "main", fake_runner(tag_sha="tagged")))

    def test_partial_release_missing_an_asset_resumes(self):
        run = fake_runner(tag_sha="tagged", release={"assets": ["tabakpp-1.2.3.apk"]})
        self.assertEqual(resolve_tag.resolve("1.2.3", "main", run), ("resume", "tagged"))

    def test_draft_release_resumes(self):
        assets = ["tabakpp-1.2.3.apk", "tabakpp-1.2.3.apk.sha256"]
        run = fake_runner(tag_sha="tagged", release={"isDraft": True, "assets": assets})
        self.assertEqual(resolve_tag.resolve("1.2.3", "main", run), ("resume", "tagged"))

    def test_fully_published_version_is_refused(self):
        assets = ["tabakpp-1.2.3.apk", "tabakpp-1.2.3.apk.sha256"]
        with self.assertRaisesRegex(RuntimeError, "already published"):
            resolve_tag.resolve("1.2.3", "main", fake_runner(tag_sha="tagged", release={"assets": assets}))

    def test_tag_off_main_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, "not on main"):
            resolve_tag.resolve("1.2.3", "main", fake_runner(tag_sha="rogue", ancestor=False))

    def test_tag_step_never_moves_an_existing_tag(self):
        workflow = (ROOT / ".github/workflows/release-android.yml").read_text()
        step = workflow.split("- name: Create annotated version tag", 1)[1].split("- name:", 1)[0]
        self.assertIn("Refusing to move a release tag", step)
        self.assertNotIn("git push --force", step)
        self.assertNotIn("git tag -f", step)
        self.assertNotIn("git push origin :", step)


if __name__ == "__main__":
    unittest.main()
