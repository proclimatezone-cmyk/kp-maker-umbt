"""ТТХ чиллеров, тепловых насосов и наружных блоков VRF из каталогов -> src/data/gen-specs.json.
Колоночный разбор pdftotext -layout: шапка «Модель ...» задаёт колонки, строки ниже — параметры.
Запуск: python3 scripts/build-gen-specs.py
"""
import json, re, subprocess, pathlib, os

root = pathlib.Path(__file__).resolve().parent.parent
cdir = os.environ.get('CATALOGS_DIR', '/Users/muhammadjonaka/MN OG MAC v/каталоги')
sources = json.load(open(root / 'src/data/catalog-sources.json'))
KEYS = ['chiller-2026', 'vrf-2026', 'atom-2026', 'atom-b-2026']
norm = lambda s: re.sub(r'[\s()]', '', s.upper()).replace('А', 'A').replace('Х', 'X')

def tokens(line):
    return [(m.start(), m.end(), m.group().strip()) for m in re.finditer(r'\S+(?: \S+)*', line)]

RULES = [  # (ключ, обязательные слова, запрещённые)
    ('coolPower', ['мощн', 'охлажд'], ['производительн']),
    ('heatPower', ['мощн', 'нагрев'], ['производительн']),
    ('coolKw', ['производительн', 'охлажд'], []),
    ('heatKw', ['производительн', 'нагрев'], []),
    ('eer', ['eer'], []), ('cop', ['cop'], []),
    ('waterFlow', ['расход', 'жидкост'], []), ('waterFlow', ['расход', 'вод'], []),
    ('waterDp', ['потер', 'давлен'], []), ('waterDp', ['перепад'], []), ('waterDp', ['гидравлич', 'сопротивл'], []),
    ('airflow', ['расход', 'воздух'], []),
    ('noise', ['звук'], ['мощност']), ('noise', ['шум'], []),
    ('refrigerant', ['хладагент', 'тип'], []),
    ('powerSupply', ['электропитание'], []),
    ('compressor', ['компрессор', 'тип'], []),
    ('tempCool', ['диапазон', 'охлажд'], []), ('tempHeat', ['диапазон', 'нагрев'], []),
    ('tempCool', ['температур', 'охлажд'], ['вод']), ('tempHeat', ['температур', 'нагрев'], ['вод']),
    ('pipe', ['диаметр', 'подключ'], []),
    ('maxCurrent', ['макс', 'ток'], []),
    ('dims', ['габарит', 'нетто'], ['упаков']), ('dims', ['габарит'], ['брутто', 'упаков']), ('dims', ['размер', 'шхвхг'], ['упаков']),
    ('weight', ['вес', 'нетто'], ['размер', 'упаков', 'габарит']), ('weight', ['масса', 'нетто'], ['размер', 'упаков', 'габарит']),
    ('weight', ['вес'], ['брутто', 'рабоч', 'размер', 'упаков', 'габарит']), ('weight', ['масса'], ['брутто', 'размер', 'упаков', 'габарит']),
]

NUMK = r'-?\d+(?:[.,]\d+)?'
VALID = {
    'coolKw': (NUMK, 0.5, 3000), 'heatKw': (NUMK, 0.5, 3000), 'coolPower': (NUMK, 0.1, 1500), 'heatPower': (NUMK, 0.1, 1500),
    'eer': (NUMK, 1.5, 9), 'cop': (NUMK, 1.5, 9), 'waterFlow': (NUMK, 0.1, 1000), 'waterDp': (NUMK, 1, 500),
    'noise': (NUMK, 20, 110), 'maxCurrent': (NUMK, 1, 2000), 'weight': (NUMK, 5, 50000),
}
def valid(k, v):
    if k in VALID:
        rx, lo, hi = VALID[k]
        if not re.fullmatch(rx, v.strip()):
            return False
        return lo <= float(v.replace(',', '.')) <= hi
    if k == 'airflow':
        return bool(re.fullmatch(r'\d[\d\s]*(?:\*\d+)?', v.strip()))
    if k in ('tempCool', 'tempHeat'):
        return bool(re.fullmatch(r'[-+]?\d+\s*~\s*[-+]?\d+', v.strip()))
    if k == 'compressor':
        return bool(re.search(r'[A-Za-zА-Яа-я]{4,}', v)) and not re.search(r'плавн|ступен', v, re.I)
    if k == 'refrigerant':
        return bool(re.fullmatch(r'R\d{2,3}[A-ZА]?', v.strip().replace(' ', '')))
    if k == 'pipe':
        return bool(re.fullmatch(r'DN\d+', v.strip()))
    if k == 'powerSupply':
        return bool(re.search(r'\d{3}', v)) and '~' not in v.replace('~ 4', '').replace('~4', '') or bool(re.search(r'\d{3}\s*[~-]\s*\d{3}', v))
    return True

