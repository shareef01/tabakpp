"""Build README showcase from desktop-red web + phone-red Android shots."""
from pathlib import Path
import shutil

from PIL import Image

root = Path(r"C:\Users\LENOVO\AndroidStudioProjects\tabakpp\assets\screenshots")
out = root / "showcase"
out.mkdir(exist_ok=True)

# Prefer fresh Signal-red captures; fall back to last rose/magenta set.
android_src = root / "android" / "red"
if not (android_src / "track.png").exists():
    android_src = root / "android" / "rose"

web_src = root / "web" / "desktop" / "red"

for stale in out.glob("*"):
    stale.unlink()

for name in ("auth", "track", "history", "settings"):
    f = web_src / f"{name}.png"
    if not f.exists():
        raise SystemExit(f"missing {f} — run npm run screenshots first")
    shutil.copy2(f, out / f"web-{name}.png")

for name in ("track", "history", "settings"):
    f = android_src / f"{name}.png"
    if not f.exists():
        raise SystemExit(f"missing {f} — connect device and run scripts/android-screenshots.ps1")
    img = Image.open(f).convert("RGB")
    w, h = img.size
    top = int(h * 0.035)
    bottom = int(h * 0.965)
    img = img.crop((0, top, w, bottom))
    w, h = img.size
    if name == "history" and h > int(w * 2.15):
        img = img.crop((0, 0, w, int(w * 2.15)))
    if name == "settings" and h > int(w * 2.15):
        img = img.crop((0, 0, w, int(w * 2.15)))
    img.save(out / f"android-{name}.png", "PNG", optimize=True)

print("showcase:", sorted(p.name for p in out.iterdir()))
print("android source:", android_src)
