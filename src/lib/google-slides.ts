import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';

const TEMPLATE_ID = '1o0UwoDw31SoDXq2vUtvr5QKf2SLlcFm9D6CwmX-wyc4';
const TARGET_FOLDER_ID = '12akf-jI3SDHuHqxeDYlCfGPAxjHn5QgW';
const AUDIT_SHEET_ID = '1y8MKzptCnTUnBymmuB-KLzPM1ZnYX6PM7jjxz8J9YM4';

export function parseQuantity(qtyStr: string | number): number {
  if (typeof qtyStr === 'number') return qtyStr;
  if (!qtyStr) return 1;
  const match = qtyStr.match(/[\d.,]+/);
  if (!match) return 1;
  const num = parseFloat(match[0].replace(',', '.'));
  return isNaN(num) ? 1 : num;
}

// Style Constants
const TABLE_STYLE = {
    fontFamily: 'Calibri',
    italic: true,
    fontSize: { magnitude: 10, unit: 'PT' }
};

// Layout Constants
const PRODUCT_ROW_H_FIRST = 600000;
const PRODUCT_ROW_H_SUBSEQUENT = 300000;
const ACCESSORY_ROW_H = 280000;
const ADDITIONAL_ROW_H = 280000;
const HEADER_FOOTER_H = 380000;
const ROW_OVERHEAD = 10000;
const TABLE_WIDTH = 6800000;
const TABLE_X = 380000;
const TABLE_START_Y = 2650000;
const MAX_HEIGHT_WITH_TERMS = 4150000;
const MAX_HEIGHT_WITHOUT_TERMS = 7000000;

const COLORS = {
    HEADER_BG: { red: 122/255, green: 147/255, blue: 172/255 },
    ROW_BG:    { red: 1, green: 1, blue: 1 },
    TOTAL_L:   { red: 198/255, green: 218/255, blue: 235/255 },
    TOTAL_R:   { red: 162/255, green: 187/255, blue: 212/255 },
    BORDER:    { red: 0, green: 0, blue: 0 },
};

const COL_WIDTHS_WITH_IMG = [1500000, 1100000, 1700000, 450000, 1025000, 1025000];
const COL_WIDTHS_NO_IMG = [2200000, 2250000, 550000, 900000, 900000];

interface GroupedItem {
  category: string;
  series: string;
  image: string;
  models: { model: string; quantity: number; price: number; isAdditional?: boolean; }[];
}

function getDriveFileId(url: string): string | null {
  if (!url) return null;
  const idMatch = url.match(/[?&]id=([^&]+)/);
  if (idMatch) return idMatch[1];
  const dMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch) return dMatch[1];
  return null;
}

function getGoogleAuth() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: [
        'https://www.googleapis.com/auth/presentations',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets'
      ]
    });
  }
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2Client;
}

async function uploadToDrive(imageUrl: string, fileName: string): Promise<string | null> {
  try {
    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    const driveFileId = getDriveFileId(imageUrl);
    if (driveFileId) {
      try {
        console.log(`Copying Google Drive file ${driveFileId} directly...`);
        const copy = await drive.files.copy({
          fileId: driveFileId,
          requestBody: { name: fileName }
        });
        const fileId = copy.data.id!;
        await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
        return `https://drive.google.com/uc?id=${fileId}`;
      } catch (copyErr) {
        console.warn(`Direct copy failed for file ${driveFileId}, falling back to fetch...`, copyErr);
      }
    }

    console.log(`Fetching remote image ${imageUrl}...`);
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    
    const upload = await drive.files.create({
      requestBody: { name: fileName, mimeType: 'image/png' },
      media: { body: Readable.from(buffer) },
      fields: 'id'
    });
    
    const fileId = upload.data.id!;
    await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
    return `https://drive.google.com/uc?id=${fileId}`;
  } catch (e) {
    console.error('Upload to Drive failed for:', imageUrl, e);
    return null;
  }
}

function isAccessory(g: GroupedItem) {
  const c = g.category.toLowerCase();
  return c.includes('аксессуар') || c.includes('автоматика') || c.includes('пульт') || c.includes('панель') || c.includes('опция');
}

function estimateTextLines(text: string, charsPerLine: number): number {
  if (!text) return 1;
  const paragraphs = text.split('\n');
  let totalLines = 0;
  paragraphs.forEach(p => {
    const words = p.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      totalLines += 1;
      return;
    }
    let currentLineLength = 0;
    let linesInParagraph = 1;
    words.forEach(word => {
      if (word.length > charsPerLine) {
        if (currentLineLength > 0) {
          linesInParagraph++;
          currentLineLength = 0;
        }
        const wordLines = Math.ceil(word.length / charsPerLine);
        linesInParagraph += wordLines - 1;
        currentLineLength = word.length % charsPerLine;
      } else {
        if (currentLineLength === 0) {
          currentLineLength = word.length;
        } else if (currentLineLength + 1 + word.length <= charsPerLine) {
          currentLineLength += 1 + word.length;
        } else {
          linesInParagraph++;
          currentLineLength = word.length;
        }
      }
    });
    totalLines += linesInParagraph;
  });
  return totalLines;
}

