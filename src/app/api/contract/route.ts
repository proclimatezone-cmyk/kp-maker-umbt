import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { buildSpec, splitKits, withInventoryNames, missingInventoryNames, ContractInput } from '@/lib/contract';
import { getStock, indexNamesByArticle } from '@/lib/stock';

export const maxDuration = 10;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function POST(req: NextRequest) {
  try {
    const { contract = {}, items = [], exchangeRate } = await req.json();

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

    // Цены в КП — в у.е. без НДС. В договоре всё в сумах, тоже без НДС:
    // НДС считается отдельной колонкой спецификации.
    const priced: ContractInput[] = items.map((i: any) => ({
      model: i.model,
      quantity: Number(i.quantity) || 0,
      unitPrice: Math.round((Number(i.unitPriceUe) || 0) * rate * 100) / 100,
    }));

    // Комплекты «внутренний + наружный» расписываются двумя строками.
    const split = splitKits(priced);

    // Полные названия берём из инвентаризации; если её нет — не падаем,
    // а оставляем короткие артикулы и говорим об этом в заголовке ответа.
    let names: Record<string, string> = {};
    let stockNote = '';
    try {
      names = indexNamesByArticle(await getStock());
    } catch (err: any) {
      stockNote = 'Инвентаризация недоступна, позиции названы артикулами';
      console.warn('Договор: не удалось прочитать инвентаризацию:', err?.message);
    }

    const named = withInventoryNames(split, names);
    const missing = missingInventoryNames(named);
    const { rows, totals } = buildSpec(named);

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
      contract_date: contract.date || '',
      valid_until: contract.validUntil || '',
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
