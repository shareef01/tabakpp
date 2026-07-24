from PIL import Image
from pathlib import Path

root = Path(r"C:\Users\LENOVO\AndroidStudioProjects\tabakpp\assets\screenshots")
out = root / "showcase"
out.mkdir(exist_ok=True)

web_picks = [
    ("web/emerald/track.png", "web-track.png"),
    ("web/emerald/history.png", "web-history.png"),
    ("web/emerald/settings.png", "web-settings.png"),
    ("web/emerald/auth.png", "web-auth.png"),
    ("web/cobalt/track.png", "theme-cobalt.png"),
    ("web/rose/track.png", "theme-rose.png"),
    ("web/violet/track.png", "theme-violet.png"),
]

for src, name in web_picks:
    img = Image.open(root / src).convert("RGB")
    w, h = img.size
    if name in ("web-history.png", "web-settings.png") and h > int(w * 2.15):
        img = img.crop((0, 0, w, int(w * 2.15)))
    img.save(out / name, "PNG", optimize=True)

android_picks = [
    ("android/emerald/track.png", "android-track.png"),
    ("android/emerald/history.png", "android-history.png"),
    ("android/emerald/settings.png", "android-settings.png"),
    ("android/cobalt/track.png", "android-theme-cobalt.png"),
]

for src, name in android_picks:
    img = Image.open(root / src).convert("RGB")
    w, h = img.size
    top = int(h * 0.035)
    bottom = int(h * 0.965)
    img = img.crop((0, top, w, bottom))
    w, h = img.size
    if "history" in name and h > int(w * 2.2):
        img = img.crop((0, 0, w, int(w * 2.2)))
    img.save(out / name, "PNG", optimize=True)

print("wrote", sorted(p.name for p in out.iterdir()))