function addDynamicTerms(slideId: string, requests: any[]) {
  const maskId = `terms_mask_${slideId}_${Date.now()}`;
  const textBoxId = `terms_text_${slideId}_${Date.now()}`;

  // 1. Create mask rectangle to hide raster terms on slide background
  requests.push({
    createShape: {
      objectId: maskId,
      shapeType: 'RECTANGLE',
      elementProperties: {
        pageObjectId: slideId,
        size: { width: { magnitude: 6900000, unit: 'EMU' }, height: { magnitude: 3240000, unit: 'EMU' } },
        transform: { scaleX: 1, scaleY: 1, translateX: 310000, translateY: 7200000, unit: 'EMU' }
      }
    }
  });

  // Style mask shape (solid white, no border)
  requests.push({
    updateShapeProperties: {
      objectId: maskId,
      shapeProperties: {
        shapeBackgroundFill: {
          solidFill: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } }
        },
        outline: { propertyState: 'NOT_RENDERED' }
      },
      fields: 'shapeBackgroundFill,outline'
    }
  });

  // 2. Create terms text box
  const mainParagraph = 'Компания UMBT предлагает современные климатические решения от бренда Midea для коммерческих и промышленных объектов любого масштаба.';
  const headerTitle = 'Условия предложения:';
  const bulletPoints = [
    '1. Условия поставки: со склада продавца в Ташкенте (бесплатная доставка в г. Ташкенте);',
    '2. Срок поставки: 2 рабочих дня после подтверждения получения платежа* (*уточнить наличие);',
    '3. Условия оплаты: 100% предоплата;',
    '4. Гарантия: 18 месяцев после поставки или 12 месяцев после пуска в эксплуатацию;',
    '5. Срок действия предложения: 1 неделя с момента подачи'
  ];
  const termsText = mainParagraph + '\n\n' + headerTitle + '\n' + bulletPoints.join('\n');

  requests.push({
    createShape: {
      objectId: textBoxId,
      shapeType: 'TEXT_BOX',
      elementProperties: {
        pageObjectId: slideId,
        size: { width: { magnitude: 6800000, unit: 'EMU' }, height: { magnitude: 1700000, unit: 'EMU' } },
        transform: { scaleX: 1, scaleY: 1, translateX: 380000, translateY: 8150000, unit: 'EMU' }
      }
    }
  });

  requests.push({
    insertText: {
      objectId: textBoxId,
      text: termsText
    }
  });

  // Formatting text
  requests.push({
    updateTextStyle: {
      objectId: textBoxId,
      style: {
        fontFamily: 'Calibri',
        fontSize: { magnitude: 10.5, unit: 'PT' },
        foregroundColor: { opaqueColor: { rgbColor: { red: 0, green: 0, blue: 0 } } }
      },
      fields: 'fontFamily,fontSize,foregroundColor'
    }
  });

  const idxMainEnd = mainParagraph.length;
  const idxHeaderStart = idxMainEnd + 2;
  const idxHeaderEnd = idxHeaderStart + headerTitle.length;

  // Center align the main paragraph
  requests.push({
    updateParagraphStyle: {
      objectId: textBoxId,
      style: { alignment: 'CENTER' },
      textRange: { startIndex: 0, endIndex: idxMainEnd, type: 'FIXED_RANGE' },
      fields: 'alignment'
    }
  });
  requests.push({
    updateTextStyle: {
      objectId: textBoxId,
      style: { fontSize: { magnitude: 11.5, unit: 'PT' } },
      textRange: { startIndex: 0, endIndex: idxMainEnd, type: 'FIXED_RANGE' },
      fields: 'fontSize'
    }
  });

  // Header styling (Bold, Underlined)
  requests.push({
    updateTextStyle: {
      objectId: textBoxId,
      style: { bold: true, underline: true, fontSize: { magnitude: 12, unit: 'PT' } },
      textRange: { startIndex: idxHeaderStart, endIndex: idxHeaderEnd, type: 'FIXED_RANGE' },
      fields: 'bold,underline,fontSize'
    }
  });
}

function getGroupRowHeights(g: GroupedItem, showImages: boolean): number[] {
  const isAdd = g.models.some(m => m.isAdditional);
  const isAcc = !isAdd && (
    g.category.toLowerCase().includes('аксессуар') || 
    g.category.toLowerCase().includes('автоматика') || 
    g.category.toLowerCase().includes('пульт') || 
    g.category.toLowerCase().includes('панель') || 
    g.category.toLowerCase().includes('опция')
  );

  const heights: number[] = [];
  
  // 1. Calculate raw height for each row based on the model name
  for (let i = 0; i < g.models.length; i++) {
    const m = g.models[i];
    let baseH = ADDITIONAL_ROW_H;
    if (isAdd) {
      baseH = ADDITIONAL_ROW_H;
    } else if (isAcc) {
      baseH = ACCESSORY_ROW_H;
    } else {
      // If there's only 1 model in the group, the first row is PRODUCT_ROW_H_FIRST.
      // If there are multiple models, all rows start with PRODUCT_ROW_H_SUBSEQUENT.
      baseH = (i === 0 && g.models.length === 1) ? PRODUCT_ROW_H_FIRST : PRODUCT_ROW_H_SUBSEQUENT;
    }
    
    const modelCharsPerLine = showImages ? 22 : 30;
    const modelLines = estimateTextLines(m.model, modelCharsPerLine);
    
    let rowH = baseH + (modelLines - 1) * 160000;
    heights.push(rowH);
  }
  
  // 2. Adjust rows under a group to have identical heights if group-level height requirement is larger
  if (!isAdd && !isAcc && g.models.length > 0) {
    const catCharsPerLine = showImages ? 14 : 30;
    const catLines = estimateTextLines(g.category, catCharsPerLine);
    const requiredCatHeight = PRODUCT_ROW_H_FIRST + (catLines - 1) * 160000;
    
    // If showing images, the group needs to be tall enough to fit the image
    const requiredImageHeight = showImages ? 1000000 : 0;
    const minGroupHeight = Math.max(requiredCatHeight, requiredImageHeight);
    
    const currentGroupSum = heights.reduce((sum, h) => sum + h, 0);
    if (currentGroupSum < minGroupHeight) {
      const deficit = minGroupHeight - currentGroupSum;
      const extra = Math.ceil(deficit / g.models.length);
      for (let i = 0; i < heights.length; i++) {
        heights[i] += extra;
      }
    }
  }
  
  return heights;
}

function getGroupHeight(g: GroupedItem, showImages: boolean): number {
  return getGroupRowHeights(g, showImages).reduce((sum, h) => sum + h, 0);
}

