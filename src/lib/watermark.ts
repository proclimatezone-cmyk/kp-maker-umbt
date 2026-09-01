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
const HEADER_ROW_HEIGHT_TWIPS = 1794;
const ITEM_ROW_HEIGHT_TWIPS = 907;
const TOTAL_ROW_HEIGHT_TWIPS = 907;

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
 * Не WordArt-изображение и не заливка ячеек (последняя в docx поддерживает
 * только сплошной цвет или готовую геометрическую штриховку, но не
 * произвольный текст) — единая повёрнутая надпись позади таблицы,
 * тот же приём, что и у встроенного в Word инструмента «Подложка».
 */
// Левое поле секции, в которой лежит таблица позиций (см. w:pgMar в первом
// w:sectPr шаблона — это секция co своими header/footer, не «хвостовая»
// секция с подписью). Индента у самой таблицы нет (w:tblInd отсутствует),
// значит её левый край физически совпадает с левым полем страницы —
// от этого и считаем абсолютную горизонтальную позицию водяного знака.
const SECTION_LEFT_MARGIN_TWIPS = 851;

export function buildWatermarkDrawingXml(initials: string, itemCount: number): string {
  const tableHeightTwips =
    HEADER_ROW_HEIGHT_TWIPS + itemCount * ITEM_ROW_HEIGHT_TWIPS + TOTAL_ROW_HEIGHT_TWIPS;

  // Бокс крупнее самой таблицы — после поворота на −22° угол таблицы
  // не должен остаться непокрытым узором. Считаем не «на глаз» (первая
  // версия так и не легла на стол — column-относительное позиционирование
  // внутри ячейки таблицы вело себя непредсказуемо), а по формуле
  // минимального прямоугольника, который после поворота на угол θ
  // покрывает исходный W×H:
  //   W' = W·cosθ + H·sinθ,  H' = W·sinθ + H·cosθ
  const rotDeg = 22;
  const rad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const boxWidthTwips = Math.round(ITEMS_TABLE_WIDTH_TWIPS * cos + tableHeightTwips * sin);
  const boxHeightTwips = Math.round(ITEMS_TABLE_WIDTH_TWIPS * sin + tableHeightTwips * cos);

  // Горизонталь — абсолютно от левого края страницы (relativeFrom="page"):
  // центр бокса совмещаем с центром таблицы. Вертикаль — по-прежнему
  // относительно абзаца в шапке таблицы (relativeFrom="paragraph" валиден
  // только для V, не для H — в этом и была ошибка версии 1, «column»
  // относительно ячейки таблицы вело себя не так, как рассчитывалось).
  const tableCenterXTwips = SECTION_LEFT_MARGIN_TWIPS + ITEMS_TABLE_WIDTH_TWIPS / 2;
  const offsetXTwips = Math.round(tableCenterXTwips - boxWidthTwips / 2);
  const offsetYTwips = -Math.round((boxHeightTwips - tableHeightTwips) / 2);

  const widthEmu = boxWidthTwips * TWIP_TO_EMU;
  const heightEmu = boxHeightTwips * TWIP_TO_EMU;
  const offsetXEmu = offsetXTwips * TWIP_TO_EMU;
  const offsetYEmu = offsetYTwips * TWIP_TO_EMU;
  const rot = -rotDeg * 60000; // −22°, в 60000-х долях градуса

  const label = xmlEscape(initials);
  // Сетка строк: одна и та же надпись через равный интервал, вся сетка
  // поворачивается как единое целое вместе с текстбоксом.
  const lineText = `${label}      ${label}      ${label}      ${label}`;
  const runProps =
    '<w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:b/>' +
    '<w:sz w:val="34"/><w:szCs w:val="34"/>' +
    '<w14:textFill><w14:solidFill><w14:srgbClr w14:val="123A5E">' +
    '<w14:alpha w14:val="14000"/></w14:srgbClr></w14:solidFill></w14:textFill>';
  const linesCount = 10;
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
    'relativeHeight="2" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${offsetXEmu}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${offsetYEmu}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="777001" name="watermark-manager"/><wp:cNvGraphicFramePr/>' +
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
