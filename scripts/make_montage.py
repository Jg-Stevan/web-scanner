from PIL import Image

paths = [f"upload/frames2/t{t}.jpg" for t in [0,4,8,12,16,20,24,28,32,36,40]]
imgs = [Image.open(p) for p in paths]
w = max(i.width for i in imgs)
cols, rows = 4, 3
cw, ch = w, imgs[0].height
canvas = Image.new("RGB", (cols*cw + 8*(cols+1), rows*ch + 30*rows + 8*(rows+1)), "black")
from PIL import ImageDraw
d = ImageDraw.Draw(canvas)
for idx, im in enumerate(imgs):
    r, c = divmod(idx, cols)
    x = 8 + c*(cw+8); y = 8 + r*(ch+30+8)
    canvas.paste(im, (x, y))
    d.text((x+8, y+ch+8), f"t={[0,4,8,12,16,20,24,28,32,36,40][idx]}s", fill="yellow")
canvas.save("upload/frames2/montage_t.jpg", quality=82)
print("saved", canvas.size)
