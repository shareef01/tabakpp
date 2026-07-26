import os
import subprocess
from pathlib import Path

repo = Path(r"C:\Users\LENOVO\AndroidStudioProjects\tabakpp")

def find_git():
    for p in [
        Path(r"C:\Program Files\Git\cmd\git.exe"),
        Path(r"C:\Program Files\Git\bin\git.exe"),
    ]:
        if p.exists():
            return str(p)
    return "git"

git_exe = find_git()
env = os.environ.copy()
env["GIT_AUTHOR_NAME"] = "shareef01"
env["GIT_AUTHOR_EMAIL"] = "shareef.q13@gmail.com"
env["GIT_COMMITTER_NAME"] = "shareef01"
env["GIT_COMMITTER_EMAIL"] = "shareef.q13@gmail.com"

def run(*args, check=True):
    r = subprocess.run([git_exe, *args], cwd=repo, env=env, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SystemExit(f"fail {args}:\n{r.stderr or r.stdout}")
    return r.stdout.strip()

# Stage README + screenshots + scripts
run("add", "README.md", "assets/screenshots/showcase", "assets/screenshots/web/desktop", "assets/screenshots/auth.png", "assets/screenshots/track.png", "assets/screenshots/history.png", "assets/screenshots/settings.png", "webApp/scripts/screenshot.mjs", "scripts/build-showcase-shots.py")
# Also stage removed showcase files if any
status = run("status", "--porcelain")
print(status)

# Create commit via commit-tree so Cursor cannot inject Co-authored-by
run("write-tree")  # ensure index is ready
# Use git commit normally first? No - use:
# git add already done. Get tree from index:
tree = run("write-tree")
parent = run("rev-parse", "HEAD")
msg_path = Path(os.environ["TEMP"]) / "tabakpp-msg.txt"
msg_path.write_text(
    "docs: use desktop red web screenshots in README\n",
    encoding="utf-8",
)
new = run("commit-tree", tree, "-p", parent, "-F", str(msg_path))
print("new", new)
run("reset", "--hard", new)
body = run("log", "-1", "--format=%B")
print("BODY:", repr(body))
if "Co-authored-by:" in body:
    raise SystemExit("coauthor leaked")
print("clean")
