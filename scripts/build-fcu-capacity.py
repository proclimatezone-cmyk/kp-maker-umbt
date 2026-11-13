"""Извлекает мощность фанкойлов (выс./сред./низ.) из каталога FCU Midea.pdf -> src/data/fcu-capacity.json.
Запуск: python3 scripts/build-fcu-capacity.py "/path/FCU Midea.pdf"
"""
import json, re, subprocess, sys, pathlib

pdf = sys.argv[1] if len(sys.argv) > 1 else '/Users/muhammadjonaka/MN OG MAC v/каталоги/FCU Midea.pdf'
root = pathlib.Path(__file__).resolve().parent.parent
pages = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True, check=True).stdout.split('\f')

NUM = r'\d+(?:[.,]\d+)?'
TRIP = re.compile(rf'({NUM})/({NUM})/({NUM})(?!/)')
TOK = re.compile(r'(?<![A-Za-z0-9])(?:MK[A-Z0-9][A-Z0-9\-()]*|V?\d{3,4}[A-Z0-9\-]*-C[LR]|V\d{3,4}F?A)(?![A-Za-z0-9])')
f = lambda s: float(s.replace(',', '.'))
out = {}

# 1) Детальные таблицы ТТХ: модели в шапке, далее 2 строки «Производительность» (холод, тепло)
for pi, p in enumerate(pages, 1):
    lines = p.split('\n')
    perf = [i for i, l in enumerate(lines) if 'Производительность' in l and 'кВт' in l]
    if not perf:
        continue
    k = perf[0]
    head = lines[max(0, k - 7):k]
    prefixes, models = [], []
    for l in head:
        words = l.split()
        if not words:
            continue
        if all(re.fullmatch(r'MK[A-Z0-9]+-', w) for w in words):
            prefixes = words
            continue
        if prefixes and len(words) == len(prefixes):
            models = [a + b for a, b in zip(prefixes, words)]
            continue
        toks = [t for t in re.findall(r'MK[A-Z0-9][A-Z0-9\-()]*', l) if re.search(r'\d', t) and not t.endswith('-')]
        if toks:
            models = toks
    if not models:
        continue
    vals = []
    for i in perf[:2]:
        seg = lines[i].split('кВт', 1)[1]
        vals.append([tuple(map(f, t)) for t in TRIP.findall(seg)])
    cool = vals[0] if vals else []
    heat = vals[1] if len(vals) > 1 else []
    if len(cool) != len(models):
        continue
    extra = {}
    n = len(models)
    LABELS = [('Расход воды', 'waterFlow'), ('Перепад давлений', 'waterDp'), ('Потребляемая мощность', 'powerW'),
              ('Расход воздуха', 'airflow'), ('Уровень звук', 'noise'), ('Габариты', 'dims'), ('Масса', 'weight')]
    for l in lines[k + 1:k + 22]:
        for lab, key in LABELS:
            if lab not in l or key in extra:
                continue
            tail = re.split(r'(?:м3/ч|кПа|Вт|дБ\(А\)|мм|кг)\s', l, maxsplit=1)
            tail = tail[1] if len(tail) > 1 else l
            if key == 'dims':
                vals = re.findall(r'\d+\s*[×x]\s*\d+\s*[×x]\s*\d+', tail)
                vals = [v.replace(' ', '').replace('x', '×') for v in vals]
            else:
                tr = TRIP.findall(tail)
                vals = [f(t[1]) for t in tr] if len(tr) == n else [f(v) for v in re.findall(NUM, tail)]
            if len(vals) == n:
                extra[key] = vals
    # Опции (клапаны, обвязка, поддоны): ячейка ближайшая к колонке модели (объединённые ячейки — на несколько моделей).
    centers = [(mm.start() + mm.end()) / 2 for mm in TRIP.finditer(lines[k].split('кВт', 1)[1])]
    off = lines[k].index('кВт') + 3
    centers = [c + off for c in centers]
    OPT = [('3-ходовой клапан с четырьмя портами', 'valve3x4'), ('Комплект трубной обвязки', 'pipingKit'), ('Дренажный поддон', 'drainTray'),
           ('Подключение сетевого и центрального управления', 'netModule'), ('3-ходовой клапан, без трубной обвязки', 'valve3'),
           ('2-ходовой клапан, без трубной обвязки', 'valve2'), ('Комплект монтажных опор', 'mountKit')]
    opts = {}
    if len(centers) == n:
        for l in lines[k:k + 45]:
            for lab, key in OPT:
                i0 = l.find(lab)
                if i0 < 0 or key in opts:
                    continue
                lab_end = re.search(re.escape(lab) + r'(?: для \S+)?', l).end()
                toks = [(t.start(), t.end(), t.group()) for t in re.finditer(r'\S+', l) if t.start() > lab_end + 1]
                toks = [t for t in toks if re.search(r'[A-ZА-Я0-9]', t[2]) and not re.fullmatch(r'\(?\d+\)?', t[2])]
                if not toks:
                    continue
                opts[key] = [min(toks, key=lambda t: abs((t[0] + t[1]) / 2 - c))[2] for c in centers]
    kit = re.search(r'([A-Z][A-Z0-9/()-]{3,}), в комплекте', p)
    panel = re.search(r'Декоративная панель\s{2,}([A-Z][A-Z0-9/()-]{3,})', p)
    for idx, m in enumerate(models):
        rec = {'page': pi, 'coolMax': cool[idx][0], 'coolMid': cool[idx][1], 'coolMin': cool[idx][2]}
        rec.update({key: v[idx] for key, v in extra.items()})
        if opts:
            rec['options'] = {key: v[idx] for key, v in opts.items()}
        if kit:
            rec['kitRemote'] = kit.group(1)
        if panel:
            rec['panel'] = panel.group(1)
        if len(heat) == len(models):
            rec.update(heatMax=heat[idx][0], heatMid=heat[idx][1], heatMin=heat[idx][2])
        out.setdefault(m, rec)

