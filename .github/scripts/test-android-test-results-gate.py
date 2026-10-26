#!/usr/bin/env python3
"""Regression tests for `android-test-results-gate.py`.

The cases exercise the gate module itself (imported from the real file), not a
reimplementation, so a change that weakens the gate fails here. Run with:

    python3 .github/scripts/test-android-test-results-gate.py

Covered: a green run, every fail-closed branch (missing tree, empty tree, stale
files, malformed/truncated XML, wrong root, missing/negative/non-numeric
attributes, inconsistent totals, failures, errors, all-skipped, failure
elements with failures="0", non-zero gradle exit), the no-double-count rule,
and the workflow wiring that replaces the old grep-based extraction.
"""

import importlib.util
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location(
    "android_test_results_gate", Path(__file__).with_name("android-test-results-gate.py")
)
gate = importlib.util.module_from_spec(_SPEC)
# Register before exec_module: the module must be importable by name so that any
# later `sys.modules` lookup (dataclasses, typing, pickling) can resolve it.
sys.modules[_SPEC.name] = gate
_SPEC.loader.exec_module(gate)

WORKFLOW = ROOT / ".github/workflows/android-integration.yml"


def suite_xml(name: str, tests: int, failures: int = 0, errors: int = 0, skipped: int = 0,
              failure_elements: int = 0, error_elements: int = 0, skip_elements: int = 0) -> str:
    """Build one <testsuite> with exactly `tests` <testcase> children."""
    cases = []
    for index in range(tests):
        body = ""
        if index < failure_elements:
            body = "<failure>boom</failure>"
        elif index < failure_elements + error_elements:
            body = "<error>kaboom</error>"
        elif index < failure_elements + error_elements + skip_elements:
            body = "<skipped/>"
        cases.append(f'    <testcase name="t{index}" classname="{name}" time="0.01">{body}</testcase>')
    return (
        f'  <testsuite name="{name}" tests="{tests}" failures="{failures}" errors="{errors}" '
        f'skipped="{skipped}" time="0.1" timestamp="2026-10-26T12:00:00" hostname="localhost">\n'
        + "\n".join(cases)
        + "\n  </testsuite>"
    )


def document(*suites: str, root_attrs: str | None = None) -> str:
    """Wrap suites in <testsuites>, computing root attributes from them unless overridden."""
    if root_attrs is None:
        tests = failures = errors = skipped = 0
        for suite in suites:
            for fragment in suite.split("tests=\"")[1:]:
                tests += int(fragment.split('"')[0])
            for fragment in suite.split('failures="')[1:]:
                failures += int(fragment.split('"')[0])
            for fragment in suite.split('errors="')[1:]:
                errors += int(fragment.split('"')[0])
            for fragment in suite.split('skipped="')[1:]:
                skipped += int(fragment.split('"')[0])
        root_attrs = f'tests="{tests}" failures="{failures}" errors="{errors}" skipped="{skipped}"'
    return (
        "<?xml version='1.0' encoding='UTF-8' ?>\n"
        f"<testsuites {root_attrs} time=\"0.2\" timestamp=\"2026-10-26T12:00:00\" hostname=\"localhost\">\n"
        + "\n".join(suites)
        + "\n</testsuites>\n"
    )


class GateTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.results = self.dir / "results"
        self.results.mkdir()
        self.marker = self.dir / "marker"
        self.marker.write_text("run started", encoding="utf-8")
        # Ensure written results are strictly newer than the marker on filesystems
        # with coarse timestamps.
        self.marker_time = self.marker.stat().st_mtime

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def write(self, name: str, content: str, *, fresh: bool = True, subdir: str = "debug") -> Path:
        target = self.results / subdir / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        if fresh:
            future = self.marker_time + 5
            os.utime(target, (future, future))
        else:
            past = self.marker_time - 5
            os.utime(target, (past, past))
        return target

    def assert_gate(self, *, gradle_exit: int = 0, expect_pass: bool = True, code: str | None = None):
        totals, reasons = gate.evaluate(self.results, self.marker, gradle_exit)
        if expect_pass:
            self.assertEqual(reasons, [], f"expected PASS, got {reasons} ({totals.render()})")
        else:
            self.assertTrue(reasons, "expected FAIL, gate reported PASS")
            joined = " ".join(reasons)
            if code is not None:
                self.assertIn(code, joined, f"expected {code} in {joined}")
        return totals, reasons

    # --- passing shapes ----------------------------------------------------
    def test_real_agp_shape_28_tests_passes_and_is_not_double_counted(self):
        # Mirrors an actual AGP file: two <testsuite> children (19 + 9) whose
        # totals also appear on the <testsuites> root.
        self.write("TEST-device.xml", document(
            suite_xml("com.tabakpp.app.firestore.FirebaseRegistryRepositoryTest", 19),
            suite_xml("com.tabakpp.app.data.RegistryErrorStructuredCodeTest", 9),
        ))
        totals, _ = self.assert_gate()
        self.assertEqual(totals.tests, 28, "root aggregate must not be added to the suite totals")
        self.assertEqual(totals.executed, 28)
        self.assertEqual(totals.files, 1)

    def test_multiple_valid_files_are_summed(self):
        self.write("TEST-device-a.xml", document(suite_xml("A", 10)))
        self.write("TEST-device-b.xml", document(suite_xml("B", 4)))
        totals, _ = self.assert_gate()
        self.assertEqual(totals.files, 2)
        self.assertEqual(totals.tests, 14)

    def test_bare_testsuite_root_is_accepted(self):
        self.write("TEST-device.xml", '<?xml version="1.0"?>\n' + suite_xml("A", 3) + "\n")
        totals, _ = self.assert_gate()
        self.assertEqual(totals.tests, 3)

    # --- fail-closed shapes ------------------------------------------------
    def test_missing_results_directory_fails(self):
        self.results.rmdir()
        self.assert_gate(expect_pass=False, code="NO_RESULTS_DIR")

    def test_empty_results_directory_fails(self):
        self.assert_gate(expect_pass=False, code="NO_RESULTS")

    def test_stale_xml_only_fails(self):
        self.write("TEST-device.xml", document(suite_xml("A", 3)), fresh=False)
        self.assert_gate(expect_pass=False, code="NO_FRESH_RESULTS")

    def test_truncated_xml_fails(self):
        full = document(suite_xml("A", 3))
        self.write("TEST-device.xml", full[: len(full) // 2])
        self.assert_gate(expect_pass=False, code="MALFORMED_XML")

    def test_malformed_xml_fails(self):
        self.write("TEST-device.xml", "<testsuites><testsuite tests='1'></testsuites>")
        self.assert_gate(expect_pass=False, code="MALFORMED_XML")

    def test_unexpected_root_fails(self):
        self.write("TEST-device.xml", "<report><testsuite tests='1'/></report>")
        self.assert_gate(expect_pass=False, code="UNEXPECTED_ROOT")

    def test_zero_tests_fails(self):
        self.write("TEST-device.xml", document(suite_xml("A", 0)))
        self.assert_gate(expect_pass=False, code="EMPTY_RESULTS")

    def test_missing_required_attribute_fails(self):
        self.write("TEST-device.xml", document(
            '  <testsuite name="A" failures="0" errors="0" skipped="0"><testcase name="t"/></testsuite>',
            root_attrs='tests="1" failures="0" errors="0" skipped="0"',
        ))
        self.assert_gate(expect_pass=False, code="MISSING_ATTRIBUTE")

    def test_negative_attribute_fails(self):
        self.write("TEST-device.xml", document(
            '  <testsuite name="A" tests="-1" failures="0" errors="0" skipped="0"></testsuite>',
            root_attrs='',
        ))
        self.assert_gate(expect_pass=False, code="NEGATIVE_ATTRIBUTE")

    def test_non_numeric_attribute_fails(self):
        self.write("TEST-device.xml", document(
            '  <testsuite name="A" tests="many" failures="0" errors="0" skipped="0"></testsuite>',
            root_attrs='',
        ))
        self.assert_gate(expect_pass=False, code="NON_NUMERIC_ATTRIBUTE")

    def test_inconsistent_root_totals_fail(self):
        self.write("TEST-device.xml", document(suite_xml("A", 9),
                                              root_attrs='tests="28" failures="0" errors="0" skipped="0"'))
        self.assert_gate(expect_pass=False, code="INCONSISTENT_TOTALS")

    def test_declared_tests_must_match_testcase_elements(self):
        # Declares 5 tests but contains 3 -> truncated/edited file.
        self.write("TEST-device.xml", document(
            '  <testsuite name="A" tests="5" failures="0" errors="0" skipped="0">'
            '<testcase name="t1"/><testcase name="t2"/><testcase name="t3"/></testsuite>',
            root_attrs='tests="5" failures="0" errors="0" skipped="0"',
        ))
        self.assert_gate(expect_pass=False, code="INCONSISTENT_TOTALS")

    def test_failures_fail(self):
        self.write("TEST-device.xml", document(suite_xml("A", 5, failures=2, failure_elements=2)))
        self.assert_gate(expect_pass=False, code="FAILED_TESTS")

    def test_errors_fail(self):
        self.write("TEST-device.xml", document(suite_xml("A", 3, errors=1, error_elements=1)))
        self.assert_gate(expect_pass=False, code="FAILED_TESTS")

    def test_failure_element_with_zero_reported_failures_fails(self):
        # Header lies (failures="0") but a <failure> element is present.
        self.write("TEST-device.xml", document(
            '  <testsuite name="A" tests="1" failures="0" errors="0" skipped="0">'
            '<testcase name="t1"><failure>boom</failure></testcase></testsuite>',
            root_attrs='tests="1" failures="0" errors="0" skipped="0"',
        ))
        self.assert_gate(expect_pass=False, code="INCONSISTENT_TOTALS")

    def test_all_skipped_fails(self):
        self.write("TEST-device.xml", document(
            suite_xml("A", 4, skipped=4, skip_elements=4),
        ))
        self.assert_gate(expect_pass=False, code="ALL_SKIPPED")

    def test_nonzero_gradle_exit_fails_even_with_green_xml(self):
        self.write("TEST-device.xml", document(suite_xml("A", 28)))
        self.assert_gate(gradle_exit=1, expect_pass=False, code="GRADLE_EXIT_NONZERO")

    def test_missing_marker_fails(self):
        self.write("TEST-device.xml", document(suite_xml("A", 3)))
        self.marker.unlink()
        self.assert_gate(expect_pass=False, code="MISSING_MARKER")

    def test_one_malformed_file_beside_a_green_one_fails(self):
        self.write("TEST-good.xml", document(suite_xml("A", 3)))
        self.write("TEST-bad.xml", "<testsuites><testsuite")
        self.assert_gate(expect_pass=False, code="MALFORMED_XML")

    def test_stale_file_beside_a_fresh_one_is_ignored(self):
        self.write("TEST-old.xml", document(suite_xml("A", 99)), fresh=False)
        self.write("TEST-new.xml", document(suite_xml("B", 28)))
        totals, _ = self.assert_gate()
        self.assertEqual(totals.tests, 28, "stale file must not contribute to the totals")
        self.assertEqual(totals.stale, 1)

    # --- CLI contract ------------------------------------------------------
    def test_cli_exit_codes_and_summary_line(self):
        self.write("TEST-device.xml", document(suite_xml("A", 4)))
        green = gate.main(["--results-dir", str(self.results), "--marker", str(self.marker), "--gradle-exit", "0"])
        self.assertEqual(green, 0)
        self.write("TEST-device.xml", document(suite_xml("A", 4, failures=1, failure_elements=1)))
        red = gate.main(["--results-dir", str(self.results), "--marker", str(self.marker), "--gradle-exit", "0"])
        self.assertEqual(red, 1)

    # --- the gate is actually wired into CI --------------------------------
    def test_workflow_uses_the_gate_and_not_grep_extraction(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(".github/scripts/android-test-results-gate.py", workflow)
        self.assertIn("--results-dir", workflow)
        self.assertIn("--marker", workflow)
        self.assertIn("--gradle-exit", workflow)
        self.assertNotIn("xml_sum_attr", workflow, "the fragile grep-based extraction must not return")
        self.assertIn("RESULT_GATE_FAILED", workflow)

    def test_workflow_runs_this_test_suite(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(".github/scripts/test-android-test-results-gate.py", workflow)


if __name__ == "__main__":
    unittest.main(verbosity=2)
