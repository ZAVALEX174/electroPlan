# Сжатие картинок каталога img/catalog/*.jpg перед коммитом в git:
# длинная сторона <= 1200px, JPEG quality=82, optimize. Имена файлов не меняются —
# пересборка каталогов не нужна (catalog-vimar.js ссылается на те же пути).
# Оригиналы восстанавливаются перескачиванием: node tools/download-catalog-images.mjs
# (после удаления нужных файлов — скачивальщик докачивает отсутствующие).
import os
import sys
from PIL import Image

DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "img", "catalog")
MAX_SIDE = 1200
QUALITY = 82

files = sorted(f for f in os.listdir(DIR) if f.lower().endswith(".jpg"))
total_before = total_after = 0
resized = recompressed = skipped = errors = 0
for i, name in enumerate(files, 1):
    p = os.path.join(DIR, name)
    before = os.path.getsize(p)
    total_before += before
    try:
        im = Image.open(p)
        im.load()
        w, h = im.size
        changed = False
        if max(w, h) > MAX_SIDE:
            k = MAX_SIDE / max(w, h)
            im = im.resize((round(w * k), round(h * k)), Image.LANCZOS)
            resized += 1
            changed = True
        if im.mode != "RGB":
            im = im.convert("RGB")
            changed = True
        if changed or before > 250 * 1024:
            im.save(p, "JPEG", quality=QUALITY, optimize=True)
            recompressed += 1
        else:
            skipped += 1
        total_after += os.path.getsize(p)
    except Exception as e:
        errors += 1
        total_after += before
        print(f"ОШИБКА {name}: {e}", file=sys.stderr)
    if i % 300 == 0:
        print(f"…{i}/{len(files)} ({total_after // 1024 // 1024} МБ из {total_before // 1024 // 1024} МБ)", flush=True)

print(f"ГОТОВО: файлов {len(files)}, ресайз {resized}, пережато {recompressed}, без изменений {skipped}, ошибок {errors}")
print(f"Объём: {total_before / 1024 / 1024:.0f} МБ → {total_after / 1024 / 1024:.0f} МБ")
