import os
import subprocess
from pathlib import Path

repo = Path(r"C:\Users\LENOVO\AndroidStudioProjects\tabakpp")
git = Path(os.environ.get("LOCALAPPDATA", "")) / "..."  # resolve below

def find_git():
    for p in [
        Path(r"C:\Program Files\Git\cmd\git.exe"),
        Path(r"C:\Program Files\Git\bin\git.exe"),
        Path(r"C:\Program Files (x86)\Git\cmd\git.exe"),
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

def run(*args):
    r = subprocess.run([git_exe, *args], cwd=repo, env=env, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"fail {args}: {r.stderr or r.stdout}")
    return r.stdout.strip()

tree = run("rev-parse", "HEAD^{tree}")
parent = run("rev-parse", "HEAD^")
msg_path = Path(os.environ["TEMP"]) / "tabakpp-clean-msg.txt"
msg_path.write_text("docs: rewrite README as a product page with curated screenshots\n", encoding="utf-8")
new = run("commit-tree", tree, "-p", parent, "-F", str(msg_path))
print("new", new)
run("reset", "--hard", new)
body = run("log", "-1", "--format=%B")
print("BODY<<<")
print(body)
print(">>>")
if "Co-authored-by:" in body:
    raise SystemExit("still has coauthor")
print("clean ok")
