"""Точные ТТХ источников холода/тепла из каталогов через Claude API.
Каждая страница каталога с нужными моделями -> structured output (только то, что напечатано).
Результат: src/data/gen-specs.json (затем node src/scripts/apply-gen-specs.mjs).
Запуск: python3 scripts/llm-extract-gen-specs.py [--dry]
"""
import json, os, re, subprocess, sys, pathlib
from concurrent.futures import ThreadPoolExecutor
import anthropic

root = pathlib.Path(__file__).resolve().parent.parent
cdir = os.environ.get('CATALOGS_DIR', '/Users/muhammadjonaka/MN OG MAC v/каталоги')
sources = json.load(open(root / 'src/data/catalog-sources.json'))
DOCS = {  # ключ источника -> файл
    'chiller-2026': sources['chiller-2026']['filename'], 'vrf-2026': sources['vrf-2026']['filename'],
    'atom-2026': sources['atom-2026']['filename'], 'atom-b-2026': sources['atom-b-2026']['filename'],
    'vrf-uz-2026': '!_UZ_Katalog VRF 2026 (1).pdf', 'easyfit': 'EASYFIT manual.pdf', 'mha-moub': '96 mha moub.pdf',
}
FIELDS = {
    'coolKw': 'холодопроизводительность, кВт', 'heatKw': 'теплопроизводительность, кВт',
    'coolPower': 'потребляемая мощность в охлаждении, кВт', 'heatPower': 'потребляемая мощность в нагреве, кВт',
    'eer': 'EER', 'cop': 'COP', 'powerSupply': 'электропитание (В/Гц/Ф)', 'maxCurrent': 'максимальный ток, А',
    'compressor': 'тип компрессора', 'refrigerant': 'хладагент', 'refrigerantCharge': 'заводская заправка, кг',
    'waterFlow': 'номинальный расход воды, м³/ч', 'waterDp': 'гидравлическое сопротивление/потери давления воды, кПа',
    'pipe': 'присоединение воды (DN/дюйм)', 'pipeLiquid': 'жидкостная труба, мм', 'pipeGas': 'газовая труба, мм',
    'airflow': 'расход воздуха, м³/ч', 'noise': 'уровень звукового давления, дБ(А)',
    'tempCool': 'диапазон наружных температур в охлаждении, °C', 'tempHeat': 'диапазон наружных температур в нагреве, °C',
    'dims': 'габариты нетто Ш×В×Г, мм', 'weight': 'масса нетто, кг', 'maxIndoor': 'макс. число внутренних блоков',
}
norm = lambda s: re.sub(r'[\s()\-/]', '', s.upper())
products = json.load(open(root / 'src/data/products.json'))
GEN = re.compile('чиллер|тепловой насос|наруж|внеш', re.I)
targets = [p['model'] for p in products if GEN.search(p.get('category', '')) and not re.match(r'KJR|WFS|GW-', p['model'])]
targets = sorted(set(targets))

def tail(m):
    parts = re.split(r'[-/]', re.sub(r'\(.*?\)', '', m))
    t = norm(parts[-1])
    return t if len(t) >= 5 else norm(''.join(parts[-2:]))

jobs = []
for key, fn in DOCS.items():
    path = os.path.join(cdir, fn)
    if not os.path.exists(path):
        continue
    text = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout
    for pi, page in enumerate(text.split('\f'), 1):
        if not re.search(r'кВт|kW', page):
            continue
        pn = norm(page)
        cands = [m for m in targets if norm(re.sub(r'\(.*?\)', '', m)) in pn or (tail(m) in pn and len(tail(m)) >= 6)]
        if cands:
            jobs.append((key, pi, page, cands))
print(len(jobs), 'страниц,', len({m for *_, c in jobs for m in c}), 'моделей из', len(targets))
if '--dry' in sys.argv:
    sys.exit()

SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['models'],
    'properties': {'models': {'type': 'array', 'items': {
        'type': 'object', 'additionalProperties': False,
        'required': ['model', 'onPage'] + list(FIELDS),
        'properties': {'model': {'type': 'string'}, 'onPage': {'type': 'boolean'},
                       **{k: {'type': ['string', 'null']} for k in FIELDS}},
    }}},
}
client = anthropic.Anthropic()

def run(job):
    key, pi, page, cands = job
    prompt = (
        'Ниже текст страницы технического каталога Midea (извлечён pdftotext -layout, колонки выровнены пробелами; '
        'имена моделей в шапке таблицы могут быть разбиты на 2–3 строки, объединённые ячейки стоят по центру нескольких колонок).\n'
        f'Для каждой модели из списка: {", ".join(cands)}\n'
        'найди её колонку в таблице технических характеристик на ЭТОЙ странице и выпиши значения ровно как напечатаны '
        '(числа с точкой, без единиц, кроме текстовых полей). Если модели нет на странице или нет таблицы ТТХ — onPage=false и все поля null. '
        'Если параметра нет — null. Ничего не вычисляй и не додумывай; значение объединённой ячейки относится ко всем колонкам, которые она накрывает. '
        'Поля:\n' + '\n'.join(f'- {k}: {v}' for k, v in FIELDS.items()) + '\n\nСТРАНИЦА:\n' + page
    )
    try:
        r = client.beta.messages.create(
            model='claude-opus-5-5', max_tokens=16000, betas=['server-side-fallback-2026-07-01'], fallbacks='default',
            output_config={'effort': 'high', 'format': {'type': 'json_schema', 'schema': SCHEMA}},
            messages=[{'role': 'user', 'content': prompt}],
        )
        if r.stop_reason != 'end_turn':
            return key, pi, [], r.stop_reason
        txt = next(b.text for b in r.content if b.type == 'text')
        return key, pi, json.loads(txt)['models'], None
    except Exception as e:
        return key, pi, [], repr(e)[:200]

out, errors = {}, []
with ThreadPoolExecutor(6) as ex:
    for key, pi, models, err in ex.map(run, jobs):
        if err:
            errors.append((key, pi, err)); continue
        for m in models:
            if not m.get('onPage'):
                continue
            rec = out.setdefault(norm(m['model']), {'model': m['model'], 'catalogKey': key, 'page': pi})
            for k in FIELDS:
                v = m.get(k)
                if v not in (None, '', '-', '—') and k not in rec:
                    rec[k] = str(v).strip()
json.dump(dict(sorted(out.items())), open(root / 'src/data/gen-specs.json', 'w'), ensure_ascii=False, indent=1)
print(len(out), 'моделей извлечено; ошибок:', len(errors), errors[:5])
