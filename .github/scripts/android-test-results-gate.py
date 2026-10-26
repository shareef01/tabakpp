#!/usr/bin/env python3
"""Fail-closed gate over the Android instrumentation JUnit XML.

Why this exists
---------------
`:androidApp:connectedDebugAndroidTest` can exit **0** while the instrumentation
runner fails. Observed locally: an APK install conflict logged
``AndroidTestRunner failed ... INSTALL_FAILED_UPDATE_INCOMPATIBLE`` and the build
still reported ``BUILD SUCCESSFUL`` with exit code 0. The JUnit XML written by
the runner is the only trustworthy evidence, so this gate treats it as
authoritative and refuses to pass unless it is present, fresh, well-formed,
complete and green.

Schema handled (what AGP actually writes; one file per device)
-------------------------------------------------------------
    <testsuites tests="28" failures="0" errors="0" skipped="0" ...>
      <testsuite name="com.example.SomeTest" tests="19" failures="0"
                 errors="0" skipped="0" ...>
        <testcase name="a" classname="com.example.SomeTest" time="0.01">
          <failure>...</failure>   <!-- optional per test -->
        </testcase>
      </testsuite>
    </testsuites>

Because the same totals appear on the ``<testsuites>`` root *and* on each
``<testsuite>``, totals are summed over the suite children only; the root
aggregate is cross-checked against that sum and never added to it, so results
can not be double counted.

Exit status: 0 only when every check passes. Any other outcome — including a
parse error, a missing file, or a stale file — exits non-zero.
"""

from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

COUNT_ATTRIBUTES = ("tests", "failures", "errors", "skipped")
_DIGITS = re.compile(r"^[0-9]+$")


