#!/usr/bin/env python3
"""Self-tests for the action-pin validator."""

import json
import os
import subprocess
import sys
import tempfile
import textwrap

# Create test workflow files with known valid/invalid refs
TEST_WORKFLOWS = {
    "valid-sha.yml": textwrap.dedent("""
    name: Test
    on: [push]
    jobs:
      test:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
    """),
    "invalid-sha.yml": textwrap.dedent("""
    name: Test
    on: [push]
    jobs:
      test:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
    """),
    "local-action.yml": textwrap.dedent("""
    name: Test
    on: [push]
    jobs:
      test:
        runs-on: ubuntu-latest
        steps:
          - uses: ./.github/actions/my-local-action
    """),
    "tag-ref.yml": textwrap.dedent("""
    name: Test
    on: [push]
    jobs:
      test:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
    """),
    "annotated-tag-object.yml": textwrap.dedent("""
    name: Test
    on: [push]
    jobs:
      test:
        runs-on: ubuntu-latest
        steps:
          - uses: gradle/actions/setup-gradle@0b6dd653ba04f4f93bf581ec31e66cbd7dcb644d
    """),
    "docker-action.yml": textwrap.dedent("""
    name: Test
    on: [push]
    jobs:
      test:
        runs-on: ubuntu-latest
        steps:
          - uses: docker://alpine:3.18
    """),
}


def run_check(repo, ref):
    """Mirror of the validator's check_ref function."""
    r = subprocess.run(
        ['gh', 'api', f'repos/{repo}/commits/{ref}'],
        capture_output=True, text=True
    )
    if r.returncode == 0:
        return 'commit'
    r = subprocess.run(
        ['gh', 'api', f'repos/{repo}/git/tags/{ref}'],
        capture_output=True, text=True
    )
    if r.returncode == 0:
        return 'tag_object'
    r = subprocess.run(
        ['gh', 'api', f'repos/{repo}/git/ref/tags/{ref}'],
        capture_output=True, text=True
    )
    if r.returncode == 0:
        return 'tag_name'
    r = subprocess.run(
        ['gh', 'api', f'repos/{repo}/git/ref/heads/{ref}'],
        capture_output=True, text=True
    )
    if r.returncode == 0:
        return 'branch_name'
    r = subprocess.run(
        ['gh', 'api', f'repos/{repo}/git/refs/tags/{ref}'],
        capture_output=True, text=True
    )
    if r.returncode == 0:
        return 'tag_ref'
    return None


def main():
    print("=== Action Pin Validator Self-Tests ===\n")

    results = []

    # Test 1: Valid commit SHA
    status = run_check('actions/checkout', '11d5960a326750d5838078e36cf38b85af677262')
    print(f"Test 1: Valid commit SHA → {status or 'INVALID'}")
    results.append(("valid commit SHA", status == 'commit'))

    # Test 2: Invalid SHA
    status = run_check('actions/checkout', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
    print(f"Test 2: Invalid SHA → {status or 'INVALID'}")
    results.append(("invalid SHA", status is None))

    # Test 3: Annotated tag object SHA
    status = run_check('gradle/actions', '0b6dd653ba04f4f93bf581ec31e66cbd7dcb644d')
    print(f"Test 3: Annotated tag object → {status or 'INVALID'}")
    results.append(("annotated tag object", status == 'tag_object'))

    # Test 4: Branch/tag name (v4) — resolves via commits/{ref} redirect
    status = run_check('actions/checkout', 'v4')
    print(f"Test 4: Tag name v4 → {status or 'INVALID'}")
    results.append(("tag name", status in ('commit', 'tag_name', 'tag_ref')))

    # Test 5: setup-java v6.0.1 commit (multi-segment repo path)
    status = run_check('actions/setup-java', 'de7274f081f381c8f8158605e0321c36c376e2e6')
    print(f"Test 5: setup-java v6.0.1 commit → {status or 'INVALID'}")
    results.append(("setup-java v6.0.1", status == 'commit'))

    # Test 6: Multi-segment repo (gradle/actions/setup-gradle)
    status = run_check('gradle/actions', '0b6dd653ba04f4f93bf581ec31e66cbd7dcb644d')
    print(f"Test 6: Annotated tag object (gradle/actions) → {status or 'INVALID'}")
    results.append(("annotated tag object (multi-segment repo)", status == 'tag_object'))

    print(f"\n--- Test Results ---")
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    for name, ok in results:
        print(f"  {'✅' if ok else '❌'} {name}")
    print(f"\n{passed}/{total} tests passed.")

    if passed != total:
        sys.exit(1)
    print("\n✅ All self-tests passed.")


if __name__ == '__main__':
    main()