def classify(ctx):
    for key, need, ban in RULES:
        if all(w in ctx for w in need) and not any(w in ctx for w in ban):
            return key
    return None

out = {}
for key in KEYS:
    pdf = os.path.join(cdir, sources[key]['filename'])
    if not os.path.exists(pdf):
        continue
    text = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True).stdout
    for pi, page in enumerate(text.split('\f'), 1):
        lines = page.split('\n')
        i = 0
        while i < len(lines):
            l = lines[i]
            m = re.match(r'\s*Модель\s', l)
            if not m:
                i += 1; continue
            frag = lambda t: not re.search(r'[а-яё]', t[2], re.I) and re.search(r'[A-Z0-9(]', t[2])
            hl = []
            for d in (-2, -1, 0, 1):
                if 0 <= i + d < len(lines):
                    ln = lines[i + d]
                    ts = [(x.start(), x.end(), x.group()) for x in re.finditer(r'\S+', ln)]
                    ts = [t for t in ts if t[0] > (m.end() - 1 if d == 0 else 30)]
                    if ts and all(frag(t) for t in ts) and (d == 0 or not re.search(r'[а-яё]', ln, re.I)):
                        hl.append((d, ts))
            h0 = [ts for d, ts in hl if d == 0]
            if h0:
                m0 = min(a_ for a_, _, _ in h0[0]) - 15
                hl = [ts for d, ts in hl if d == 0 or (len(ts) >= 2 and min(a_ for a_, _, _ in ts) >= m0)]
            else:
                hl = []
            if not hl:
                i += 1; continue
            base = max(hl, key=len)
            cols = [[(a_ + b_) / 2, ''] for a_, b_, _ in base]
            for ts in hl:
                for a_, b_, t in ts:
                    c = min(cols, key=lambda col: abs(col[0] - (a_ + b_) / 2))
                    c[1] += t
            cols = [(c, h) for c, h in cols if re.search(r'[A-Z]', h) and re.search(r'\d', h)]
            if not cols:
                i += 1; continue
            left = min(a_ for ts in hl for a_, _, _ in ts) - 4
            heads = cols
            rows = []
            j = i + 1
            while j < len(lines) and j < i + 50:
                ln = lines[j]
                if re.match(r'\s*Модель\s', ln) or 'указана при' in ln or 'Производительность указана' in ln:
                    break
                toks = tokens(ln)
                lab = [t for t in toks if t[1] <= left]
                vals = [t for t in toks if t[1] > left]
                rows.append((ln[:left].lower(), vals, ' '.join(t[2] for t in lab).lower()))
                j += 1
            starts = [len(x[0]) - len(x[0].lstrip()) for x in rows if x[0].strip()]
            base = min(starts) if starts else 0
            gl = [x[0][base:base + 20].strip() for x in rows]
            for r, (labtxt, vals, lab) in enumerate(rows):
                if not vals:
                    continue
                ctx = ' '.join(x for x in [gl[r - 1] if r else '', labtxt, gl[r + 1] if r + 1 < len(rows) else ''] if x)
                k = classify(labtxt) or classify(ctx)
                if not k:
                    continue
                assign = {}
                for cc, h in cols:
                    best = min(vals, key=lambda t: abs((t[0] + t[1]) / 2 - cc))
                    if len(vals) >= len(cols) and abs((best[0] + best[1]) / 2 - cc) > 25:
                        continue
                    assign[h] = best[2]
                for h, v in assign.items():
                    v = v.replace(' х ', '×').replace(' x ', '×').replace('х', '×') if k == 'dims' else v
                    if k == 'dims' and not re.fullmatch(r'\d+×\d+×\d+', v.replace(' ', '')):
                        continue
                    if k not in ('compressor', 'refrigerant') and not re.search(r'\d', v):
                        continue
                    if k == 'weight' and re.fullmatch(r'\d+(?:[.,]\d+)?\s*/\s*\d+(?:[.,]\d+)?', v):
                        v = v.split('/')[0].strip()
                    if not valid(k, v):
                        continue
                    if h.upper().startswith('MK'):
                        continue
                    rec = out.setdefault(norm(h), {'model': h, 'catalogKey': key, 'page': pi})
                    if rec['page'] == pi and rec['catalogKey'] == key:
                        rec.setdefault(k, v.replace(' ', '') if k == 'dims' else v)
            i = max(j, i + 2)

json.dump(dict(sorted(out.items())), open(root / 'src/data/gen-specs.json', 'w'), ensure_ascii=False, indent=1)
print(len(out), 'моделей')