# 2) Обзорные таблицы модельного ряда (только номинал): заполняют серии без детальной таблицы
for pi, p in enumerate(pages, 1):
    if 'Модельный ряд' not in p:
        continue
    lines = p.split('\n')
    for i, l in enumerate(lines):
        for col in re.finditer(r'(MK[A-Z0-9]*-?(?:V_)?[A-Z0-9_\-()]*)\s*\((?:2|4)-трубный', l):
            series = col.group(1)
            start = col.start()
            def cells(line):
                seg = line[max(0, start - 5):]
                nxt = re.search(r'\s{3,}(?:MK|Модель|Мощность)', seg[20:])
                return seg[: 20 + nxt.start()] if nxt else seg
            mods = caps = None
            for j in range(i + 1, min(i + 6, len(lines))):
                c = cells(lines[j])
                if 'Модель' in c and mods is None:
                    mods = re.findall(r'\b\d{2,4}\b', c.split('Модель', 1)[1])
                elif 'Мощность' in c and mods is not None:
                    caps = [f(x) for x in re.findall(NUM, c.split('кВт', 1)[1])]
                    break
            if not mods or not caps or len(mods) != len(caps):
                continue
            for m, cval in zip(mods, caps):
                if '_' in series:
                    name = series.replace('_', m)
                elif re.search(r'-(F-)?R[34]$', series):
                    base, rest = series.split('-', 1)
                    name = f"{base}-{m}{'F-R4' if rest == 'F-R4' else '-' + rest}"
                else:
                    continue
                out.setdefault(name, {'page': pi, 'coolMax': cval, 'summaryOnly': True})

json.dump(dict(sorted(out.items())), open(root / 'src/data/fcu-capacity.json', 'w'), ensure_ascii=False, indent=1)
print(len(out), 'моделей')
