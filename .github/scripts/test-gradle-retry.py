#!/usr/bin/env python3
"""Self-test for gradle-retry.sh (run in CI's validate-action-pins job).

Drives the retry loop with a fake gradlew that replays scripted attempts, and
checks the two properties that matter: a transient download failure is retried
(at most 3 attempts), and any other failure stops on the FIRST attempt with
Gradle's own exit code. Each case also runs under `bash -e`, GitHub's default
step shell, which silently disabled the original inline release loop.

Set BASH_FOR_TESTS to choose the bash binary (default: `bash` on PATH; on
Windows point it at Git Bash, since PATH may resolve to WSL's bash.exe).
"""
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
RETRY = os.path.join(HERE, "gradle-retry.sh")
spec = importlib.util.spec_from_file_location("tgtf", os.path.join(HERE, "test-gradle-transient-failure.py"))
tgtf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tgtf)

BASH = os.environ.get("BASH_FOR_TESTS") or shutil.which("bash") or "bash"

FAKE_GRADLEW = """\
#!/usr/bin/env bash
n=$(( $(cat "$FAKE_STATE/count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$FAKE_STATE/count"
printf '%s\\n' "$*" > "$FAKE_STATE/args-$n"
cat "$FAKE_STATE/out-$n"
exit "$(cat "$FAKE_STATE/code-$n")"
"""

OK = ("BUILD SUCCESSFUL in 3m 2s\n", 0)
NET_429 = (tgtf.ROBOLECTRIC_429, 1)
RELEASE_429 = (tgtf.MAVEN_429, 1)
COMPILE = (tgtf.COMPILE_ERROR, 7)
FAILING_TESTS = (tgtf.FAILING_TESTS_WITH_429_NOISE, 1)
LINT = (tgtf.RESOLUTION_PLUS_LINT, 5)

# (name, scripted attempts, expected exit, expected attempts run)
CASES = [
    ("success first time", [OK], 0, 1),
    ("429 then success", [NET_429, OK], 0, 2),
    ("429, 429, then success", [NET_429, RELEASE_429, OK], 0, 3),
    ("429 on every attempt gives up after 3", [NET_429, NET_429, NET_429, OK], 1, 3),
    ("compile error stops on attempt 1", [COMPILE, OK], 7, 1),
    ("failing tests stop on attempt 1", [FAILING_TESTS, OK], 1, 1),
    ("429 plus real lint failure stops on attempt 1", [LINT, OK], 5, 1),
    ("429 then a real test failure stops on attempt 2", [NET_429, FAILING_TESTS, OK], 1, 2),
]


def posix(path):
    return path.replace("\\", "/")


def run_case(attempts, errexit):
    with tempfile.TemporaryDirectory() as tmp:
        state = os.path.join(tmp, "state")
        logs = os.path.join(tmp, "logs")
        os.mkdir(state)
        os.mkdir(logs)
        fake = os.path.join(tmp, "gradlew")
        with open(fake, "w", newline="\n") as f:
            f.write(FAKE_GRADLEW)
        os.chmod(fake, 0o755)
        for i, (out, code) in enumerate(attempts, start=1):
            with open(os.path.join(state, f"out-{i}"), "w", newline="\n", encoding="utf-8") as f:
                f.write(out)
            with open(os.path.join(state, f"code-{i}"), "w", newline="\n") as f:
                f.write(str(code))
        env = dict(
            os.environ,
            FAKE_STATE=posix(state),
            GRADLEW=posix(fake),
            PYTHON=posix(sys.executable),
            GRADLE_RETRY_WAIT_UNIT="0",
            GRADLE_RETRY_LOG_DIR=posix(logs),
        )
        cmd = f'bash "{posix(RETRY)}" selftest :a:task --no-daemon'
        argv = [BASH, "-e", "-c", cmd] if errexit else [BASH, "-c", cmd]
        proc = subprocess.run(argv, env=env, capture_output=True, text=True)
        count_file = os.path.join(state, "count")
        ran = int(open(count_file).read().strip()) if os.path.exists(count_file) else 0
        args_ok = all(
            open(os.path.join(state, f"args-{i}")).read().strip() == ":a:task --no-daemon"
            for i in range(1, ran + 1)
        )
        logs_ok = all(os.path.exists(os.path.join(logs, f"selftest-{i}.log")) for i in range(1, ran + 1))
        return proc.returncode, ran, args_ok and logs_ok, proc


def main():
    failures = 0
    total = 0
    for name, attempts, want_exit, want_ran in CASES:
        for errexit in (False, True):
            total += 1
            code, ran, plumbing_ok, proc = run_case(attempts, errexit)
            ok = code == want_exit and ran == want_ran and plumbing_ok
            shell = "bash -e" if errexit else "bash"
            print(f"{'PASS' if ok else 'FAIL'}: [{shell}] {name} -> exit {code}, attempts {ran}"
                  f" (want exit {want_exit}, attempts {want_ran})")
            if not ok:
                failures += 1
                print(proc.stdout[-2000:], proc.stderr[-2000:], sep="\n")
    usage = subprocess.run([BASH, posix(RETRY), "only-a-label"], capture_output=True).returncode
    total += 1
    print(f"{'PASS' if usage == 2 else 'FAIL'}: missing gradle args -> exit {usage}")
    failures += 0 if usage == 2 else 1
    if failures:
        print(f"{failures} case(s) failed")
        return 1
    print(f"All {total} gradle-retry cases passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