export async function generateSlidesKP(data: {
  cpName: string;
  client: string;
  items: any[];
  additionalItems?: any[];
  equipmentTotal?: number;
  partnerBonus?: number;
  additionalTotal?: number;
  total: number;
  manager: any;
  extraData?: any; 
  options?: any;
  origin?: string;
}) {
  const auth = getGoogleAuth();

  const slides = google.slides({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  const opts = data.options || { showImages: true, currency: 'ue', paymentType: 'cash', exchangeRate: 12500, transferFee: 10 };
  const showImages = opts.showImages !== false && opts.showImages !== 'false';
  const currency = opts.currency || 'ue';
  const paymentType = opts.paymentType || 'cash';
  const exchangeRate = Number(opts.exchangeRate) || 12500;
  const transferFee = Number(opts.transferFee) || 10;
  const origin = data.origin || 'http://localhost:3000';

  // 1. Sum up identical products and preserve order
  const aggregated: any[] = [];
  data.items.forEach(item => {
    const existing = aggregated.find(a => (item.id && a.id === item.id) || (item.model && a.model === item.model));
    if (existing) {
      existing.quantity += (Number(item.quantity) || 1);
    } else {
      aggregated.push({ ...item, quantity: Number(item.quantity) || 1 });
    }
  });

  const aggregatedAdditional: any[] = [];
  if (data.additionalItems && data.additionalItems.length > 0) {
    data.additionalItems.forEach(item => {
      if (!item.name && !item.price) return;
      const name = item.name || 'Дополнительные услуги';
      const existing = aggregatedAdditional.find(a => a.model === name && a.price === item.price);
      if (existing) {
        const currentQty = parseQuantity(existing.quantity);
        const newQty = parseQuantity(item.quantity);
        existing.quantity = (currentQty + newQty).toString();
      } else {
        aggregatedAdditional.push({
          id: item.id,
          category: 'Дополнительные работы и материалы',
          series: '',
          model: name,
          price: Number(item.price) || 0,
          quantity: item.quantity ? item.quantity.toString() : '1',
          image: '',
          isAdditional: true
        });
      }
    });
  }

  const allAggregated = [...aggregated, ...aggregatedAdditional];

  const getAdjustedPrice = (price: number) => {
    let p = price;
    if (paymentType === 'transfer') p *= (1 + transferFee / 100);
    if (currency === 'sum') p *= exchangeRate;
    return Math.round(p);
  };

  const calculatedEquipTotal = data.equipmentTotal !== undefined ? data.equipmentTotal : aggregated.reduce((sum, item) => {
    const price = getAdjustedPrice(Number(item.price) || 0);
    const qty = parseQuantity(item.quantity);
    return sum + (price * qty);
  }, 0);

  const calculatedAddTotal = data.additionalTotal !== undefined ? data.additionalTotal : aggregatedAdditional.reduce((sum, item) => {
    const price = getAdjustedPrice(Number(item.price) || 0);
    const qty = parseQuantity(item.quantity);
    return sum + (price * qty);
  }, 0);

  // 2. Group adjacent items by category+series (Preserves original order)
  const groups: GroupedItem[] = [];
  allAggregated.forEach(item => {
    const cat = item.category || 'Оборудование';
    const ser = item.series || '';
    let img = '';
    const localExists = item.image && fs.existsSync(path.join(process.cwd(), 'public', item.image.replace(/^\//, '')));
    if (localExists) {
      img = item.image;
    } else if (item.slidesImage && item.slidesImage.startsWith('http')) {
      img = item.slidesImage;
    } else {
      img = item.image || '';
    }
    
    // 2.0 Determine if it's an accessory to decide on photo and grouping
    const isAcc = (c: string) => {
      const lc = c.toLowerCase();
      return lc.includes('аксессуар') || lc.includes('автоматика') || lc.includes('пульт') || lc.includes('панель') || lc.includes('опция') || lc.includes('дополнительные работы') || lc.includes('дополнительные работы и материалы');
    };
    const currentIsAcc = isAcc(cat);

    // Force no image for accessories as requested
    if (currentIsAcc) img = '';
    
    // Only group with PREVIOUS if it matches exactly (category, series, image, and accessory-status)
    let group = groups.length > 0 ? groups[groups.length - 1] : null;
    const prevIsAcc = group ? isAcc(group.category) : false;

    const formattedModel = (item.model || 'Модель не указана').replace(/-/g, '\u2011');

    const shouldGroup = group && (
      (currentIsAcc && prevIsAcc && group.category === cat) ||
      (!currentIsAcc && !prevIsAcc && group.category === cat && group.series === ser && (showImages ? group.image === img : true))
    );

    if (shouldGroup && group) {
      group.models.push({ 
        model: formattedModel, 
        quantity: item.quantity, 
        price: Number(item.price) || 0,
        isAdditional: !!item.isAdditional
      });
    } else {
      groups.push({
        category: cat,
        series: ser,
        image: img,
        models: [{ 
          model: formattedModel, 
          quantity: item.quantity, 
          price: Number(item.price) || 0,
          isAdditional: !!item.isAdditional
        }]
      });
    }
  });
  

  // 3. Define footer rows
  const footerRows: { label: string; value: number; isGrand?: boolean; colorL: any; colorR: any }[] = [];

  const hasBonus = data.partnerBonus !== undefined && data.partnerBonus > 0;
  const hasAdditional = calculatedAddTotal > 0;

  if (hasBonus) {
    let equipLabel = 'Итого кондиционирование у.е.:';
    let netLabel = 'Итого за вычетом бонуса у.е.:';
    let bonusLabel = 'Партнерский бонус:';
    let addLabel = 'Итого доп. раздел у.е.:';
    let grandLabel = 'ОБЩИЙ ИТОГ:';

    if (paymentType === 'transfer') {
      equipLabel = 'Итого кондиционирование с НДС:';
      netLabel = 'Итого за вычетом бонуса с НДС:';
      addLabel = 'Итого доп. раздел с НДС:';
      grandLabel = 'ОБЩИЙ ИТОГ с НДС:';
    } else if (currency === 'sum') {
      equipLabel = 'Итого кондиционирование СУМ:';
      netLabel = 'Итого за вычетом бонуса СУМ:';
      addLabel = 'Итого доп. раздел СУМ:';
      grandLabel = 'ОБЩИЙ ИТОГ СУМ:';
    } else {
      equipLabel = 'Итого кондиционирование у.е.:';
      netLabel = 'Итого за вычетом бонуса у.е.:';
      addLabel = 'Итого доп. раздел у.е.:';
      grandLabel = 'ОБЩИЙ ИТОГ:';
    }

    footerRows.push({
      label: equipLabel,
      value: calculatedEquipTotal,
      colorL: COLORS.TOTAL_L,
      colorR: COLORS.TOTAL_R
    });

    footerRows.push({
      label: bonusLabel,
      value: -data.partnerBonus!,
      colorL: COLORS.TOTAL_L,
      colorR: COLORS.TOTAL_R
    });

    if (hasAdditional) {
      footerRows.push({
        label: netLabel,
        value: calculatedEquipTotal - data.partnerBonus!,
        colorL: COLORS.TOTAL_L,
        colorR: COLORS.TOTAL_R
      });
      footerRows.push({
        label: addLabel,
        value: calculatedAddTotal,
        colorL: COLORS.TOTAL_L,
        colorR: COLORS.TOTAL_R
      });
      footerRows.push({
        label: grandLabel,
        value: data.total,
        isGrand: true,
        colorL: COLORS.TOTAL_L,
        colorR: COLORS.TOTAL_R
      });
    } else {
      footerRows.push({
        label: grandLabel,
        value: data.total,
        isGrand: true,
        colorL: COLORS.TOTAL_L,
        colorR: COLORS.TOTAL_R
      });
    }
  } else {
    let totalLabel = 'Итого:';
    if (paymentType === 'transfer') {
      totalLabel = 'Итого с НДС:';
    } else if (currency === 'sum') {
      totalLabel = 'Итого СУМ:';
    } else {
      totalLabel = 'Итого у.е.:';
    }

    footerRows.push({ 
      label: totalLabel, 
      value: data.total, 
      isGrand: true, 
      colorL: COLORS.TOTAL_L, 
      colorR: COLORS.TOTAL_R 
    });
  }

  // 3.1 Split groups into per-slide chunks based on height in EMU
  const tablesData: { slideIndex: number, groups: GroupedItem[], height: number, rows: number }[] = [];
  let currentSlideIndex = 0;
  let currentGroups: GroupedItem[] = [];

  const calculateHeight = (slideGroups: GroupedItem[], isLast: boolean) => {
    let h = HEADER_FOOTER_H; // Header row height
    let rowCount = 1; // Start with header row
    slideGroups.forEach(g => {
      h += getGroupHeight(g, showImages);
      rowCount += g.models.length;
    });
    if (isLast) {
      h += footerRows.length * HEADER_FOOTER_H; // Footer "Total" rows height
      rowCount += footerRows.length;
    }
    // Add border height overhead (1 PT = 12700 EMU per horizontal border/row)
    h += rowCount * 12700;
    return h;
  };

  const countRows = (slideGroups: GroupedItem[]) => {
    return slideGroups.reduce((sum, g) => sum + g.models.length, 0);
  };

  let remainingGroups = groups.map(g => ({ ...g, models: [...g.models] }));

  while (remainingGroups.length > 0) {
    let currentGroupsOnPage: GroupedItem[] = [];
    
    // Check if all remaining groups can fit on this page as the last page
    const testLastHeight = calculateHeight(remainingGroups, true);
    if (testLastHeight <= MAX_HEIGHT_WITH_TERMS) {
      tablesData.push({
        slideIndex: currentSlideIndex,
        groups: remainingGroups,
        height: testLastHeight,
        rows: countRows(remainingGroups)
      });
      break;
    }
    
    // If not, this page is not the last page, so we use MAX_HEIGHT_WITHOUT_TERMS
    let addedAny = false;
    while (remainingGroups.length > 0) {
      const nextGroup = remainingGroups[0];
      const nextModel = nextGroup.models[0];
      
      const getTestGroups = (existing: GroupedItem[], newModel: any) => {
        if (existing.length === 0) {
          return [{ ...nextGroup, models: [newModel] }];
        }
        const last = existing[existing.length - 1];
        const isAcc = (c: string) => {
          const lc = c.toLowerCase();
          return lc.includes('аксессуар') || lc.includes('автоматика') || lc.includes('пульт') || lc.includes('панель') || lc.includes('опция') || lc.includes('дополнительные работы');
        };
        const lastIsAcc = isAcc(last.category);
        const currentIsAcc = isAcc(nextGroup.category);
        
        if (last.category === nextGroup.category && last.series === nextGroup.series && (showImages ? last.image === nextGroup.image : true) && lastIsAcc === currentIsAcc) {
          const copy = existing.map((x, idx) => {
            if (idx === existing.length - 1) {
              return { ...x, models: [...x.models, newModel] };
            }
            return x;
          });
          return copy;
        } else {
          return [...existing, { ...nextGroup, models: [newModel] }];
        }
      };

      const nextTestGroups = getTestGroups(currentGroupsOnPage, nextModel);
      
      // If this is the absolute last model, it must fit under MAX_HEIGHT_WITH_TERMS
      const isAbsoluteLast = (remainingGroups.length === 1) && (nextGroup.models.length === 1);
      const testHeight = calculateHeight(nextTestGroups, isAbsoluteLast);
      const testMaxHeight = isAbsoluteLast ? MAX_HEIGHT_WITH_TERMS : MAX_HEIGHT_WITHOUT_TERMS;
      
      if (testHeight <= testMaxHeight) {
        currentGroupsOnPage = nextTestGroups;
        nextGroup.models.shift();
        if (nextGroup.models.length === 0) {
          remainingGroups.shift();
        }
        addedAny = true;
      } else {
        break;
      }
    }
    
    if (!addedAny) {
      // Force at least one model to prevent infinite loop
      const nextGroup = remainingGroups[0];
      const nextModel = nextGroup.models[0];
      
      const getTestGroupsForce = (existing: GroupedItem[], newModel: any) => {
        if (existing.length === 0) {
          return [{ ...nextGroup, models: [newModel] }];
        }
        const last = existing[existing.length - 1];
        const isAcc = (c: string) => {
          const lc = c.toLowerCase();
          return lc.includes('аксессуар') || lc.includes('автоматика') || lc.includes('пульт') || lc.includes('панель') || lc.includes('опция') || lc.includes('дополнительные работы');
        };
        const lastIsAcc = isAcc(last.category);
        const currentIsAcc = isAcc(nextGroup.category);
        
        if (last.category === nextGroup.category && last.series === nextGroup.series && (showImages ? last.image === nextGroup.image : true) && lastIsAcc === currentIsAcc) {
          const copy = existing.map((x, idx) => {
            if (idx === existing.length - 1) {
              return { ...x, models: [...x.models, newModel] };
            }
            return x;
          });
          return copy;
        } else {
          return [...existing, { ...nextGroup, models: [newModel] }];
        }
      };

      currentGroupsOnPage = getTestGroupsForce(currentGroupsOnPage, nextModel);
      nextGroup.models.shift();
      if (nextGroup.models.length === 0) {
        remainingGroups.shift();
      }
    }
    
    tablesData.push({
      slideIndex: currentSlideIndex,
      groups: currentGroupsOnPage,
      height: calculateHeight(currentGroupsOnPage, false),
      rows: countRows(currentGroupsOnPage)
    });
    currentSlideIndex++;
  }

  if (tablesData.length === 0) {
    tablesData.push({
      slideIndex: 0,
      groups: [],
      height: HEADER_FOOTER_H + footerRows.length * HEADER_FOOTER_H,
      rows: 0
    });
  }

  // 3. Copy template & duplicate slides
  console.log('Copying template:', TEMPLATE_ID, 'to folder:', TARGET_FOLDER_ID);
  const copy = await drive.files.copy({
    fileId: TEMPLATE_ID,
    requestBody: { name: `КП - ${data.client} - ${data.cpName}`, parents: [TARGET_FOLDER_ID] }
  });
  const presentationId = copy.data.id!;
  const presentation = await slides.presentations.get({ presentationId });
  const templateSlideIds = presentation.data.slides!.map(s => s.objectId!);
  let allSlideIds: string[] = [];
  let slidesToDelete: string[] = [];

  if (tablesData.length === 1) {
    allSlideIds = [templateSlideIds[0]];
    slidesToDelete = [templateSlideIds[1], templateSlideIds[2]];
  } else {
    slidesToDelete = [templateSlideIds[0]];
    allSlideIds = [templateSlideIds[1]]; // Page 1 is Slide 2 (footer masked)
    
    const duplicateReqs = [];
    for (let i = 1; i < tablesData.length - 1; i++) {
        const newId = `slide_page_${i}_${Date.now()}`;
        duplicateReqs.push({
            duplicateObject: {
                objectId: templateSlideIds[1], // Duplicate Slide 2
                objectIds: { [templateSlideIds[1]]: newId }
            }
        });
        allSlideIds.push(newId);
    }
    allSlideIds.push(templateSlideIds[2]); // Page N is Slide 3 (footer visible)

    if (duplicateReqs.length > 0) {
      await slides.presentations.batchUpdate({ presentationId, requestBody: { requests: duplicateReqs } });
    }
  }

  // 4. PRE-UPLOAD ALL IMAGES IN PARALLEL (Local and Remote) + LOGO
  console.log('Pre-uploading all images to Drive in parallel...');
  const fileIdsToDelete: string[] = [];
  const imageMap = new Map<string, string>();
  const uniqueImages = showImages ? [...new Set(groups.map(g => g.image).filter(Boolean))] : [];
  const logoUrl = 'https://lh3.googleusercontent.com/d/1qqx8jRGF8WjVfl7GZyGehWuVdPbeC4AX';

  await Promise.all([
    ...uniqueImages.map(async (imgPath, idx) => {
      try {
        const driveFileId = getDriveFileId(imgPath);
        if (driveFileId) {
          const finalUrl = `https://lh3.googleusercontent.com/d/${driveFileId}`;
          imageMap.set(imgPath, finalUrl);
          return;
        }

        let buffer: Buffer | null = null;
        let mimeType = 'image/png';

        if (imgPath.startsWith('/')) {
          // Local image path (fetch via HTTP first, fall back to FS)
          const absoluteUrl = `${origin}${imgPath}`;
          console.log(`Fetching local image via HTTP from ${absoluteUrl}...`);
          try {
            const response = await fetch(absoluteUrl);
            if (response.ok) {
              buffer = Buffer.from(await response.arrayBuffer());
              if (imgPath.endsWith('.jpg') || imgPath.endsWith('.jpeg')) {
                mimeType = 'image/jpeg';
              } else if (imgPath.endsWith('.webp')) {
                mimeType = 'image/webp';
              }
            }
          } catch (fetchErr: any) {
            console.warn(`HTTP fetch failed for local image ${absoluteUrl}, trying local fs...`, fetchErr.message);
          }

          // Fallback to local FS
          if (!buffer) {
            const fullPath = path.join(process.cwd(), 'public', imgPath.replace(/^\//, ''));
            if (fs.existsSync(fullPath)) {
              buffer = fs.readFileSync(fullPath);
              if (imgPath.endsWith('.jpg') || imgPath.endsWith('.jpeg')) {
                mimeType = 'image/jpeg';
              } else if (imgPath.endsWith('.webp')) {
                mimeType = 'image/webp';
              }
            }
          }
        } else if (imgPath.startsWith('http')) {
          // Fallback fetch
          console.log(`Fetching remote image ${imgPath}...`);
          const response = await fetch(imgPath);
          if (response.ok) {
            buffer = Buffer.from(await response.arrayBuffer());
            const contentType = response.headers.get('content-type');
            if (contentType) mimeType = contentType;
          }
        }

        if (buffer) {
          console.log(`Uploading image buffer to Drive for ${imgPath}...`);
          const upload = await drive.files.create({
            requestBody: { name: `kp_img_${Date.now()}_${idx}`, mimeType },
            media: { body: Readable.from(buffer) },
            fields: 'id'
          });
          const fileId = upload.data.id!;
          fileIdsToDelete.push(fileId);
          await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
          const finalUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
          imageMap.set(imgPath, finalUrl);
        } else {
          console.warn(`Failed to resolve image: ${imgPath}`);
        }
      } catch (err) { console.error(`SpeedUp: Image upload failed for ${imgPath}`, err); }
    })
  ]);

  const placeholders = [
    { find: '{{client}}', replace: data.client },
    { find: '{{title}}', replace: `Коммерческое предложение № ${data.cpName.replace(/^КП-/, '')}` },
    { find: '{{date_text}}', replace: `Дата ${new Date().toLocaleDateString('ru-RU')}` },
    { find: '{{manager_name}}', replace: data.manager.name },
    { find: '{{manager_phone}}', replace: data.manager.phone },
    { find: '{{manager_email}}', replace: data.manager.email },
  ];
  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: { requests: placeholders.map(p => ({ replaceAllText: { replaceText: p.replace, containsText: { text: p.find, matchCase: false } } })) }
  });

  // 6. Build table requests for each slide
  const imageRequests: any[] = [];
  const activeSlideIds = new Set<string>();
  const tableReqs: any[] = [];
  const numCols = showImages ? 6 : 5;
  const columnWidths = showImages ? COL_WIDTHS_WITH_IMG : COL_WIDTHS_NO_IMG;
  
  let colPriceLabel = 'Цена';
  let sumLabel = 'Сумма';

  if (paymentType === 'transfer') {
    colPriceLabel = 'Цена с НДС';
    sumLabel = 'Сумма с НДС';
  } else if (currency === 'sum') {
    colPriceLabel = 'Цена СУМ';
    sumLabel = 'Сумма СУМ';
  } else {
    colPriceLabel = 'Цена у.е.';
    sumLabel = 'Сумма у.е.';
  }

  const headers = showImages
    ? ['Внешний вид', 'Наименование', 'Модель', 'Кол-во', colPriceLabel, sumLabel]
    : ['Наименование', 'Модель', 'Кол-во', colPriceLabel, sumLabel];

  for (let t = 0; t < tablesData.length; t++) {
      const tData = tablesData[t];
      const sId = allSlideIds[Math.min(tData.slideIndex, allSlideIds.length - 1)];
      activeSlideIds.add(sId);
      const isLastTable = t === tablesData.length - 1;
      const tableId = `kp_${Date.now()}_${t}`;
      const extraRows = isLastTable ? footerRows.length : 0;
      const displayRows = 1 + tData.rows + extraRows;
      
      // Calculate real table height based on row types
      let totalRowsH = 0;
      tData.groups.forEach(g => {
        totalRowsH += getGroupHeight(g, showImages);
      });
      const tableHeight = HEADER_FOOTER_H + totalRowsH + (extraRows * HEADER_FOOTER_H) + (displayRows * 12700);

      // Create table
      tableReqs.push({
          createTable: {
              objectId: tableId, rows: displayRows, columns: numCols,
              elementProperties: {
                  pageObjectId: sId,
                  size: { width: { magnitude: TABLE_WIDTH, unit: 'EMU' }, height: { magnitude: tableHeight, unit: 'EMU' } },
                  transform: { scaleX: 1, scaleY: 1, translateX: TABLE_X, translateY: TABLE_START_Y, unit: 'EMU' }
              }
          }
      });

      // Row heights
      const rowHeights: number[] = [];
      rowHeights.push(HEADER_FOOTER_H);
      tableReqs.push({ updateTableRowProperties: { objectId: tableId, rowIndices: [0], tableRowProperties: { minRowHeight: { magnitude: HEADER_FOOTER_H, unit: 'EMU' } }, fields: 'minRowHeight' }});
      
      let currentRowIdx = 1;
      tData.groups.forEach(g => {
        const heights = getGroupRowHeights(g, showImages);
        heights.forEach(rowH => {
          tableReqs.push({ updateTableRowProperties: { objectId: tableId, rowIndices: [currentRowIdx], tableRowProperties: { minRowHeight: { magnitude: rowH, unit: 'EMU' } }, fields: 'minRowHeight' }});
          rowHeights.push(rowH);
          currentRowIdx++;
        });
      });

      if (isLastTable) {
        for (let i = displayRows - extraRows; i < displayRows; i++) {
          tableReqs.push({ updateTableRowProperties: { objectId: tableId, rowIndices: [i], tableRowProperties: { minRowHeight: { magnitude: HEADER_FOOTER_H, unit: 'EMU' } }, fields: 'minRowHeight' }});
          rowHeights.push(HEADER_FOOTER_H);
        }
      }

      const getRowTopY = (idx: number) => {
        let y = TABLE_START_Y;
        for (let j = 0; j < idx; j++) {
          y += rowHeights[j] + 12700; // 1 PT border weight
        }
        return y;
      };

      // Header row
      headers.forEach((h, i) => {
          tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: 0, columnIndex: i }, text: h } });
          tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: 0, columnIndex: i }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.HEADER_BG } } }, contentAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill,contentAlignment' }});
          tableReqs.push({ updateTextStyle: { objectId: tableId, cellLocation: { rowIndex: 0, columnIndex: i }, style: { ...TABLE_STYLE, bold: true, foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 1, blue: 1 } } } }, fields: 'fontFamily,italic,fontSize,bold,foregroundColor' }});
          tableReqs.push({ updateParagraphStyle: { objectId: tableId, cellLocation: { rowIndex: 0, columnIndex: i }, style: { alignment: 'CENTER' }, fields: 'alignment' }});
      });

      // Data rows
      let r = 1;

      for (const group of tData.groups) {
          const startRow = r;
          const isGroupAdditional = group.models.some(m => m.isAdditional);

          // Image cell
          if (showImages && !isGroupAdditional) {
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: 0 }, text: ' ' } });
              let imageUrl = imageMap.get(group.image);
              if (imageUrl && imageUrl.includes('drive.google.com/uc?id='))
                imageUrl = imageUrl.replace('drive.google.com/uc?id=', 'lh3.googleusercontent.com/d/');
              if (imageUrl) {
                  const imgW = 1400000, colW = COL_WIDTHS_WITH_IMG[0];
                  
                  // Calculate exact group Y position and height from rowHeights array
                  const startY = getRowTopY(startRow);
                  let groupH = 0;
                  for (let i = 0; i < group.models.length; i++) {
                      groupH += rowHeights[startRow + i];
                  }
                  groupH += (group.models.length - 1) * 12700; // add borders between rows in group
                  
                  const imgH = Math.min(1100000, groupH - 100000);
                  imageRequests.push({ 
                    createImage: { 
                      url: imageUrl, 
                      elementProperties: { 
                        pageObjectId: sId, 
                        size: { width: { magnitude: imgW, unit: 'EMU' }, height: { magnitude: imgH, unit: 'EMU' } }, 
                        transform: { 
                          scaleX: 1, 
                          scaleY: 1, 
                          translateX: TABLE_X + (colW / 2) - (imgW / 2), 
                          translateY: startY + (groupH / 2) - (imgH / 2), 
                          unit: 'EMU' 
                        } 
                      } 
                    } 
                  });
              }
          }

          // Category cell
          if (!isGroupAdditional) {
              const catIdx = showImages ? 1 : 0;
              const catText = group.category.trim();
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: catIdx }, text: catText || ' ' } });
          }

          // Model rows
          for (const m of group.models) {
              const isFirstInGroup = r === startRow;
              const mCol = showImages ? 2 : 1;
              const qCol = showImages ? 3 : 2;
              const pCol = showImages ? 4 : 3;
              const sCol = showImages ? 5 : 4;

               // Row heights are pre-calculated and set at the table level

              if (isGroupAdditional) {
                  tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: 0 }, text: m.model || ' ' } });
              } else {
                  tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: mCol }, text: m.model || ' ' } });
              }
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: qCol }, text: m.quantity.toString() || '0' } });

              let adjustedPrice = m.price;
              if (paymentType === 'transfer') adjustedPrice *= (1 + transferFee / 100);
              if (currency === 'sum') adjustedPrice *= exchangeRate;
              adjustedPrice = Math.round(adjustedPrice);

              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: pCol }, text: adjustedPrice.toLocaleString() } });
              
              const parsedQty = parseQuantity(m.quantity);
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: sCol }, text: (adjustedPrice * parsedQty).toLocaleString() } });

              // Cell styling
              for (let col = 0; col < numCols; col++) {
                  const isMergedAway = isGroupAdditional
                      ? (showImages ? (col === 1 || col === 2) : (col === 1))
                      : (!isFirstInGroup && ((showImages && (col === 0 || col === 1)) || (!showImages && col === 0)));
                  tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: r, columnIndex: col }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.ROW_BG } } }, contentAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill,contentAlignment' }});
                  if (!isMergedAway) {
                      tableReqs.push({ updateTextStyle: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: col }, style: TABLE_STYLE, fields: 'fontFamily,italic,fontSize' }});
                      tableReqs.push({ updateParagraphStyle: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: col }, style: { alignment: 'CENTER' }, fields: 'alignment' }});
                  }
              }

              if (isGroupAdditional) {
                  tableReqs.push({
                      mergeTableCells: {
                          objectId: tableId,
                          tableRange: {
                              location: { rowIndex: r, columnIndex: 0 },
                              rowSpan: 1,
                              columnSpan: showImages ? 3 : 2
                          }
                      }
                  });
              }

              r++;
          }

          // Merge cells for multi-model groups
          if (group.models.length > 1 && !isGroupAdditional) {
              if (showImages) tableReqs.push({ mergeTableCells: { objectId: tableId, tableRange: { location: { rowIndex: startRow, columnIndex: 0 }, rowSpan: group.models.length, columnSpan: 1 } } });
              tableReqs.push({ mergeTableCells: { objectId: tableId, tableRange: { location: { rowIndex: startRow, columnIndex: showImages ? 1 : 0 }, rowSpan: group.models.length, columnSpan: 1 } } });
          }
      }

      // Footer rows (transfer info + totals)
      if (isLastTable) {
          const totIdxL = showImages ? 4 : 3;
          const totIdxR = showImages ? 5 : 4;

          footerRows.forEach((frow, fIdx) => {
              const rowIdx = r + fIdx;
              
              // Запись текста
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: rowIdx, columnIndex: totIdxL }, text: frow.label } });
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: rowIdx, columnIndex: totIdxR }, text: frow.value.toLocaleString() } });
              
              // Цвет фона
              tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: rowIdx, columnIndex: totIdxL }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: frow.colorL } } }, contentAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill,contentAlignment' }});
              tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: rowIdx, columnIndex: totIdxR }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: frow.colorR } } }, contentAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill,contentAlignment' }});
              
              // Стиль текста
              const fontSize = frow.isGrand ? 12 : 10;
              const isBold = frow.isGrand || frow.label.includes('Итого');
              const textRgb = { red: 0, green: 0, blue: 0 };
              
              tableReqs.push({ updateTextStyle: { objectId: tableId, cellLocation: { rowIndex: rowIdx, columnIndex: totIdxL }, style: { ...TABLE_STYLE, bold: isBold, fontSize: { magnitude: fontSize, unit: 'PT' }, foregroundColor: { opaqueColor: { rgbColor: textRgb } } }, fields: 'fontFamily,italic,fontSize,bold,foregroundColor' }});
              tableReqs.push({ updateTextStyle: { objectId: tableId, cellLocation: { rowIndex: rowIdx, columnIndex: totIdxR }, style: { ...TABLE_STYLE, bold: isBold, fontSize: { magnitude: fontSize, unit: 'PT' }, foregroundColor: { opaqueColor: { rgbColor: textRgb } } }, fields: 'fontFamily,italic,fontSize,bold,foregroundColor' }});
              
              tableReqs.push({ updateParagraphStyle: { objectId: tableId, cellLocation: { rowIndex: rowIdx, columnIndex: totIdxL }, style: { alignment: 'CENTER' }, fields: 'alignment' }});
              tableReqs.push({ updateParagraphStyle: { objectId: tableId, cellLocation: { rowIndex: rowIdx, columnIndex: totIdxR }, style: { alignment: 'CENTER' }, fields: 'alignment' }});
          });

          // Объединение пустых ячеек слева по всей высоте подвала
          if (totIdxL > 1 && footerRows.length > 0) {
              tableReqs.push({ 
                  mergeTableCells: { 
                       objectId: tableId, 
                       tableRange: { 
                           location: { rowIndex: r, columnIndex: 0 }, 
                           rowSpan: footerRows.length, 
                           columnSpan: totIdxL 
                       } 
                  } 
              });
          }
          
          // Вставляем логотип в первую строку итогов (если есть пустое место слева)
          if (totIdxL > 1 && logoUrl) {
              const logoW = 1600000;
              const logoH = 266000; // ~6:1 aspect ratio
              const logoX = TABLE_X + 150000;
              
              const footerRowY = getRowTopY(r);
              let totalFooterH = 0;
              for (let i = 0; i < footerRows.length; i++) {
                  totalFooterH += rowHeights[r + i];
              }
              totalFooterH += (footerRows.length - 1) * 12700; // add borders between rows in footer
              const logoY = footerRowY + (totalFooterH / 2) - (logoH / 2);
              
              imageRequests.push({
                createImage: {
                  url: logoUrl,
                  elementProperties: {
                    pageObjectId: sId,
                    size: { width: { magnitude: logoW, unit: 'EMU' }, height: { magnitude: logoH, unit: 'EMU' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: logoX, translateY: logoY, unit: 'EMU' }
                  }
                }
              });
          }
          
          r += footerRows.length;
      }

      // Column widths & borders
      tableReqs.push(...columnWidths.map((w, index) => ({ updateTableColumnProperties: { objectId: tableId, columnIndices: [index], tableColumnProperties: { columnWidth: { magnitude: w, unit: 'EMU' } }, fields: 'columnWidth' }})));
      tableReqs.push({ updateTableBorderProperties: { objectId: tableId, borderPosition: 'ALL', tableBorderProperties: { tableBorderFill: { solidFill: { color: { rgbColor: COLORS.BORDER } } }, weight: { magnitude: 1, unit: 'PT' } }, fields: 'tableBorderFill,weight' }});
      tableReqs.push({ updateTableBorderProperties: { objectId: tableId, borderPosition: 'OUTER', tableBorderProperties: { tableBorderFill: { solidFill: { color: { rgbColor: COLORS.BORDER } } }, weight: { magnitude: 1, unit: 'PT' } }, fields: 'tableBorderFill,weight' }});
      tableReqs.push({ updateTableBorderProperties: { objectId: tableId, borderPosition: 'BOTTOM', tableBorderProperties: { tableBorderFill: { solidFill: { color: { rgbColor: COLORS.BORDER } } }, weight: { magnitude: 1, unit: 'PT' } }, fields: 'tableBorderFill,weight' }});
   }

  // Add dynamic terms on the last slide
  const lastSlideId = allSlideIds[allSlideIds.length - 1];
  addDynamicTerms(lastSlideId, tableReqs);

  // 7. Apply tables, then images (separate batches for resilience)
  const delReqs = slidesToDelete.map(id => ({ deleteObject: { objectId: id } }));

  try {
    await slides.presentations.batchUpdate({
        presentationId,
        requestBody: { requests: [...tableReqs, ...delReqs] }
    });
  } catch (err) {
    console.error('Table batchUpdate failed', err);
    throw err;
  }

  if (imageRequests.length > 0) {
    try {
      console.log(`Sending ${imageRequests.length} image requests...`);
      await slides.presentations.batchUpdate({
          presentationId,
          requestBody: { requests: imageRequests }
      });
    } catch (err) {
      console.error('Image insertion failed (non-critical)', err);
    }
  }

  // Cleanup temp uploaded images
  await Promise.all(fileIdsToDelete.map(async (fileId) => {
    try { await drive.files.delete({ fileId }); } catch (e) {}
  }));

  // 8. Export PDF and delete temporary presentation from Drive
  let pdfUrl = '';
  let pdfBuffer: Buffer | null = null;
  try {
    const exportRes = await drive.files.export({
      fileId: presentationId,
      mimeType: 'application/pdf',
    }, { responseType: 'arraybuffer' });
    
    pdfBuffer = Buffer.from(exportRes.data as ArrayBuffer);
  } catch (err) { console.error('PDF export failure', err); }

  // Immediately delete temporary presentation from Google Drive
  try {
    await drive.files.delete({ fileId: presentationId });
    console.log(`Deleted temp presentation ${presentationId} from Drive`);
  } catch (e) {
    console.error('Failed to delete temp presentation', e);
  }

  // 9. Report to audit spreadsheet
  try {
    const contact = data.extraData?.contactPerson || {};
    
    const rawRegDate = data.extraData?.registrationDate || '';
    let formattedRegDate = rawRegDate;
    if (rawRegDate && rawRegDate.includes('-')) {
      const parts = rawRegDate.split('-');
      if (parts.length === 3) {
        formattedRegDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      } else if (parts.length === 2) {
        formattedRegDate = `01-${parts[1]}-${parts[0]}`;
      }
    }

    // Column mapping: A=0..W=22
    const rowData = [
      '',                                                    // A: Номер объекта (auto from sheet)
      data.client || '',                                     // B: Название объекта
      data.extraData?.company || '',                         // C: Компания заявитель
      data.extraData?.objectType || '',                      // D: Тип объекта
      '',                                                    // E: Комментарий
      data.extraData?.address || '',                         // F: Адрес объекта
      data.manager?.name || '',                              // G: Менеджер
      formattedRegDate,                                      // H: Дата регистрации
      '',                                                    // I: Стадия проекта
      new Date().toLocaleString('ru-RU', { month: 'long' }),// J: Месяц создания заказа
      '',                                                    // K: Сумма заказа
      'Да',                                                  // L: КП выдано
      data.cpName || '',                                     // M: № КП
      data.total || 0,                                       // N: Сумма КП
      '',                                                    // O: Ориентир. реализация
      '',                                                    // P: Оборудование основное (не заполняем)
      '',                                                    // Q: Оборудование допол. (не заполняем)
      '',                                                    // R: (пусто)
      contact.phone || '',                                   // S: контакт, тел
      contact.name || '',                                    // T: Контакт, ФИО
      contact.position || '',                                // U: контакт, должн.
      '',                                                    // V: Статус
      pdfUrl || ''                                           // W: Ссылка на КП
    ];

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: AUDIT_SHEET_ID,
      range: "'ВСЕ КП'!A1:W1000",
    });
    
    const rows = res.data.values || [];
    let targetRowIndex = rows.length + 1;
    
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || [];
      if (r[0] && r[0].trim() !== '' && !isNaN(Number(r[0])) && (!r[1] || r[1].trim() === '')) {
        targetRowIndex = i + 1;
        rowData[0] = r[0];
        break;
      }
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId: AUDIT_SHEET_ID,
        range: `'ВСЕ КП'!A${targetRowIndex}:W${targetRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [rowData] }
    });
  } catch (e: any) { 
    console.error('Audit failure', e); 
    return { presentationId, pdfUrl, pdfBuffer, auditError: e.message };
  }

  return { presentationId, pdfUrl, pdfBuffer };
}
