import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';
import { google } from 'googleapis';
import { formatNum } from './format';
import { getGoogleAuth } from './google-auth';
import { buildTermsLines, getDeliverySpec, getMoneyLabels, getWarrantyLine } from './delivery-terms';

/** Размер картинки товара в ячейке «Внешний вид», в пикселях при 96 dpi. */
const IMAGE_BOX = { width: 150, height: 110 };

/** Прозрачный PNG 1×1 — подставляется, когда картинку достать не удалось. */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

export interface KpItem {
  category?: string;
  series?: string;
  model?: string;
  quantity?: number | string;
  price?: number;
  image?: string;
  slidesImage?: string;
  isAdditional?: boolean;
}

/** Идентификатор файла Google Drive из любой формы ссылки. */
export function driveFileId(url: string): string | null {
  if (!url) return null;
  return (
    url.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1] ||
    url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
    url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
    null
  );
}

/** Похожи ли первые байты на настоящее изображение (а не на HTML-страницу). */
function looksLikeImage(b: Buffer): boolean {
  if (b.length < 12) return false;
  const jpeg = b[0] === 0xff && b[1] === 0xd8;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const gif = b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
  const webp = b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP';
  const bmp = b[0] === 0x42 && b[1] === 0x4d;
  return jpeg || png || gif || webp || bmp;
}

/**
 * Скачивает файл Google Drive авторизованно — тем же аккаунтом, которым
 * приложение читает таблицы. Так берётся любое фото, к которому у аккаунта
 * есть доступ, даже если оно не «публичное по ссылке». Анонимный запрос по
 * lh3/uc в этом случае вернул бы HTML, и фото не вставлялось.
 */
async function fetchFromDrive(fileId: string): Promise<Buffer | null> {
  try {
    const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer', signal: AbortSignal.timeout(12_000) as any }
    );
    const buf = Buffer.from(res.data as ArrayBuffer);
    return looksLikeImage(buf) ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Ужимает фото товара до размера, в котором оно реально видно в ячейке.
 * Без этого каждое фото едет в документ в полном разрешении, и большое КП
 * перерастает лимит Vercel на размер ответа (4.5 МБ) — тогда вместо файла
 * приходит HTML-страница ошибки. Ширины 500px хватает для печати миниатюры.
 */
/**
 * Ужимает фото и подкладывает белый фон. Возвращает null, если sharp не смог
 * обработать байты — тогда фото просто не вставляется, а не попадает в
 * документ мусором.
 */
/**
 * Делает белый фон прозрачным заливкой от краёв. Убирает только тот белый,
 * что связан с краями картинки (фон вокруг блока), не трогая белые части
 * самого товара внутри. Работает по сырым RGBA-пикселям.
 */
function removeWhiteBackground(data: Buffer, width: number, height: number): void {
  const WHITE = 236; // всё, где R,G,B выше — считаем фоном
  const idx = (x: number, y: number) => (y * width + x) * 4;
  const isWhite = (i: number) => data[i] >= WHITE && data[i + 1] >= WHITE && data[i + 2] >= WHITE;

  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = idx(x, y);
    if (data[i + 3] === 0) return; // уже прозрачный — были тут
    if (!isWhite(i)) return;
    data[i + 3] = 0;
    stack.push(x, y);
  };

  // старт от всех пикселей по периметру
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }

  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
}

async function shrink(buffer: Buffer): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default;
    const base = sharp(buffer)
      .resize({ width: 420, height: 420, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha();

    // Сырые пиксели, чтобы убрать белый фон и оставить только сам блок.
    const { data, info } = await base.raw().toBuffer({ resolveWithObject: true });
    removeWhiteBackground(data, info.width, info.height);

    return await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    return null;
  }
}

async function fetchImage(url: string, origin: string): Promise<Buffer | null> {
  try {
    // 1. Google Drive — качаем авторизованно через API.
    const id = driveFileId(url);
    if (id) {
      const buf = await fetchFromDrive(id);
      return buf ? await shrink(buf) : null;
    }

    // 2. Локальный файл или прямой http — обычным запросом.
    const target = url.startsWith('/') ? `${origin}${url}` : url.startsWith('http') ? url : null;
    if (!target) return null;
    const res = await fetch(target, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!looksLikeImage(buf)) return null;
    return await shrink(buf);
  } catch {
    return null;
  }
}

