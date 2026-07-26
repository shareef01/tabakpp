from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

out = Path(r"C:\Users\LENOVO\AndroidStudioProjects\tabakpp\webApp\public")
ACCENT = (255, 95, 95, 255)
WHITE = (255, 255, 255, 255)
BG = (0, 0, 0, 255)


def make_icon(size: int, path: Path) -> None:
    img = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(img)
    font_paths = [
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arial.ttf",
    ]
    font_path = next((p for p in font_paths if Path(p).exists()), None)
    t_size = int(size * 0.42)
    plus_size = int(size * 0.34)
    if font_path:
        font_t = ImageFont.truetype(font_path, t_size)
        font_plus = ImageFont.truetype(font_path, plus_size)
    else:
        font_t = ImageFont.load_default()
        font_plus = font_t

    t, plus = "t", "++"
    tb = draw.textbbox((0, 0), t, font=font_t)
    pb = draw.textbbox((0, 0), plus, font=font_plus)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    pw, ph = pb[2] - pb[0], pb[3] - pb[1]
    gap = max(2, int(size * 0.015))
    total_w = tw + gap + pw
    x0 = (size - total_w) // 2
    yt = (size - th) // 2 - tb[1]
    yp = (size - ph) // 2 - pb[1]
    draw.text((x0 - tb[0], yt), t, font=font_t, fill=WHITE)
    draw.text((x0 + tw + gap - pb[0], yp), plus, font=font_plus, fill=ACCENT)
    img.save(path, "PNG")
    print(f"wrote {path} ({size})")


make_icon(180, out / "apple-touch-icon.png")
make_icon(192, out / "icon-192.png")
make_icon(512, out / "icon-512.png")
