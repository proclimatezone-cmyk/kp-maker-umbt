import PizZip from 'pizzip';

/**
 * Импорт готового КП (.docx/.pdf) обратно в подбор — включая файлы,
 * отредактированные вручную (не только те, что сгенерировала сама эта
 * система). Полной гарантии тут нет: если менеджер переставил столбцы,
 * стёр шапку или вписал что-то от руки, часть позиций может не найтись.
 *
 * Подход — не парсинг таблицы по структуре (та ломается от любой ручной
 * правки), а поиск по ТЕКСТУ: модель товара ищется как подстрока в полном
 * тексте документа, количество — ближайшее число со словом «шт» рядом.
 * Работает независимо от того, как именно расположены столбцы.
 */

export interface ImportedItem {
  productId: string;
  model: string;
  quantity: number;
}

export interface ImportResult {
  cpNumber: string;
  cpDate: string;
  client: string;
  items: ImportedItem[];
  /** Сколько строк распознано увереннно (нашлась и модель, и количество рядом). */
  confidentCount: number;
  /** Модели, которые нашлись в тексте, но количество рядом определить не удалось — qty=1 по умолчанию. */
  uncertainCount: number;
}

/** Текст всех <w:t> из word/document.xml — без разбора структуры, просто плоской строкой по абзацам. */
export function extractTextFromDocx(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('Это не .docx (нет word/document.xml внутри)');
  const xml = doc.asText();
  // Абзацы разделяем переносом строки — иначе модель из одной ячейки и
  // число из соседней склеятся без пробела и разъедутся при поиске.
  const paragraphs = xml.split(/<\/w:p>/).map((p: string) => {
    const texts = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]);
    return texts.join('');
  });
  return paragraphs.filter(Boolean).join('\n');
}

function ensureDomMatrixPolyfill() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    try {
      // First try @napi-rs/canvas if available
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const canvas = require('@napi-rs/canvas');
      if (canvas?.DOMMatrix) {
        (globalThis as any).DOMMatrix = canvas.DOMMatrix;
        return;
      }
    } catch {}

    // Minimal 2D/3D DOMMatrix shim for coordinate transforms during PDF text extraction
    (globalThis as any).DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      m11 = 1; m12 = 0; m13 = 0; m14 = 0;
      m21 = 0; m22 = 1; m23 = 0; m24 = 0;
      m31 = 0; m32 = 0; m33 = 1; m34 = 0;
      m41 = 0; m42 = 0; m43 = 0; m44 = 1;
      is2D = true;
      isIdentity = true;
      constructor(init?: any) {
        if (Array.isArray(init)) {
          if (init.length === 6) {
            this.a = this.m11 = init[0];
            this.b = this.m12 = init[1];
            this.c = this.m21 = init[2];
            this.d = this.m22 = init[3];
            this.e = this.m41 = init[4];
            this.f = this.m42 = init[5];
          } else if (init.length === 16) {
            this.m11 = this.a = init[0]; this.m12 = this.b = init[1];
            this.m21 = this.c = init[4]; this.m22 = this.d = init[5];
            this.m41 = this.e = init[12]; this.m42 = this.f = init[13];
          }
        }
      }
      multiply() { return new (globalThis as any).DOMMatrix(); }
      multiplySelf() { return this; }
      preMultiplySelf() { return this; }
      translate() { return this; }
      scale() { return this; }
      invertSelf() { return this; }
      inverse() { return new (globalThis as any).DOMMatrix(); }
    };
  }
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  ensureDomMatrixPolyfill();

  try {
    const { extractText } = await import('unpdf');
    const result = await extractText(new Uint8Array(buffer));
    if (!result || !result.text) return '';
    const text = Array.isArray(result.text) ? result.text.join('\n') : String(result.text);
    return text || '';
  } catch (err: any) {
    throw new Error(`Не удалось прочитать PDF: ${err.message}`);
  }
}

function normalizeForSearch(s: string): string {
  // Перенос строки убираем совсем (не заменяем пробелом) — в PDF узкая
  // ячейка таблицы переносит модель ПРЯМО ПОСЕРЕДИНЕ («Midea-\nV60WDHN1»),
  // и если вставить туда пробел, строка перестаёт совпадать с моделью из
  // каталога. Обычный пробел (не перенос) оставляем как есть — иначе
  // склеятся разные ячейки, стоящие рядом без переноса.
  return s.toLowerCase().replace(/[\n\r\t]+/g, '').replace(/ {2,}/g, ' ');
}

export function parseKpFromText(
  text: string,
  products: { id: string; model: string }[]
): ImportResult {
  const flatText = normalizeForSearch(text);

  // Номер КП: несколько форматов из разных шаблонов:
  //   «№ КП-240826/01MN»       → с символом №
  //   «Коммерческое предложение 010726-01MN»  → старый шаблон без №
  //   «КП-240826/01MNДата:»    → слитно с "Дата:" (без пробела в XML)
  const numberMatch =
    text.match(/№\s*(\S+?)(?=Дата|\s|$)/) ||
    text.match(/[Кк]оммерческое\s+предложение\s+(\S+?)(?=Дата|\s|$)/i);
  const dateMatch = text.match(/(\d{2}\.\d{2}\.\d{4})/);

  const items: ImportedItem[] = [];
  let confidentCount = 0;
  let uncertainCount = 0;

  // Модели длиннее — реже дают ложные совпадения; сортируем от длинных к
  // коротким и не даём одному и тому же куску текста засчитаться дважды
  // за разные модели (одна короче другой строкой входит в неё же).
  const sorted = [...products]
    .filter(p => p.model && p.model.trim().length >= 4)
    .sort((a, b) => b.model.length - a.model.length);

  const claimedRanges: [number, number][] = [];
  const overlaps = (start: number, end: number) =>
    claimedRanges.some(([s, e]) => start < e && end > s);

  for (const p of sorted) {
    const needle = normalizeForSearch(p.model);
    let searchFrom = 0;
    while (true) {
      const idx = flatText.indexOf(needle, searchFrom);
      if (idx === -1) break;
      const end = idx + needle.length;
      searchFrom = end;
      if (overlaps(idx, end)) continue;
      claimedRanges.push([idx, end]);

      // Количество — ищем в окне ~60 символов после модели:
      //   1) число + «шт» (собственный шаблон и ручные таблицы)
      //   2) просто голое целое число (1-999) — для старых шаблонов, где
      //      количество стоит в отдельной ячейке/колонке без «шт».
      const windowText = flatText.slice(end, end + 60);
      const qtyWithUnit = windowText.match(/(\d+(?:[.,]\d+)?)\s*шт/);
      let qty: number | null = null;
      if (qtyWithUnit) {
        qty = parseFloat(qtyWithUnit[1].replace(',', '.'));
      } else {
        // Берём первое число от 1 до 999 — более крупные числа
        // скорее всего цены, а не количества.
        const bareNum = windowText.match(/(?:^|\s)(\d{1,3})(?=\s|$)/);
        if (bareNum) qty = parseInt(bareNum[1], 10);
      }

      items.push({ productId: p.id, model: p.model, quantity: qty ?? 1 });
      if (qty !== null) confidentCount++; else uncertainCount++;
    }
  }

  return {
    cpNumber: numberMatch ? numberMatch[1] : '',
    cpDate: dateMatch ? dateMatch[1] : '',
    client: '',
    items,
    confidentCount,
    uncertainCount,
  };
}
