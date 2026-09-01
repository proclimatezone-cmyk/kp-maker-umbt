/**
 * Водяной знак с инициалами менеджера в таблице позиций КП (новый вид) —
 * едва заметный, чтобы клиент, переславший КП другому менеджеру, мог
 * определить, кто его на самом деле составил. См. обсуждение в чате
 * (мокап согласован: вариант C — 14% непрозрачности, наклон −22°).
 *
 * Транслитерация — временная, черновая: только первая буква имени и
 * фамилии, многобуквенные звуки (Ж/Х/Ц/Ч/Ш/Щ/Ю/Я) сведены к одной латинской
 * букве, чтобы в двухбуквенном знаке не разъезжался паттерн. Владелец
 * обещал прислать реальный список соответствий менеджер → инициалы —
 * когда пришлёт, эту таблицу нужно будет заменить/расширить.
 */
const CYRILLIC_INITIAL_TO_LATIN: Record<string, string> = {
  а: 'A', б: 'B', в: 'V', г: 'G', д: 'D', е: 'E', ё: 'E', ж: 'J', з: 'Z',
  и: 'I', й: 'Y', к: 'K', л: 'L', м: 'M', н: 'N', о: 'O', п: 'P', р: 'R',
  с: 'S', т: 'T', у: 'U', ф: 'F', х: 'H', ц: 'C', ч: 'C', ш: 'S', щ: 'S',
  ъ: '', ы: 'Y', ь: '', э: 'E', ю: 'U', я: 'A',
};

function transliterateFirstLetter(word: string): string {
  const ch = word.trim()[0];
  if (!ch) return '';
  const lower = ch.toLowerCase();
  if (/[a-z]/.test(lower)) return ch.toUpperCase();
  return CYRILLIC_INITIAL_TO_LATIN[lower] ?? '';
}

/** «Мухаммаджон Носиров» → «MN». Null, если ФИО не заполнено. */
export function managerWatermarkInitials(fullName?: string): string | null {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const letters = words.slice(0, 2).map(transliterateFirstLetter).filter(Boolean);
  return letters.length > 0 ? letters.join('') : null;
}

const TWIP_TO_EMU = 635;
/** Ширина таблицы позиций в kp-new.docx — см. tblW в шаблоне. */
const ITEMS_TABLE_WIDTH_TWIPS = 10623;

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * OOXML-разметка плавающей подписи с узором инициалов — по образцу уже
 * существующего в шаблоне текстбокса «№ {cp_number}» (тот же скелет
 * mc:AlternateContent/wps:wsp, см. комментарий в buildKpDocx). Настоящая
 * прозрачность через w14:textFill/w14:alpha — не имитация цветом, отсюда
 * не «плывёт» при смене заливки строки (шапка/чёт/нечет/итого — все разные).
 *
 * Не одна фигура на всю таблицу (первые версии) — при оценке высоты
 * таблицы по количеству позиций ошибка накапливалась и знак либо не
 * доставал до низа, либо нахлёстывал на блок условий. Не одна фигура даже
 * на строку — широкая (во всю таблицу) фигура после поворота на угол θ
 * «утекает» в высоту сильнее, чем даёт сам текст (H' = W·sinθ + H·cosθ,
 * член от ширины доминирует). Три узких фигуры НА КАЖДУЮ строку таблицы
 * (шапка, каждая позиция, итого), каждая — своя треть ширины: и нахлёст
 * от поворота меньше, и рост отдельной строки под перенос длинного
 * названия не разъезжает всю картину целиком.
 */
// Левое поле секции, в которой лежит таблица позиций (см. w:pgMar в первом
// w:sectPr шаблона — это секция co своими header/footer, не «хвостовая»
// секция с подписью). Индента у самой таблицы нет (w:tblInd отсутствует),
// значит её левый край физически совпадает с левым полем страницы —
// от этого и считаем абсолютную горизонтальную позицию водяного знака.
const SECTION_LEFT_MARGIN_TWIPS = 851;

/**
 * Число сегментов, на которые режем ширину таблицы под один водяной знак.
 * Не одна фигура на всю ширину: при повороте на угол θ лишняя высота от
 * поворота растёт линейно с шириной фигуры (H' = W·sinθ + H·cosθ) — широкая
 * низкая фигура (таблица) после поворота «утекает» в высоту сильнее, чем
 * даёт сам текст, и знак нахлёстывает на соседние блоки сверху/снизу.
 * Три узких фигуры на строку вместо одной широкой — тот же член W·sinθ
 * втрое меньше на каждую, значит и нахлёст втрое меньше при той же
 * визуальной плотности узора по всей ширине.
 */
const SEGMENTS_PER_ROW = 3;

/**
 * @param rowHeightTwips номинальная высота ЭТОЙ строки (trHeight из
 *   шаблона) — не обязана совпадать с реальной (растёт под перенос текста),
 *   фигура на неё лишь ориентируется, не обрезается по ней.
 * @param docPrId у каждой плавающей фигуры в документе должен быть свой
 *   уникальный id — иначе Word путает их при перерисовке.
 * @param segmentIndex 0..SEGMENTS_PER_ROW-1 — какую по счёту треть ширины
 *   таблицы покрывает эта фигура (см. SEGMENTS_PER_ROW).
 */
