import re
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "public" / "index.html"
text = p.read_text(encoding="utf-8")
text2, n = re.subn(
    r'(Cancelar</button>\s*)</motion>(\s*)</motion>(\s*)</motion>',
    r'\1</motion>\2</motion>\3</motion>',
    text,
    count=1,
)
# closing tags: motion -> div (invalid tag name in HTML)
closers = chr(60) + "/div" + chr(62)
text2, n = re.subn(
    r'(Cancelar</button>\s*)</motion>(\s*)</motion>(\s*)</motion>',
    lambda m: m.group(1) + closers + m.group(2) + closers + m.group(3) + closers,
    text,
    count=1,
)
if n == 0:
    raise SystemExit("pattern not found")
p.write_text(text2, encoding="utf-8")
print("fixed", n)
