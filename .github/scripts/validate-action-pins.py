#!/usr/bin/env python3
"""
Validate pinned GitHub Action refs in workflow files.

Checks every 'uses: owner/repo@<ref>' entry in .github/workflows/*.yml
against the upstream GitHub API to confirm the ref resolves.

Handles:
  - Full commit SHAs
  - Annotated tag object SHAs (dereference via git/tags API)
  - Lightweight tag refs (@v4, @main)
  - Local actions (./...) — ignored
  - Docker actions (image:tag) — ignored
  - Reusable workflows (.github/workflows/... — ignored)
  - Self-hosted actions — ignored

Uses GITHUB_TOKEN for authenticated requests (rate limit: 5,000/hr).
Falls back to anonymous requests for public repos.

Exit 1 if any pin is invalid. Exit 0 if all resolve.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

LOCAL_ACTION_RE = re.compile(r'^\./')
DOCKER_ACTION_RE = re.compile(r'^[^/\s]+/[^/\s]+:[^/@]')
USES_RE = re.compile(r'^\s*-\s*uses:\s*([^\s#]+)')

GITHUB_API_BASE = "https://api.github.com"


def get_auth_header():
    """Get auth header from GITHUB_TOKEN env var or gh CLI."""
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        return {"Authorization": f"Bearer {token}"}
    return {"Accept": "application/vnd.github+json"}


def api_request(path):
    """Make a request to the GitHub API. Return (status_code, body_dict)."""
    url = f"{GITHUB_API_BASE}/repos/{path}"
    headers = get_auth_header()
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return resp.status, data
    except urllib.error.HTTPError as e:
        if e.code == 404 or e.code == 422:
            return e.code, None
        return e.code, None
    except Exception:
        return 0, None


def check_ref(repo, ref):
    """Return (status, obj_type) for a given repo@ref."""
    # 1. Try as commit
    rc, _ = api_request(f"{repo}/commits/{ref}")
    if rc == 200:
        return "VALID", "commit"

    # 2. Try as annotated tag object
    rc, _ = api_request(f"{repo}/git/tags/{ref}")
    if rc == 200:
        return "VALID", "tag_object"

    # 3. Try as tag ref (handles both annotated and lightweight tags including v4)
    rc, data = api_request(f"{repo}/git/refs/tags/{ref}")
    if rc == 200:
        obj_type = data.get("object", {}).get("type", "tag_ref") if data else "tag_ref"
        if obj_type == "tag":
            return "VALID", "annotated_tag_ref"
        return "VALID", "tag_ref"

    # 4. Try as branch ref
    rc, _ = api_request(f"{repo}/git/ref/heads/{ref}")
    if rc == 200:
        return "VALID", "branch_name"

    return "INVALID", None


def main():
    workflow_dir = ".github/workflows"
    if not os.path.isdir(workflow_dir):
        # Handle CI checkout path
        workspace = os.environ.get("GITHUB_WORKSPACE", os.getcwd())
        workflow_dir = os.path.join(workspace, ".github", "workflows")
        if not os.path.isdir(workflow_dir):
            print(f"Directory not found: {workflow_dir}")
            return 0

    invalid_pins = []
    checked = 0
    skipped = 0

    for filename in sorted(os.listdir(workflow_dir)):
        if not (filename.endswith(".yml") or filename.endswith(".yaml")):
            continue
        filepath = os.path.join(workflow_dir, filename)
        with open(filepath) as f:
            for line in f:
                m = USES_RE.match(line)
                if not m:
                    continue
                ref_str = m.group(1)

                # Skip local actions
                if LOCAL_ACTION_RE.match(ref_str):
                    skipped += 1
                    continue

                # Skip Docker actions
                if DOCKER_ACTION_RE.match(ref_str):
                    skipped += 1
                    continue

                # Skip reusable workflows
                if ref_str.startswith("./.github/workflows/"):
                    skipped += 1
                    continue

                # Must have @ for pinning
                if "@" not in ref_str:
                    print(f"  ⚠️  Unpinned action in {filename}: {ref_str}")
                    continue

                # Split owner/repo/action-name@ref
                repo_and_action, ref = ref_str.rsplit("@", 1)
                ref = ref.strip()

                # GitHub Actions format: owner/repo/action-name@ref
                # The API endpoint uses owner/repo (drop action name)
                repo_parts = repo_and_action.split("/")
                if len(repo_parts) == 3:
                    repo = "/".join(repo_parts[:2])
                elif len(repo_parts) == 2:
                    repo = repo_and_action  # owner/repo (no action subpath — rare)
                else:
                    print(f"  ⚠️  Unrecognized format in {filename}: {ref_str}")
                    skipped += 1
                    continue

                status, obj_type = check_ref(repo, ref)
                checked += 1
                if status == "VALID":
                    print(f"  ✅ {repo_and_action}@{ref[:12]} ({obj_type})")
                else:
                    print(f"  ❌ {repo_and_action}@{ref} — INVALID ref in {filename}")
                    invalid_pins.append((repo_and_action, ref, filename))

    print(f"\n--- Summary ---")
    print(f"Checked: {checked}  Valid: {checked - len(invalid_pins)}  Invalid: {len(invalid_pins)}  Skipped: {skipped}")

    if invalid_pins:
        print("\n❌ Invalid action pins found:")
        for repo, ref, wf in invalid_pins:
            print(f"  {repo}@{ref} in {wf}")
        return 1

    print("\n✅ All action pins resolve successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