export function buildRowWatermarkXml(
  initials: string,
  rowHeightTwips: number,
  docPrId: number,
  segmentIndex: number
): string {
  const rotDeg = 22;
  const segmentWidthTwips = ITEMS_TABLE_WIDTH_TWIPS / SEGMENTS_PER_ROW;
  const boxWidthTwips = Math.round(segmentWidthTwips * 1.3);
  const boxHeightTwips = Math.round(rowHeightTwips * 1.2);

  // Горизонталь — абсолютно от левого края страницы (relativeFrom="page"):
  // центр бокса совмещаем с центром СВОЕГО сегмента (не всей таблицы).
  // Вертикаль — относительно абзаца в первой ячейке ЭТОЙ строки
  // (relativeFrom="paragraph" валиден только для V, не для H — «column»
  // внутри ячейки таблицы вело себя непредсказуемо, поэтому H — абсолютно).
  const segmentCenterXTwips =
    SECTION_LEFT_MARGIN_TWIPS + segmentWidthTwips * (segmentIndex + 0.5);
  const offsetXTwips = Math.round(segmentCenterXTwips - boxWidthTwips / 2);
  // Точка отсчёта (paragraph) внутри ячейки с vAlign="center" на практике
  // сидит выше физического верха строки — без сдвига знак вылезал над
  // строкой (проверено рендером в Word). Сдвигаем вниз пропорционально
  // запасу бокса над строкой.
  const offsetYTwips = Math.round((boxHeightTwips - rowHeightTwips) * 0.8);

  const widthEmu = boxWidthTwips * TWIP_TO_EMU;
  const heightEmu = boxHeightTwips * TWIP_TO_EMU;
  const offsetXEmu = offsetXTwips * TWIP_TO_EMU;
  const offsetYEmu = offsetYTwips * TWIP_TO_EMU;
  const rot = -rotDeg * 60000; // −22°, в 60000-х долях градуса

  const label = xmlEscape(initials);
  // Сетка строк: одна и та же надпись через равный интервал, вся сетка
  // поворачивается как единое целое вместе с текстбоксом. Повторов меньше,
  // чем в версии «одна фигура на всю таблицу» — сегмент втрое уже.
  const repeatsPerLine = 3;
  const lineText = Array.from({ length: repeatsPerLine }, () => label).join('      ');
  const runProps =
    '<w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:b/>' +
    '<w:sz w:val="34"/><w:szCs w:val="34"/>' +
    '<w14:textFill><w14:solidFill><w14:srgbClr w14:val="123A5E">' +
    '<w14:alpha w14:val="14000"/></w14:srgbClr></w14:solidFill></w14:textFill>';
  // ВАЖНО: bodyPr ниже стоит noAutofit + wrap="none" — значит реальную
  // видимую высоту текста определяет ЧИСЛО СТРОК (linesCount × высота
  // строки), а не boxHeightTwips/wp:extent: контент не сжимается и не
  // обрезается по границам заявленного бокса, просто центрируется в нём
  // (bodyPr anchor="ctr"). Фиксированное число строк давало нормальный
  // результат на таблице из 3 позиций, но на короткой (1 позиция) знак
  // нахлёстывал на блок условий гораздо сильнее — высота контента должна
  // расти вместе с таблицей, а не быть константой. LINE_HEIGHT_TWIPS —
  // высота строки при sz=34/line=360/lineRule=auto (single×1.5 ≈ 20.4pt×1.5),
  // подобрано рендером в Word.
  const LINE_HEIGHT_TWIPS = 612;
  const linesCount = Math.max(3, Math.ceil((boxHeightTwips / LINE_HEIGHT_TWIPS) * 1.05));
  const paragraphs = Array.from({ length: linesCount }, (_, i) => {
    const shifted = i % 2 === 1 ? `   ${lineText}` : lineText;
    return (
      '<w:p><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr>' +
      `<w:r><w:rPr>${runProps}</w:rPr><w:t xml:space="preserve">${xmlEscape(shifted)}</w:t></w:r></w:p>`
    );
  }).join('');

  // Просто <w:drawing> без обёртки mc:AlternateContent/mc:Fallback: та
  // нужна только для обратной совместимости с Word до 2010 и требует
  // легаси-VML дубликата разметки (namespaces v:/w10: не объявлены в этом
  // документе). Фото товаров в этом же шаблоне уже вставляются таким же
  // «голым» <w:drawing> — рабочий, проверенный путь.
  return (
    '<w:r><w:rPr><w:noProof/></w:rPr>' +
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    // behindDoc="0", не "1": заливка ячеек таблицы (DBEFF9/45B0E1) рисуется
    // ПОВЕРХ слоя «за текстом» — с behindDoc="1" знак был не смещён, а
    // попросту закрашен насквозь везде, где на него легла ячейка, и
    // проступал только там, где вокруг таблицы пусто (видно на скрине —
    // фрагменты ровно вне таблицы). При 14% непрозрачности поверх текста
    // это не мешает читать цифры.
    `relativeHeight="${docPrId}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${offsetXEmu}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${offsetYEmu}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    `<wp:docPr id="${docPrId}" name="watermark-manager-${docPrId}"/><wp:cNvGraphicFramePr/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr>' +
    `<a:xfrm rot="${rot}"><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln>' +
    '</wps:spPr><wps:txbx><w:txbxContent>' +
    paragraphs +
    '</w:txbxContent></wps:txbx>' +
    '<wps:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr" anchorCtr="1">' +
    '<a:noAutofit/></wps:bodyPr>' +
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}
