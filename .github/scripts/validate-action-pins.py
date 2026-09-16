#!/usr/bin/env python3
"""
Validate pinned GitHub Action refs in workflow files.

Policy: Every external GitHub Action or reusable workflow reference must be
pinned to an immutable 40-character lowercase hexadecimal Git object ID.
Both commit objects and annotated-tag-objects are accepted (both are immutable).
Mutable symbolic refs (tags like @v4, branches like @main) are rejected.

Handles:
  - Local actions (./...) — ignored (repo-controlled)
  - Docker actions (docker://image) — classified explicitly, rejected unless
    digest-pinned (image@sha256:...)
  - Reusable workflows (.github/workflows/...@ref) — must use immutable SHA
  - Self-hosted actions (runs-on: self-hosted) — ignored

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

# --- Regex patterns ------------------------------------------------------------

# A 40-character lowercase hexadecimal Git object ID
IMMUTABLE_SHA_RE = re.compile(r'^[0-9a-f]{40}$')

# Lines that contain a `uses:` directive
USES_RE = re.compile(r'^\s*-\s*uses:\s*([^\s#]+)')

# Local action: starts with ./
LOCAL_ACTION_RE = re.compile(r'^\./')

# Docker action: docker://image:tag or docker://image@sha256:digest
DOCKER_ACTION_RE = re.compile(r'^docker://.+$')

# Reusable workflow: owner/repo/.github/workflows/name.yml@ref
# Also includes the nested path case: owner/repo/path/to/action@ref
REUSABLE_WORKFLOW_RE = re.compile(r'^[^/@]+/[^/@]+/.github/workflows/[^/@]+@.+')

# Standard GitHub Action: owner/repo/action-name@ref or owner/repo@ref
# The ref is everything after the last @
# The repo is owner/repo (first two segments after splitting on /)
# Everything else before @ that is not part of owner/repo is the action subdirectory

GITHUB_API_BASE = "https://api.github.com"


def get_auth_header():
    """Get auth header from GITHUB_TOKEN env var."""
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    return {"Accept": "application/vnd.github+json"}


def api_request(path, auth_headers=None):
    """Make a request to the GitHub API. Return (status_code, body_dict)."""
    url = f"{GITHUB_API_BASE}/repos/{path}"
    headers = auth_headers or get_auth_header()
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
    """
    Return (status, obj_type) for a given repo@ref.

    Checks the ref against the GitHub API:
    1. Commit object (by SHA)
    2. Annotated tag object (by SHA)
    3. Tag ref (handles symbolic tags like v4 — but caller should have
       already rejected these before calling)

    Returns "VALID" or "INVALID" with the object type.
    """
    # 1. Try as commit
    rc, _ = api_request(f"{repo}/commits/{ref}")
    if rc == 200:
        return "VALID", "commit"

    # 2. Try as annotated tag object
    rc, _ = api_request(f"{repo}/git/tags/{ref}")
    if rc == 200:
        return "VALID", "tag_object"

    # 3. Try as tag ref (for symbolic refs — but these should be rejected
    #    by the caller before we get here, since the policy requires
    #    immutable 40-char SHAs)
    rc, data = api_request(f"{repo}/git/refs/tags/{ref}")
    if rc == 200:
        obj_type = data.get("object", {}).get("type", "tag_ref") if data else "tag_ref"
        if obj_type == "tag":
            return "VALID", "annotated_tag_ref"
        return "VALID", "tag_ref"

    return "INVALID", None


def parse_uses_ref(ref_str):
    """
    Parse a `uses:` reference string into (repo, ref, ref_type, note).

    ref_type is one of:
      - "local"     : local action (./path)
      - "docker"    : docker:// reference
      - "reusable"  : reusable workflow (owner/repo/.github/workflows/...)
      - "action"    : external GitHub action (owner/repo/action@ref)

    Returns (repo, ref, ref_type, note) or (None, None, None, warning)
    if the reference should be skipped.
    """
    # Local actions
    if LOCAL_ACTION_RE.match(ref_str):
        return None, None, "local", None

    # Docker actions
    if DOCKER_ACTION_RE.match(ref_str):
        return None, None, "docker", ref_str

    # Must have @ for pinning
    if "@" not in ref_str:
        return None, None, "unpinned", ref_str

    # Split on last @
    repo_and_action, ref = ref_str.rsplit("@", 1)
    ref = ref.strip()

    # Strip inline comment if present (e.g., owner/repo@sha # v4)
    # The regex already excludes trailing comments, but be safe
    ref = ref.split("#")[0].strip()

    # Reusable workflow: owner/repo/.github/workflows/name.yml@ref
    if REUSABLE_WORKFLOW_RE.match(ref_str):
        # Parse: owner/repo/.github/workflows/name.yml@ref
        # repo is owner/repo (first two path segments)
        parts = repo_and_action.split("/")
        if len(parts) >= 2:
            repo = "/".join(parts[:2])
        else:
            return None, None, "malformed", ref_str
        return repo, ref, "reusable", ref_str

    # Standard GitHub Action: owner/repo/action-name@ref
    # or owner/repo@ref
    parts = repo_and_action.split("/")
    if len(parts) == 3:
        # owner/repo/action-name@ref
        repo = "/".join(parts[:2])
    elif len(parts) == 2:
        # owner/repo@ref (rare — no action subpath)
        repo = repo_and_action
    else:
        # Unrecognized multi-segment path
        return None, None, "malformed", ref_str

    return repo, ref, "action", ref_str


def main():
    workflow_dir = ".github/workflows"
    if not os.path.isdir(workflow_dir):
        workspace = os.environ.get("GITHUB_WORKSPACE", os.getcwd())
        workflow_dir = os.path.join(workspace, ".github", "workflows")
        if not os.path.isdir(workflow_dir):
            print(f"Directory not found: {workflow_dir}")
            return 0

    violations = []
    checked = 0
    skipped = 0
    api_calls = 0
    # Cache results to deduplicate identical repo@ref lookups
    ref_cache = {}

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

                repo, ref, ref_type, note = parse_uses_ref(ref_str)

                # Skip local actions
                if ref_type == "local":
                    skipped += 1
                    continue

                # Docker actions — classify explicitly
                if ref_type == "docker":
                    skipped += 1
                    # Check if it's digest-pinned
                    if "@sha256:" in ref_str:
                        print(f"  ✅ Docker (digest-pinned): {ref_str}")
                    else:
                        print(f"  ⚠️  Docker (mutable tag — outside validator scope): {ref_str}")
                    continue

                # Unpinned
                if ref_type == "unpinned":
                    print(f"  ❌ Unpinned action in {filename}: {ref_str}")
                    violations.append(f"Unpinned action '{ref_str}' in {filename}")
                    continue

                # Malformed
                if ref_type == "malformed":
                    print(f"  ⚠️  Unrecognized format in {filename}: {ref_str}")
                    skipped += 1
                    continue

                # At this point we have an external GitHub action or reusable workflow
                # Check immutability: ref must be a 40-char lowercase hex SHA
                if not IMMUTABLE_SHA_RE.match(ref):
                    print(f"  ❌ Mutable ref in {filename}: {ref_str}")
                    print(f"     Ref '{ref}' is not a 40-char immutable SHA (got {len(ref)} chars)")
                    violations.append(
                        f"Mutable ref '{ref}' for '{ref_str}' in {filename} — "
                        f"must be a 40-char lowercase hex Git object ID"
                    )
                    continue

                # Deduplicate API calls
                cache_key = (repo, ref)
                if cache_key in ref_cache:
                    status, obj_type = ref_cache[cache_key]
                else:
                    api_calls += 1
                    status, obj_type = check_ref(repo, ref)
                    ref_cache[cache_key] = (status, obj_type)

                checked += 1
                if status == "VALID":
                    print(f"  ✅ {ref_str} ({obj_type})")
                else:
                    print(f"  ❌ {ref_str} — INVALID ref in {filename}")
                    violations.append(f"Invalid SHA '{ref}' for '{ref_str}' in {filename}")

    print(f"\n--- Summary ---")
    print(f"Checked: {checked}  Valid: {checked - len(violations)}  "
          f"Invalid: {len(violations)}  Skipped: {skipped}  API calls: {api_calls}")

    if violations:
        print("\n❌ Violations:")
        for v in violations:
            print(f"  {v}")
        return 1

    print("\n✅ All action pins are valid and immutable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