/** Заранее выкачивает все картинки параллельно: рендер docxtemplater синхронный. */
async function preloadImages(items: KpItem[], origin: string): Promise<Map<string, Buffer>> {
  const urls = [...new Set(items.map(i => i.slidesImage || i.image || '').filter(Boolean))];
  const loaded = new Map<string, Buffer>();
  await Promise.all(
    urls.map(async url => {
      const buf = await fetchImage(url, origin);
      if (buf) loaded.set(url, buf);
    })
  );
  return loaded;
}

function quantityLabel(quantity: unknown): string {
  const raw = String(quantity ?? '').trim();
  if (!raw) return '';
  // «3» → «3 шт.», но «работа» или «12 м.п.» оставляем как ввели.
  return /^\d+([.,]\d+)?$/.test(raw) ? `${raw} шт.` : raw;
}

/**
 * Схлопывает строки одинакового оборудования (та же модель, цена и
 * картинка) в одну — с суммарным количеством. Менеджер добавляет позицию
 * по кнопке «+» на каждую единицу, и без этого один и тот же MIH28Q4HN18
 * печатался бы двумя одинаковыми строками вместо одной с «2 шт.».
 * Доп. работы (isAdditional) и позиции с нечисловым количеством
 * («работа», «12 м.п.») не трогаем — там количество не складывается.
 */
function mergeIdenticalItems(items: KpItem[]): KpItem[] {
  const merged: KpItem[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    const rawQty = String(item.quantity ?? '').trim();
    const isPlainNumber = /^\d+([.,]\d+)?$/.test(rawQty);
    if (item.isAdditional || !isPlainNumber) {
      merged.push(item);
      continue;
    }

    const key = [item.category, item.model, item.price, item.image, item.slidesImage].join('|');
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push({ ...item });
    } else {
      const existing = merged[existingIndex];
      const existingQty = Number(String(existing.quantity).replace(',', '.')) || 0;
      existing.quantity = existingQty + Number(rawQty.replace(',', '.'));
    }
  }

  return merged;
}

export interface BuildKpOptions {
  cpNumber: string;
  cpDate: string;
  items: KpItem[];
  total: number;
  options: {
    deliveryTerms?: string;
    warrantyMonths?: number;
    currency?: string;
    paymentType?: string;
    showImages?: boolean;
  };
  origin: string;
  templatePath?: string;
}

/** Строки блока условий: подпись слева, значение справа. */
export function buildTermsRows(opts: BuildKpOptions['options']): { label: string; value: string }[] {
  const spec = getDeliverySpec(opts.deliveryTerms);
  const rows = [
    { label: 'Условия поставки', value: spec.delivery },
    { label: 'Срок поставки', value: spec.leadTime },
    { label: 'Условия оплаты', value: '100% предоплата' },
    { label: 'Гарантия', value: getWarrantyLine(opts.warrantyMonths) },
    { label: 'Срок действия КП', value: '1 неделя с момента подачи' },
  ];
  if (spec.nationalCurrencyClause) {
    rows.push({
      label: 'Валюта расчётов',
      value:
        'Цены указаны в у.е. (доллар США). Оплата производится в национальной валюте ' +
        'по актуальному курсу на момент оплаты',
    });
  }
  return rows;
}

