#!/usr/bin/env bash
# Run a Gradle build, retrying ONLY on transient dependency-download failures.
#
# Usage: bash .github/scripts/gradle-retry.sh <log-label> <gradle args...>
#
# Maven Central rate-limits GitHub-hosted runners (HTTP 429): release v1.0.21's
# signing build (run 45629063905) and CI's `mobile` job on main (run
# 45645048588, Robolectric nativeruntime-dist-compat) both failed on a download,
# not on the code. After a failed attempt, gradle-transient-failure.py reads the
# attempt's log and allows a retry only when it shows a download context AND a
# network cause and no compile/lint/test/signing failure. Anything else fails
# on the first attempt with Gradle's own exit code. At most 3 attempts, waiting
# 60 s then 120 s.
#
# Run this as its own `bash` process. GitHub's default step shell is `bash -e`,
# under which a failed `gradlew | tee` pipeline ends the step before the
# classifier is consulted, so the loop never retries. `set +e` below makes the
# script independent of the caller's shell options.
#
# Overridable for the self-test (test-gradle-retry.py): GRADLEW (default
# ./gradlew), PYTHON (default python3), GRADLE_RETRY_WAIT_UNIT (default 60 s),
# GRADLE_RETRY_LOG_DIR (default $RUNNER_TEMP).
set +e
set -uo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: gradle-retry.sh <log-label> <gradle args...>" >&2
  exit 2
fi
label=$1
shift

script_dir=$(cd "$(dirname "$0")" && pwd)
classifier="$script_dir/gradle-transient-failure.py"
gradlew=${GRADLEW:-./gradlew}
python=${PYTHON:-python3}
wait_unit=${GRADLE_RETRY_WAIT_UNIT:-60}
log_dir=${GRADLE_RETRY_LOG_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}}
max_attempts=3

for attempt in $(seq 1 "$max_attempts"); do
  log="$log_dir/$label-$attempt.log"
  "$gradlew" "$@" 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  if [ "$status" -eq 0 ]; then
    exit 0
  fi
  if [ "$attempt" -lt "$max_attempts" ] && "$python" "$classifier" "$log"; then
    wait_s=$((wait_unit * attempt))
    echo "::warning::Transient dependency-download failure on attempt $attempt of $max_attempts ($label); retrying in ${wait_s}s."
    sleep "$wait_s"
    continue
  fi
  echo "::error::Gradle failed on attempt $attempt of $max_attempts ($label, exit $status); not a retryable network failure, or out of attempts."
  exit "$status"
done
