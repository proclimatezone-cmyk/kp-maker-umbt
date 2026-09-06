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

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // pdf-parse 2.x — класс поверх pdfjs-dist, не функция как в 1.x.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
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

  // Номер КП в собственном шаблоне на обложке идёт слитно со словом "Дата:"
  // следом (соседние текстовые поля без пробела в исходной разметке) —
  // отрезаем именно по этому известному слову, не по кириллице вообще
  // (сам номер КП вполне может её содержать).
  const numberMatch = text.match(/№\s*(\S+?)(?=Дата|\s|$)/);
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

      // Количество — число сразу после модели (в пределах ~40 символов),
      // за которым (не обязательно вплотную) идёт «шт» — так выглядит и в
      // собственном шаблоне, и в большинстве ручных таблиц.
      const windowText = flatText.slice(end, end + 60);
      const qtyMatch = windowText.match(/(\d+(?:[.,]\d+)?)\s*шт/);
      const qty = qtyMatch ? parseFloat(qtyMatch[1].replace(',', '.')) : null;

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