export async function buildKpDocx(opts: BuildKpOptions): Promise<Buffer> {
  const templatePath =
    opts.templatePath || path.join(process.cwd(), 'templates', 'kp-new.docx');

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Шаблон не найден: ${templatePath}`);
  }

  const items = mergeIdenticalItems(opts.items);
  const showImages = opts.options.showImages !== false;
  const images = showImages ? await preloadImages(items, opts.origin) : new Map<string, Buffer>();
  const money = getMoneyLabels(opts.options);

  const imageModule = new ImageModule({
    centered: true,
    getImage: (tagValue: string) => images.get(tagValue) || BLANK_PNG,
    getSize: (_img: Buffer, tagValue: string) =>
      images.has(tagValue) ? [IMAGE_BOX.width, IMAGE_BOX.height] : [1, 1],
  });

  const doc = new Docxtemplater(new PizZip(fs.readFileSync(templatePath)), {
    modules: [imageModule],
    paragraphLoop: true,
    linebreaks: true,
  });

  doc.render({
    cp_number: opts.cpNumber,
    cp_date: opts.cpDate,
    items: items.map(item => {
      const price = Math.round(Number(item.price) || 0);
      const qty = Number(String(item.quantity ?? '1').match(/[\d.,]+/)?.[0]?.replace(',', '.')) || 1;
      return {
        image: showImages && !item.isAdditional ? item.slidesImage || item.image || '' : '',
        // Доп. работы менеджер называет сам («Монтаж», «Воздуховоды») —
        // приписку «Дополнительные работы и материалы» не дублируем, а
        // само название кладём в «Наименование», а не в «Модель»: в
        // kp-old.docx это разные колонки, и строка вроде «Монтаж» —
        // не модель оборудования. В kp-new.docx (где обе колонки объединены
        // в одну «{category}\n{model}») визуально ничего не меняется.
        category: item.isAdditional ? (item.model || '') : (item.category || ''),
        model: item.isAdditional ? '' : (item.model || ''),
        qty: quantityLabel(item.quantity),
        price: formatNum(price),
        sum: formatNum(price * qty),
      };
    }),
    total_label: money.total() + ':',
    total_value: formatNum(opts.total),
    terms: buildTermsRows(opts.options),
    // Ниже — теги только для «старого вида» (templates/kp-old.docx). В
    // kp-new.docx таких тегов в разметке нет, docxtemplater лишние ключи
    // в данных просто игнорирует — на новый вид это никак не влияет.
    price_label: money.price,
    sum_label: money.sum,
    termLines: buildTermsLines(opts.options),
  });

  // У доп. работ фото нет — объединяем их ячейку «Внешний вид» с
  // «Наименованием», чтобы название шло во всю ширину. Это последние строки
  // таблицы (доп. работы идут после оборудования), перед строкой «Итого».
  const additionalCount = items.filter(i => i.isAdditional).length;
  if (additionalCount > 0) {
    const zip = doc.getZip();
    const xml = zip.file('word/document.xml')!.asText();
    zip.file('word/document.xml', mergeAdditionalRows(xml, additionalCount));
    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  return doc.toBuffer();
}

/** Сливает первые две ячейки строки: удаляет первую, второй даёт gridSpan=2. */
function mergeFirstTwoCells(row: string): string {
  const cells = row.match(/<w:tc>[\s\S]*?<\/w:tc>/g);
  if (!cells || cells.length < 2) return row;

  let second = cells[1];
  if (/<w:tcPr>/.test(second)) {
    // gridSpan по схеме идёт после tcW.
    second = /<\/w:tcW>/.test(second)
      ? second.replace('</w:tcW>', '</w:tcW><w:gridSpan w:val="2"/>')
      : second.replace('<w:tcPr>', '<w:tcPr><w:gridSpan w:val="2"/>');
  } else {
    second = second.replace('<w:tc>', '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>');
  }

  return row.replace(cells[0], '').replace(cells[1], second);
}

/**
 * Объединяет ячейку фото с наименованием у последних `count` строк данных
 * (строки доп. работ), не трогая шапку и строку «Итого».
 */
function mergeAdditionalRows(xml: string, count: number): string {
  const tbl = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/);
  if (!tbl) return xml;

  const rows = tbl[0].match(/<w:tr\b[\s\S]*?<\/w:tr>/g);
  if (!rows) return xml;

  // Последняя строка — «Итого», перед ней идут строки доп. работ.
  const targets = new Set<number>();
  for (let k = 1; k <= count; k++) targets.add(rows.length - 1 - k);

  const newRows = rows.map((r, i) => (targets.has(i) ? mergeFirstTwoCells(r) : r));
  const newTbl = tbl[0].replace(rows.join(''), newRows.join(''));
  return xml.replace(tbl[0], newTbl);
}

/** Сводка условий одной строкой — для интерфейса и логов. */
export function describeTerms(options: BuildKpOptions['options']): string {
  return buildTermsLines(options).join('\n');
}
