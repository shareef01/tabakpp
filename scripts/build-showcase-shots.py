"""Copy desktop red web shots into showcase/ (run after npm run screenshots)."""
from pathlib import Path
import shutil

root = Path(r"C:\Users\LENOVO\AndroidStudioProjects\tabakpp\assets\screenshots")
src = root / "web" / "desktop" / "red"
out = root / "showcase"
out.mkdir(exist_ok=True)

# Clear old multi-theme phone frames from showcase
for stale in out.glob("*"):
    stale.unlink()

for name in ("auth", "track", "history", "settings"):
    f = src / f"{name}.png"
    if not f.exists():
        raise SystemExit(f"missing {f} — run npm run screenshots first")
    shutil.copy2(f, out / f"web-{name}.png")

print("showcase:", sorted(p.name for p in out.iterdir()))
