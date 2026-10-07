"""Require both main acceptance workflows to have succeeded for the exact SHA."""
import json
import subprocess
import sys


def check(sha):
    for workflow in ("ci.yml", "android-integration.yml"):
        runs = json.loads(subprocess.check_output([
            "gh", "run", "list", "--workflow", workflow, "--commit", sha,
            "--branch", "main", "--event", "push", "--limit", "20",
            "--json", "headSha,status,conclusion,databaseId",
        ], text=True))
        matching = [run for run in runs if run["headSha"] == sha]
        if not matching:
            raise RuntimeError(f"No main push acceptance run for {workflow} at {sha}")
        latest = max(matching, key=lambda run: run["databaseId"])
        if latest["status"] != "completed" or latest["conclusion"] != "success":
            raise RuntimeError(f"{workflow} acceptance is not successful at {sha}: {latest['status']}/{latest['conclusion']}")
        print(f"Verified {workflow} run {latest['databaseId']} at {sha}")


if __name__ == "__main__":
    check(sys.argv[1])
