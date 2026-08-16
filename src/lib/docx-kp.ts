import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';
import { formatNum } from './format';
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

/**
 * Приводит ссылку на картинку к прямому адресу, который отдаёт сами байты.
 * Ссылки вида `drive.google.com/file/d/<id>/view` возвращают HTML-страницу,
 * а не изображение, поэтому их надо переписать.
 */
export function toDirectImageUrl(url: string): string | null {
  if (!url) return null;
  const id = url.match(/[?&]id=([^&]+)/)?.[1] || url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (id) return `https://lh3.googleusercontent.com/d/${id}`;
  return url.startsWith('http') ? url : null;
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
async function shrink(buffer: Buffer): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default;
    return await sharp(buffer)
      .resize({ width: 420, height: 420, fit: 'inside', withoutEnlargement: true })
      // Прозрачные пиксели PNG в JPEG становятся чёрными — подкладываем белый
      // фон, как в каталоге, иначе фото товара выходит на чёрном.
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}

async function fetchImage(url: string, origin: string): Promise<Buffer | null> {
  try {
    const target = url.startsWith('/') ? `${origin}${url}` : toDirectImageUrl(url);
    if (!target) return null;
    const res = await fetch(target, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;

    // Мёртвая или непубличная ссылка Drive отдаёт HTML-страницу вместо
    // картинки. Раньше эти байты вставлялись как «фото» — отсюда ⚠️ в ячейке.
    // В документ идёт только настоящее изображение.
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return null;

    return await shrink(Buffer.from(await res.arrayBuffer()));
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

  const showImages = opts.options.showImages !== false;
  const images = showImages ? await preloadImages(opts.items, opts.origin) : new Map<string, Buffer>();
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
    items: opts.items.map(item => {
      const price = Math.round(Number(item.price) || 0);
      const qty = Number(String(item.quantity ?? '1').match(/[\d.,]+/)?.[0]?.replace(',', '.')) || 1;
      return {
        image: showImages && !item.isAdditional ? item.slidesImage || item.image || '' : '',
        category: item.category || '',
        model: item.model || '',
        qty: quantityLabel(item.quantity),
        price: formatNum(price),
        sum: formatNum(price * qty),
      };
    }),
    total_label: money.total() + ':',
    total_value: formatNum(opts.total),
    terms: buildTermsRows(opts.options),
  });

  return doc.toBuffer();
}

/** Сводка условий одной строкой — для интерфейса и логов. */
export function describeTerms(options: BuildKpOptions['options']): string {
  return buildTermsLines(options).join('\n');
}
