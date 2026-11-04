"""Decide which commit a release run publishes, so a failed run can be retried.

A release run pushes the immutable tag `v<version>` and THEN creates the GitHub
Release and uploads the APK + checksum. If anything after the tag push fails
(release API error, asset upload, runner loss), the old "tag must not exist"
guard made every retry abort, leaving a tag with no release and no safe way to
publish that version short of deleting/moving a release tag.

Outcomes (never moves or deletes a tag):

* no remote tag                    -> NEW: release the current main HEAD.
* tag + complete published release -> refuse: the version is already shipped.
* tag + no release / partial one   -> RESUME: release the commit the tag
  already points at (must be an ancestor of main), re-validated by require-ci.

Usage: resolve-release-tag.py <version> <main_sha>
Writes `mode=` and `sha=` to $GITHUB_OUTPUT when set; prints them otherwise.
"""
import json
import os
import subprocess
import sys


def expected_assets(version):
    return {f"tabakpp-{version}.apk", f"tabakpp-{version}.apk.sha256"}


def _run(args):
    return subprocess.run(args, capture_output=True, text=True)


def remote_tag_commit(tag, run=_run):
    """Commit the remote tag points at (peeled for annotated tags), or None."""
    out = run(["git", "ls-remote", "--tags", "origin", f"refs/tags/{tag}", f"refs/tags/{tag}^{{}}"])
    if out.returncode != 0:
        raise RuntimeError(f"git ls-remote failed: {out.stderr.strip()}")
    refs = {}
    for line in out.stdout.splitlines():
        sha, _, ref = line.partition("\t")
        refs[ref.strip()] = sha.strip()
    return refs.get(f"refs/tags/{tag}^{{}}") or refs.get(f"refs/tags/{tag}")


def release_state(tag, run=_run):
    """None when no release exists; else (is_draft, asset names)."""
    out = run(["gh", "release", "view", tag, "--json", "isDraft,assets"])
    if out.returncode != 0:
        if "release not found" in (out.stderr or "").lower():
            return None
        raise RuntimeError(f"gh release view failed: {out.stderr.strip()}")
    data = json.loads(out.stdout)
    return bool(data.get("isDraft")), {a["name"] for a in data.get("assets", [])}


def is_ancestor(sha, main_sha, run=_run):
    return run(["git", "merge-base", "--is-ancestor", sha, main_sha]).returncode == 0


def resolve(version, main_sha, run=_run):
    tag = f"v{version}"
    tagged = remote_tag_commit(tag, run)
    if not tagged:
        return "new", main_sha
    state = release_state(tag, run)
    if state is not None:
        is_draft, assets = state
        if not is_draft and expected_assets(version) <= assets:
            raise RuntimeError(f"{tag} is already published with all assets; choose a new version.")
    if not is_ancestor(tagged, main_sha, run):
        raise RuntimeError(f"{tag} points at {tagged}, which is not on main; refusing to publish it.")
    return "resume", tagged


def main(argv):
    version, main_sha = argv[1], argv[2]
    mode, sha = resolve(version, main_sha)
    lines = [f"mode={mode}", f"sha={sha}"]
    out_path = os.environ.get("GITHUB_OUTPUT")
    if out_path:
        with open(out_path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    if mode == "resume":
        print(f"Resuming partially published v{version} at its existing tag commit {sha}.")


if __name__ == "__main__":
    try:
        main(sys.argv)
    except RuntimeError as err:
        print(f"Error: {err}")
        sys.exit(1)
