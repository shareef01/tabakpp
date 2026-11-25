#!/usr/bin/env python3
"""Decide whether a failed Gradle build is worth retrying.

Usage: gradle-transient-failure.py <gradle-log-file>
Exit 0: the failure is a transient network problem (retry).
Exit 1: anything else, including an empty or unreadable log (do not retry).

Release v1.0.21's first signing attempt failed in 19 s because Maven Central
answered HTTP 429 while Gradle resolved the Kotlin plugin (run 45629063905,
attempt 1). The build itself was fine. A retry is safe only for failures like
that one: a compile, lint, test or signing error must fail immediately, so
the classifier requires BOTH a dependency-download context AND a network
cause, and refuses when Gradle reports a compilation or signing failure.
"""
import re
import sys

# Gradle is fetching an artifact or resolving a configuration.
DOWNLOAD_CONTEXT = re.compile(
    r"Could not (?:resolve|download|get resource|GET|HEAD)\b"
    r"|Could not resolve all (?:files|dependencies|artifacts)"
)

# The cause is the network or a server-side limit, not the build.
NETWORK_CAUSE = re.compile(
    r"Received status code (?:429|5\d\d) from server"
    r"|Too Many Requests"
    r"|Connection reset"
    r"|Connection refused"
    r"|Read timed out"
    r"|connect timed out"
    r"|Remote host terminated the handshake"
    r"|Temporary failure in name resolution"
)

# Never retry these, even if a download error also appears.
COMPILATION_ERROR = re.compile(r"Compilation error", re.IGNORECASE)
TASK_FAILURE = re.compile(
    r"Execution failed for task '[^']*(?:compile|lint|test|sign|package|validateSigning)[^']*'",
    re.IGNORECASE,
)

# The first cause line under a task failure when the task never ran its own
# work because its inputs could not be downloaded. CI run 45645048588 failed
# ':composeApp:testDebugUnitTest' this way: Maven Central answered 429 for
# org.robolectric:nativeruntime-dist-compat while Gradle resolved the test
# runtime classpath, so no test had run. A failing test, lint finding or
# signing error has a different first cause ("There were failing tests", ...)
# and is still refused.
RESOLUTION_CAUSE = re.compile(
    r"^\s*> Could not resolve all (?:files|dependencies|artifacts) for configuration "
)


def _real_task_failure(log: str) -> bool:
    """True if any matching task failed for a reason other than resolution."""
    lines = log.splitlines()
    for i, line in enumerate(lines):
        if not TASK_FAILURE.search(line):
            continue
        cause = next((l for l in lines[i + 1:] if l.strip()), "")
        if not RESOLUTION_CAUSE.match(cause):
            return True
    return False


def is_transient(log: str) -> bool:
    if not log.strip():
        return False
    if COMPILATION_ERROR.search(log) or _real_task_failure(log):
        return False
    return bool(DOWNLOAD_CONTEXT.search(log) and NETWORK_CAUSE.search(log))


def main(argv):
    if len(argv) != 2:
        print("usage: gradle-transient-failure.py <gradle-log-file>", file=sys.stderr)
        return 2
    try:
        with open(argv[1], encoding="utf-8", errors="replace") as f:
            log = f.read()
    except OSError as e:
        print(f"cannot read log: {e}", file=sys.stderr)
        return 1
    return 0 if is_transient(log) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
