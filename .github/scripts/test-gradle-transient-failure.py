#!/usr/bin/env python3
"""Self-test for gradle-transient-failure.py (run in the release workflow)."""
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

CASES = [
    ("maven central 429 (v1.0.21 attempt 1)", MAVEN_429, True),
    ("google maven 503", SERVER_503, True),
    ("connection reset during download", CONNECTION_RESET, True),
    ("kotlin compile error", COMPILE_ERROR, False),
    ("signing/keystore error", SIGNING_ERROR, False),
    ("artifact really missing (404)", MISSING_ARTIFACT, False),
    ("compile error with 429 noise", COMPILE_WITH_429_NOISE, False),
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
