import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { buildSpec, splitKits, withInventoryNames, missingInventoryNames, ContractInput } from '@/lib/contract';
import { getStock, indexNamesByArticle } from '@/lib/stock';
import { stockKey } from '@/lib/stock-match';
import { formatRuDate } from '@/lib/format';
import invoiceNamesRaw from '@/data/invoice-names.json';


const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function POST(req: NextRequest) {
  try {
    const { contract = {}, items = [], exchangeRate, priceIncludesVat = false } = await req.json();

    const rate = Number(exchangeRate);
    if (!rate || rate <= 0) {
      return NextResponse.json(
        { error: 'Укажите курс у.е. — договор считается в сумах' },
        { status: 400 }
      );
    }

    if (!items.length) {
      return NextResponse.json({ error: 'В договоре нет ни одной позиции' }, { status: 400 });
    }

    // Цены в КП — в у.е.; при оплате переводом это уже цена «с НДС»
    // (priceIncludesVat, см. buildSpec) — тогда НДС из неё выделяется, а
    // не начисляется заново поверх. В договоре всё в сумах.
    const priced: ContractInput[] = items.map((i: any) => ({
      model: i.model,
      quantity: Number(i.quantity) || 0,
      unitPrice: Math.round((Number(i.unitPriceUe) || 0) * rate * 100) / 100,
    }));

    // Комплекты «внутренний + наружный» расписываются двумя строками.
    const split = splitKits(priced);

    // Полные названия — приоритет за формулировками из реальных таможенных
    // инвойсов (invoice-finder.vercel.app, см. src/scripts/scrape-invoice-names.mjs):
    // склад даёт короткие/неточные названия («VRF серии V8 Easy Fit наружний
    // блок»), инвойс — официальную таможенную формулировку («Наружный блок
    // промышленной мультизональной VRF системы MV8-...»). Склад — только
    // фоллбэк для того, чего в инвойсах ещё не было (новые позиции «под
    // заказ», которые физически ещё не завозили).
    let names: Record<string, string> = {};
    let stockNote = '';
    try {
      names = indexNamesByArticle(await getStock());
    } catch (err: any) {
      stockNote = 'Инвентаризация недоступна, позиции названы артикулами';
      console.warn('Договор: не удалось прочитать инвентаризацию:', err?.message);
    }
    for (const [model, name] of Object.entries(invoiceNamesRaw as Record<string, string | null>)) {
      if (name) names[stockKey(model)] = name;
    }

    const named = withInventoryNames(split, names);
    const missing = missingInventoryNames(named);
    const { rows, totals } = buildSpec(named, { priceIncludesVat: !!priceIncludesVat });

    const templatePath = path.join(process.cwd(), 'templates', 'contract.docx');
    if (!fs.existsSync(templatePath)) {
      throw new Error('Шаблон договора не найден');
    }

    const doc = new Docxtemplater(new PizZip(fs.readFileSync(templatePath)), {
      paragraphLoop: true,
      linebreaks: true,
    });

    doc.render({
      contract_number: contract.number || '',
      contract_date: formatRuDate(contract.date),
      valid_until: formatRuDate(contract.validUntil),
      spec_number: contract.specNumber || '1',
      buyer_name: contract.buyerName || '',
      buyer_director: contract.buyerDirector || '',
      buyer_address: contract.buyerAddress || '',
      buyer_inn: contract.buyerInn || '',
      buyer_account: contract.buyerAccount || '',
      buyer_mfo: contract.buyerMfo || '',
      buyer_bank: contract.buyerBank || '',
      total_in_words: totals.grossInWords,
      vat_amount: totals.vat,
      rows,
      total_net: totals.net,
      total_vat: totals.vat,
      total_gross: totals.gross,
    });

    const name = `Договор ${contract.number || ''}`.trim();
    const warning = [stockNote, missing.length ? `Без названия из инвентаризации: ${missing.join(', ')}` : '']
      .filter(Boolean)
      .join('. ');

    return new NextResponse(new Uint8Array(doc.toBuffer()), {
      headers: {
        'Content-Type': DOCX_MIME,
        'Content-Disposition': `attachment; filename="contract.docx"; filename*=UTF-8''${encodeURIComponent(name + '.docx')}`,
        // Заголовки принимают только latin1, а названия моделей и текст — нет.
        'X-Contract-Warning': encodeURIComponent(warning),
      },
    });
  } catch (err: any) {
    console.error('Ошибка генерации договора:', err);
    return NextResponse.json({ error: err.message, success: false }, { status: 500 });
  }
}
