#!/usr/bin/env python3
"""Self-test for gradle-transient-failure.py (run in CI and the release workflow)."""
import importlib.util
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "gradle-transient-failure.py")
spec = importlib.util.spec_from_file_location("gtf", SCRIPT)
gtf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gtf)

# Verbatim shape of the v1.0.21 signing failure (run 45629063905, attempt 1).
MAVEN_429 = """\
FAILURE: Build failed with an exception.
* What went wrong:
Configuration cache state could not be cached: field `__classpath__` of task `:androidApp:produceReleaseComposeMapping`
> Could not resolve all files for configuration ':androidApp:composeMappingProducerClasspath'.
   > Could not resolve org.jetbrains.kotlin:compose-group-mapping:2.4.21.
      > Repository MavenRepo is disabled due to earlier error below:
         > Could not download org.jetbrains.kotlin.android.gradle.plugin-2.4.21.jar
            > Could not get resource 'https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/android/x.jar'.
               > Could not HEAD 'https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/android/x.jar'.
                  > Received status code 429 from server: Too Many Requests
BUILD FAILED in 19s
"""

SERVER_503 = """\
> Could not resolve com.android.tools.build:gradle:9.1.0.
   > Could not GET 'https://dl.google.com/dl/android/maven2/x.pom'.
      > Received status code 503 from server: Service Unavailable
BUILD FAILED in 12s
"""

CONNECTION_RESET = """\
> Could not download kotlin-stdlib-2.4.21.jar (org.jetbrains.kotlin:kotlin-stdlib:2.4.21)
   > Could not get resource 'https://repo.maven.apache.org/maven2/x.jar'.
      > Connection reset
"""

COMPILE_ERROR = """\
e: file:///home/runner/work/tabakpp/composeApp/src/App.kt:12:5 Unresolved reference 'foo'.
FAILURE: Build failed with an exception.
* What went wrong:
Execution failed for task ':composeApp:compileReleaseKotlinAndroid'.
> Compilation error. See log for more details
BUILD FAILED in 1m 4s
"""

SIGNING_ERROR = """\
* What went wrong:
Execution failed for task ':androidApp:packageRelease'.
> A failure occurred while executing com.android.build.gradle.tasks.PackageAndroidArtifact$IncrementalSplitterRunnable
   > com.android.ide.common.signing.KeytoolException: Failed to read key tabakpp from store: Keystore was tampered with, or password was incorrect
"""

# A real 404: the dependency does not exist. Retrying cannot help.
MISSING_ARTIFACT = """\
> Could not resolve all files for configuration ':shared:debugCompileClasspath'.
   > Could not find org.example:does-not-exist:1.0.
     Searched in the following locations:
       - https://repo.maven.apache.org/maven2/org/example/does-not-exist/1.0/does-not-exist-1.0.pom
"""

# A 429 mentioned in a compile failure must still not be retried.
COMPILE_WITH_429_NOISE = COMPILE_ERROR + "\nReceived status code 429 from server: Too Many Requests\n> Could not GET 'x'\n"

# Verbatim shape of CI run 45645048588 (main, 7a580ce, job `mobile`): the test
# task failed while resolving its runtime classpath, before any test ran. The
# 2>&1 merge interleaves stdout into the cause chain, as in the real log.
ROBOLECTRIC_429 = """\
> Task :composeApp:testDebugUnitTest FAILED
FAILURE: Build failed with an exception.

* What went wrong:

Execution failed for task ':composeApp:testDebugUnitTest' (registered by plugin 'com.android.internal.library').
> Could not resolve all files for configuration ':composeApp:debugUnitTestRuntimeClasspath'.
   > Could not download nativeruntime-dist-compat-1.0.19.jar (org.robolectric:nativeruntime-dist-compat:1.0.19)
      > Could not get resource 'https://repo.maven.apache.org/maven2/org/robolectric/nativeruntime-dist-compat/1.0.19/nativeruntime-dist-compat-1.0.19.jar'.
Deprecated Gradle features were used in this build, making it incompatible with Gradle 10.
203 actionable tasks: 203 executed
         > Could not GET 'https://repo.maven.apache.org/maven2/org/robolectric/nativeruntime-dist-compat/1.0.19/nativeruntime-dist-compat-1.0.19.jar'.
            > Received status code 429 from server: Too Many Requests

BUILD FAILED in 1m 51s
"""

# A real unit-test failure in the same task, with 429 noise elsewhere in the log.
FAILING_TESTS_WITH_429_NOISE = """\
> Task :composeApp:testDebugUnitTest FAILED
* What went wrong:
Execution failed for task ':composeApp:testDebugUnitTest'.
> There were failing tests. See the report at: file:///home/runner/work/x/index.html
> Could not GET 'https://repo.maven.apache.org/maven2/x.jar'.
   > Received status code 429 from server: Too Many Requests
"""

# Two failures (parallel build): one resolution 429, one real lint failure.
RESOLUTION_PLUS_LINT = ROBOLECTRIC_429 + """\
Execution failed for task ':androidApp:lintDebug'.
> Lint found errors in the project; aborting build.
"""

CASES = [
    ("maven central 429 (v1.0.21 attempt 1)", MAVEN_429, True),
    ("google maven 503", SERVER_503, True),
    ("connection reset during download", CONNECTION_RESET, True),
    ("kotlin compile error", COMPILE_ERROR, False),
    ("signing/keystore error", SIGNING_ERROR, False),
    ("artifact really missing (404)", MISSING_ARTIFACT, False),
    ("compile error with 429 noise", COMPILE_WITH_429_NOISE, False),
    ("robolectric 429 resolving test classpath (CI run 45645048588)", ROBOLECTRIC_429, True),
    ("failing unit tests with 429 noise", FAILING_TESTS_WITH_429_NOISE, False),
    ("resolution 429 plus a real lint failure", RESOLUTION_PLUS_LINT, False),
    ("empty log", "", False),
]


def run_cli(text):
    with tempfile.NamedTemporaryFile("w", suffix=".log", delete=False, encoding="utf-8") as f:
        f.write(text)
        path = f.name
    try:
        return subprocess.run([sys.executable, SCRIPT, path]).returncode
    finally:
        os.unlink(path)


def main():
    failures = 0
    for name, log, expected in CASES:
        got = gtf.is_transient(log)
        cli = run_cli(log)
        cli_ok = (cli == 0) == expected
        ok = got == expected and cli_ok
        print(f"{'PASS' if ok else 'FAIL'}: {name} -> retry={got} (cli exit {cli})")
        failures += 0 if ok else 1
    missing = subprocess.run([sys.executable, SCRIPT, os.path.join(HERE, "no-such-file.log")]).returncode
    print(f"{'PASS' if missing == 1 else 'FAIL'}: unreadable log -> exit {missing}")
    failures += 0 if missing == 1 else 1
    if failures:
        print(f"{failures} case(s) failed")
        return 1
    print(f"All {len(CASES) + 1} transient-failure cases passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
