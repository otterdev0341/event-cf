"""Render standard PlantUML sources locally, then encode the result as JPEG.
Usage: python3 docs/diagrams/render.py /path/to/plantuml.jar
Requires Java, PlantUML, Pillow and DejaVu Sans. Smetana avoids external Graphviz.
"""
from pathlib import Path
import subprocess
import sys
import tempfile
from PIL import Image

root = Path(__file__).resolve().parent
if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 docs/diagrams/render.py /path/to/plantuml.jar')
jar = Path(sys.argv[1]).resolve(strict=True)
sources = sorted(root.glob('*.puml'))
with tempfile.TemporaryDirectory(prefix='event-confirm-plantuml-') as output:
    subprocess.run([
        'java', '-Xmx256m', '-Djava.awt.headless=true', '-jar', str(jar),
        '-failfast2', '-charset', 'UTF-8', '-tpng', '-o', output,
        *map(str, sources),
    ], check=True)
    for source in sources:
        with Image.open(Path(output) / source.with_suffix('.png').name) as image:
            target = source.with_suffix('.jpg')
            image.convert('RGB').save(target, quality=95, subsampling=0)
            print(f'{target.name}: {image.width} x {image.height}')