class GateError(Exception):
    """A fail-closed condition carrying a stable machine-readable code."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


class Totals:
    """Aggregated, already-validated counts across every fresh XML file."""

    def __init__(self) -> None:
        self.files = 0
        self.tests = 0
        self.failures = 0
        self.errors = 0
        self.skipped = 0
        self.failure_elements = 0
        self.error_elements = 0
        self.stale = 0

    @property
    def executed(self) -> int:
        return self.tests - self.skipped

    def render(self) -> str:
        return (
            f"files={self.files} tests={self.tests} executed={self.executed} "
            f"failures={self.failures} errors={self.errors} skipped={self.skipped} "
            f"stale={self.stale} failure_elements={self.failure_elements} "
            f"error_elements={self.error_elements}"
        )


def _count(element: ET.Element, name: str, *, where: str) -> int:
    """Read one non-negative integer attribute, or raise a stable GateError."""
    raw = element.get(name)
    if raw is None:
        raise GateError("MISSING_ATTRIBUTE", f"{where} has no '{name}' attribute")
    value = raw.strip()
    if not _DIGITS.match(value):
        code = "NEGATIVE_ATTRIBUTE" if re.fullmatch(r"-[0-9]+", value) else "NON_NUMERIC_ATTRIBUTE"
        raise GateError(code, f"{where} {name}='{raw}' is not a non-negative integer")
    return int(value)


def _suite_totals(suite: ET.Element) -> dict[str, int]:
    """Validate one <testsuite> and return its counts plus observed elements."""
    where = f"<testsuite name={suite.get('name', '<unnamed>')!r}>"
    counts = {name: _count(suite, name, where=where) for name in COUNT_ATTRIBUTES}

    if counts["failures"] + counts["errors"] > counts["tests"]:
        raise GateError(
            "INCONSISTENT_TOTALS",
            f"{where} reports tests={counts['tests']} but "
            f"failures={counts['failures']} + errors={counts['errors']}",
        )
    if counts["skipped"] > counts["tests"]:
        raise GateError(
            "INCONSISTENT_TOTALS",
            f"{where} reports tests={counts['tests']} but skipped={counts['skipped']}",
        )

    cases = len(suite.findall("testcase"))
    if cases != counts["tests"]:
        # AGP always emits one <testcase> per test, so a mismatch means the file
        # was truncated or hand-edited: the declared totals cannot be trusted.
        raise GateError(
            "INCONSISTENT_TOTALS",
            f"{where} declares tests={counts['tests']} but contains {cases} <testcase> element(s)",
        )

    failure_elements = sum(1 for node in suite.iter("failure"))
    error_elements = sum(1 for node in suite.iter("error"))
    if failure_elements > counts["failures"] or error_elements > counts["errors"]:
        raise GateError(
            "INCONSISTENT_TOTALS",
            f"{where} declares failures={counts['failures']} errors={counts['errors']} but "
            f"contains {failure_elements} <failure> and {error_elements} <error> element(s)",
        )

    counts["failure_elements"] = failure_elements
    counts["error_elements"] = error_elements
    return counts


def parse_results_file(path: Path) -> dict[str, int]:
    """Parse one JUnit XML file and return its validated, non-double-counted totals."""
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as exc:
        raise GateError("MALFORMED_XML", f"{path.name} is not well-formed XML ({exc})") from exc
    except OSError as exc:
        raise GateError("UNREADABLE_XML", f"{path.name} could not be read ({exc})") from exc

    if root.tag == "testsuite":
        suites = [root]
    elif root.tag == "testsuites":
        suites = root.findall("testsuite")
        if not suites:
            raise GateError("EMPTY_RESULTS", f"{path.name} contains no <testsuite> element")
        if any(suite.find("testsuite") is not None for suite in suites):
            # An aggregate nested inside an aggregate has no unambiguous meaning
            # here, and summing it either way would double count.
            raise GateError("UNEXPECTED_STRUCTURE", f"{path.name} nests <testsuite> inside <testsuite>")
    else:
        raise GateError("UNEXPECTED_ROOT", f"{path.name} has root <{root.tag}>, expected <testsuites> or <testsuite>")

    # Each suite is validated exactly once; the per-suite totals are the only
    # source of the result, so the <testsuites> aggregate can never be added twice.
    per_suite = [_suite_totals(suite) for suite in suites]

    if root.tag == "testsuites" and any(root.get(name) is not None for name in COUNT_ATTRIBUTES):
        for name in COUNT_ATTRIBUTES:
            declared = _count(root, name, where=f"<testsuites> in {path.name}")
            observed = sum(suite[name] for suite in per_suite)
            if declared != observed:
                raise GateError(
                    "INCONSISTENT_TOTALS",
                    f"{path.name} <testsuites> {name}={declared} but the suite children sum to {observed}",
                )

    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0, "failure_elements": 0, "error_elements": 0}
    for suite in per_suite:
        for name, value in suite.items():
            totals[name] += value
    return totals


def evaluate(results_dir: Path, marker: Path, gradle_exit: int) -> tuple[Totals, list[str]]:
    """Collect and judge the result tree. Returns (totals, reasons); empty reasons == pass."""
    reasons: list[str] = []
    if gradle_exit != 0:
        reasons.append(f"GRADLE_EXIT_NONZERO: gradle reported exit {gradle_exit}")

    totals = Totals()
    if not marker.is_file():
        reasons.append(f"MISSING_MARKER: freshness marker {marker} does not exist")
        return totals, reasons
    marker_time = marker.stat().st_mtime

    if not results_dir.is_dir():
        reasons.append(f"NO_RESULTS_DIR: {results_dir} does not exist")
        return totals, reasons

    files = sorted(results_dir.rglob("*.xml"))
    if not files:
        reasons.append(f"NO_RESULTS: no JUnit XML under {results_dir}")
        return totals, reasons

    fresh: list[Path] = []
    for path in files:
        try:
            is_fresh = path.stat().st_mtime > marker_time
        except OSError:
            is_fresh = False
        if is_fresh:
            fresh.append(path)
        else:
            totals.stale += 1
            print(f"::warning::Ignoring stale JUnit XML from a previous run: {path}")

    if not fresh:
        reasons.append(f"NO_FRESH_RESULTS: every one of {len(files)} XML file(s) predates the run marker")
        return totals, reasons

    for path in fresh:
        try:
            parsed = parse_results_file(path)
        except GateError as exc:
            reasons.append(str(exc))
            continue
        totals.files += 1
        for name, value in parsed.items():
            setattr(totals, name, getattr(totals, name) + value)

    if totals.files == 0:
        # Every fresh file failed to parse; the reasons above already explain it.
        return totals, reasons
    if totals.tests == 0:
        reasons.append("EMPTY_RESULTS: the results declare zero tests")
    elif totals.executed <= 0:
        reasons.append(f"ALL_SKIPPED: all {totals.tests} discovered tests were skipped")
    elif totals.failures or totals.errors or totals.failure_elements or totals.error_elements:
        reasons.append(
            "FAILED_TESTS: "
            f"failures={totals.failures} errors={totals.errors} "
            f"failure_elements={totals.failure_elements} error_elements={totals.error_elements}"
        )
    return totals, reasons


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fail-closed gate over Android instrumentation JUnit XML.")
    parser.add_argument("--results-dir", required=True, type=Path, help="AGP androidTest-results/connected tree")
    parser.add_argument("--marker", required=True, type=Path, help="file created immediately before the run")
    parser.add_argument("--gradle-exit", required=True, type=int, help="exit status of connectedDebugAndroidTest")
    args = parser.parse_args(argv)

    totals, reasons = evaluate(args.results_dir, args.marker, args.gradle_exit)
    print(f"INSTRUMENTATION_RESULTS: {totals.render()}")
    if reasons:
        print("::error::Instrumentation result gate failed")
        for reason in reasons:
            print(f"  - {reason}")
        print("GATE: FAIL")
        return 1
    print("GATE: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
