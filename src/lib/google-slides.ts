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
const PRODUCT_ROW_H = 950000;
const ACCESSORY_ROW_H = 400000;
const HEADER_FOOTER_H = 500000;
const TABLE_WIDTH = 6800000;
const TABLE_X = 500000;
const TABLE_START_Y = 2700000;
const MAX_ROWS_SLIDE_1 = 3;
const MAX_ROWS_SLIDE_N = 3;

const COLORS = {
    HEADER_BG: { red: 122/255, green: 147/255, blue: 172/255 },
    ROW_BG:    { red: 1, green: 1, blue: 1 },
    TOTAL_L:   { red: 198/255, green: 218/255, blue: 235/255 },
    TOTAL_R:   { red: 162/255, green: 187/255, blue: 212/255 },
    BORDER:    { red: 0, green: 0, blue: 0 },
};

const COL_WIDTHS_WITH_IMG = [1600000, 1200000, 1400000, 500000, 1050000, 1050000];
const COL_WIDTHS_NO_IMG = [2050000, 2100000, 550000, 900000, 900000];

interface GroupedItem {
  category: string;
  series: string;
  image: string;
  models: { model: string; quantity: number; price: number; }[];
}

function getDriveFileId(url: string): string | null {
  if (!url) return null;
  const idMatch = url.match(/[?&]id=([^&]+)/);
  if (idMatch) return idMatch[1];
  const dMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch) return dMatch[1];
  return null;
}

async function uploadToDrive(imageUrl: string, fileName: string): Promise<string | null> {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

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
  return c.includes('аксессуар') || c.includes('автоматика') || c.includes('пульт') || c.includes('панель') || c.includes('опция') || c.includes('дополнительные работы');
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
}) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  const slides = google.slides({ version: 'v1', auth: oauth2Client });
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  const opts = data.options || { showImages: true, currency: 'ue', paymentType: 'cash', exchangeRate: 12500, transferFee: 10 };
  const showImages = opts.showImages !== false && opts.showImages !== 'false';
  const currency = opts.currency || 'ue';
  const paymentType = opts.paymentType || 'cash';
  const exchangeRate = Number(opts.exchangeRate) || 12500;
  const transferFee = Number(opts.transferFee) || 10;

  // 1. Sum up identical products and preserve order
  const aggregated: any[] = [];
  data.items.forEach(item => {
    const existing = aggregated.find(a => a.id === item.id || a.model === item.model);
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
      return lc.includes('аксессуар') || lc.includes('автоматика') || lc.includes('пульт') || lc.includes('панель') || lc.includes('опция') || lc.includes('дополнительные работы');
    };
    const currentIsAcc = isAcc(cat);

    // Force no image for accessories as requested
    if (currentIsAcc) img = '';
    
    // Only group with PREVIOUS if it matches exactly (category, series, image, and accessory-status)
    let group = groups.length > 0 ? groups[groups.length - 1] : null;
    const prevIsAcc = group ? isAcc(group.category) : false;

    if (group && group.category === cat && group.series === ser && (showImages ? group.image === img : true) && currentIsAcc === prevIsAcc) {
      group.models.push({ 
        model: item.model || 'Модель не указана', 
        quantity: item.quantity, 
        price: Number(item.price) || 0 
      });
    } else {
      groups.push({
        category: cat,
        series: ser,
        image: img,
        models: [{ 
          model: item.model || 'Модель не указана', 
          quantity: item.quantity, 
          price: Number(item.price) || 0 
        }]
      });
    }
  });
  

  // 3. Define footer rows
  const footerRows: { label: string; value: number; isGrand?: boolean; colorL: any; colorR: any }[] = [];
  const hasAdd = data.additionalTotal && data.additionalTotal > 0;

  if (hasAdd) {
    const eqTotal = data.equipmentTotal || (data.total - (data.additionalTotal || 0));
    footerRows.push({ 
      label: 'Итого кондиционирование:', 
      value: eqTotal, 
      colorL: COLORS.TOTAL_L, 
      colorR: COLORS.TOTAL_R 
    });

    footerRows.push({ 
      label: 'Итого доп. раздел:', 
      value: data.additionalTotal!, 
      colorL: { red: 255/255, green: 240/255, blue: 215/255 }, 
      colorR: { red: 255/255, green: 220/255, blue: 170/255 } 
    });

    footerRows.push({ 
      label: 'ОБЩИЙ ИТОГ:', 
      value: data.total, 
      isGrand: true, 
      colorL: { red: 122/255, green: 147/255, blue: 172/255 }, 
      colorR: { red: 100/255, green: 125/255, blue: 150/255 } 
    });
  } else {
    footerRows.push({ 
      label: 'Итого:', 
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
    slideGroups.forEach(g => {
      const rowH = isAccessory(g) ? ACCESSORY_ROW_H : PRODUCT_ROW_H;
      h += g.models.length * rowH;
    });
    if (isLast) {
      h += footerRows.length * HEADER_FOOTER_H; // Footer "Total" rows height
    }
    return h;
  };

  const countRows = (slideGroups: GroupedItem[]) => {
    return slideGroups.reduce((sum, g) => sum + g.models.length, 0);
  };

  const MAX_HEIGHT = 4500000; // EMU limit for table height on a single slide

  for (let gIdx = 0; gIdx < groups.length; gIdx++) {
    const group = groups[gIdx];
    let modelsRemaining = [...group.models];
    
    while (modelsRemaining.length > 0) {
      const modelToTest = modelsRemaining[0];
      
      const getTestGroups = (existing: GroupedItem[], newModel: any) => {
        if (existing.length === 0) {
          return [{ ...group, models: [newModel] }];
        }
        const last = existing[existing.length - 1];
        const isAcc = (c: string) => {
          const lc = c.toLowerCase();
          return lc.includes('аксессуар') || lc.includes('автоматика') || lc.includes('пульт') || lc.includes('панель') || lc.includes('опция') || lc.includes('дополнительные работы');
        };
        const lastIsAcc = isAcc(last.category);
        const currentIsAcc = isAcc(group.category);
        
        if (last.category === group.category && last.series === group.series && (showImages ? last.image === group.image : true) && lastIsAcc === currentIsAcc) {
          const copy = existing.map((x, idx) => {
            if (idx === existing.length - 1) {
              return { ...x, models: [...x.models, newModel] };
            }
            return x;
          });
          return copy;
        } else {
          return [...existing, { ...group, models: [newModel] }];
        }
      };

      const nextTestGroups = getTestGroups(currentGroups, modelToTest);
      
      const isActuallyLast = (gIdx === groups.length - 1) && (modelsRemaining.length === 1);
      const testHeight = calculateHeight(nextTestGroups, isActuallyLast);
      
      if (testHeight <= MAX_HEIGHT) {
        currentGroups = nextTestGroups;
        modelsRemaining.shift();
      } else {
        if (currentGroups.length === 0) {
          currentGroups = nextTestGroups;
          modelsRemaining.shift();
          const forceHeight = calculateHeight(currentGroups, isActuallyLast);
          tablesData.push({
            slideIndex: currentSlideIndex,
            groups: currentGroups,
            height: forceHeight,
            rows: countRows(currentGroups)
          });
          currentSlideIndex++;
          currentGroups = [];
        } else {
          const finalHeight = calculateHeight(currentGroups, false);
          tablesData.push({
            slideIndex: currentSlideIndex,
            groups: currentGroups,
            height: finalHeight,
            rows: countRows(currentGroups)
          });
          currentSlideIndex++;
          currentGroups = [];
        }
      }
    }
  }

  if (currentGroups.length > 0) {
    const finalHeight = calculateHeight(currentGroups, true);
    tablesData.push({
      slideIndex: currentSlideIndex,
      groups: currentGroups,
      height: finalHeight,
      rows: countRows(currentGroups)
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
  const allSlideIds = [templateSlideIds[0]];
  // Extra template slides (2nd, 3rd, etc.) will be deleted later
  const extraTemplateSlides = templateSlideIds.slice(1);

  if (tablesData.length > 1) {
    const duplicateReqs = [];
    for (let i = 1; i < tablesData.length; i++) {
        const newId = `slide_page_${i}_${Date.now()}`;
        const sourceId = allSlideIds[i - 1]; // Дублируем предыдущий слайд, чтобы сохранить порядок
        duplicateReqs.push({
            duplicateObject: {
                objectId: sourceId,
                objectIds: { [sourceId]: newId }
            }
        });
        allSlideIds.push(newId);
    }
    await slides.presentations.batchUpdate({ presentationId, requestBody: { requests: duplicateReqs } });
  }

  // 4. PRE-UPLOAD ALL IMAGES IN PARALLEL (Local and Remote) + LOGO
  console.log('Pre-uploading all images and logo to Drive in parallel...');
  const fileIdsToDelete: string[] = [];
  const imageMap = new Map<string, string>();
  const uniqueImages = showImages ? [...new Set(groups.map(g => g.image).filter(Boolean))] : [];
  let logoUrl = '';

  await Promise.all([
    ...uniqueImages.map(async (imgPath, idx) => {
      try {
        if (imgPath.startsWith('http')) {
          // Remote image -> Drive Proxy
          const driveUrl = await uploadToDrive(imgPath, `kp_remote_img_${Date.now()}_${idx}`);
          if (driveUrl) {
             // Conversion to direct link format for better rendering
             const finalUrl = driveUrl.replace('drive.google.com/uc?id=', 'lh3.googleusercontent.com/d/');
             imageMap.set(imgPath, finalUrl);
             
             // Extract file ID to delete it later!
             const newFileId = getDriveFileId(driveUrl);
             if (newFileId) {
               fileIdsToDelete.push(newFileId);
             }
          }
        } else {
          // Local image -> Drive
          const fullPath = path.join(process.cwd(), 'public', imgPath.replace(/^\//, ''));
          if (fs.existsSync(fullPath)) {
            const upload = await drive.files.create({
              requestBody: { name: `kp_local_img_${Date.now()}_${idx}`, mimeType: 'image/png' },
              media: { body: fs.createReadStream(fullPath) },
              fields: 'id'
            });
            const fileId = upload.data.id!;
            fileIdsToDelete.push(fileId);
            await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
            const finalUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
            imageMap.set(imgPath, finalUrl);
          }
        }
      } catch (err) { console.error(`SpeedUp: Image upload failed for ${imgPath}`, err); }
    }),
    (async () => {
      try {
        const logoPath = path.join(process.cwd(), 'logo near itogo.png');
        if (fs.existsSync(logoPath)) {
          const upload = await drive.files.create({
            requestBody: { name: `kp_logo_${Date.now()}`, mimeType: 'image/png' },
            media: { body: fs.createReadStream(logoPath) },
            fields: 'id'
          });
          const fileId = upload.data.id!;
          fileIdsToDelete.push(fileId);
          await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
          logoUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
          console.log('Logo near itogo uploaded successfully:', logoUrl);
        } else {
          console.warn('Logo file "logo near itogo.png" not found at project root');
        }
      } catch (err) {
        console.error('Failed to upload logo near itogo', err);
      }
    })()
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
  const colPriceLabel = 'Цена';
  const sumLabel = 'Сумма';
  const headers = showImages
    ? ['Внешний вид', 'Наименование', 'Модель', 'Кол-во', colPriceLabel, sumLabel]
    : ['Наименование', 'Модель', 'Кол-во', colPriceLabel, sumLabel];

  for (let t = 0; t < tablesData.length; t++) {
      const tData = tablesData[t];
      const sId = allSlideIds[Math.min(tData.slideIndex, allSlideIds.length - 1)];
      activeSlideIds.add(sId);
      const isLastTable = t === tablesData.length - 1;
      const tableId = `kp_${Date.now()}_${t}`;
      const extraRows = isLastTable ? 1 : 0;
      const displayRows = 1 + tData.rows + extraRows;
      
      // Calculate real table height based on row types
      let totalRowsH = 0;
      tData.groups.forEach(g => {
        const h = isAccessory(g) ? ACCESSORY_ROW_H : PRODUCT_ROW_H;
        totalRowsH += g.models.length * h;
      });
      const tableHeight = HEADER_FOOTER_H + totalRowsH + (extraRows * HEADER_FOOTER_H);

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
      tableReqs.push({ updateTableRowProperties: { objectId: tableId, rowIndices: [0], tableRowProperties: { minRowHeight: { magnitude: HEADER_FOOTER_H, unit: 'EMU' } }, fields: 'minRowHeight' }});
      
      let currentRowIdx = 1;
      tData.groups.forEach(g => {
        const rowH = isAccessory(g) ? ACCESSORY_ROW_H : PRODUCT_ROW_H;
        for (let i = 0; i < g.models.length; i++) {
          tableReqs.push({ updateTableRowProperties: { objectId: tableId, rowIndices: [currentRowIdx], tableRowProperties: { minRowHeight: { magnitude: rowH, unit: 'EMU' } }, fields: 'minRowHeight' }});
          currentRowIdx++;
        }
      });

      if (isLastTable) {
        for (let i = displayRows - extraRows; i < displayRows; i++) {
          tableReqs.push({ updateTableRowProperties: { objectId: tableId, rowIndices: [i], tableRowProperties: { minRowHeight: { magnitude: HEADER_FOOTER_H, unit: 'EMU' } }, fields: 'minRowHeight' }});
        }
      }

      // Header row
      headers.forEach((h, i) => {
          tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: 0, columnIndex: i }, text: h } });
          tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: 0, columnIndex: i }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.HEADER_BG } } }, contentAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill,contentAlignment' }});
          tableReqs.push({ updateTextStyle: { objectId: tableId, cellLocation: { rowIndex: 0, columnIndex: i }, style: { ...TABLE_STYLE, bold: true, foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 1, blue: 1 } } } }, fields: 'fontFamily,italic,fontSize,bold,foregroundColor' }});
          tableReqs.push({ updateParagraphStyle: { objectId: tableId, cellLocation: { rowIndex: 0, columnIndex: i }, style: { alignment: 'CENTER' }, fields: 'alignment' }});
      });

      // Data rows
      let r = 1;
      let currentRowY = TABLE_START_Y + HEADER_FOOTER_H; // Row 0 was header

      for (const group of tData.groups) {
          const startRow = r;
          const startGroupY = currentRowY;
          const rowH = isAccessory(group) ? ACCESSORY_ROW_H : PRODUCT_ROW_H;
          const groupHeight = group.models.length * rowH;

          // Image cell
          if (showImages) {
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: 0 }, text: ' ' } });
              let imageUrl = imageMap.get(group.image);
              if (imageUrl && imageUrl.includes('drive.google.com/uc?id='))
                imageUrl = imageUrl.replace('drive.google.com/uc?id=', 'lh3.googleusercontent.com/d/');
              if (imageUrl) {
                  const imgW = 1400000, colW = COL_WIDTHS_WITH_IMG[0];
                  const imgH = Math.min(1100000, groupHeight - 100000);
                  imageRequests.push({ createImage: { url: imageUrl, elementProperties: { pageObjectId: sId, size: { width: { magnitude: imgW, unit: 'EMU' }, height: { magnitude: imgH, unit: 'EMU' } }, transform: { scaleX: 1, scaleY: 1, translateX: TABLE_X + (colW / 2) - (imgW / 2), translateY: startGroupY + (groupHeight / 2) - (imgH / 2), unit: 'EMU' } } } });
              }
          }

          // Category cell
          const catIdx = showImages ? 1 : 0;
          const catText = group.category.trim();
          tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: catIdx }, text: catText || ' ' } });

          // Model rows
          for (const m of group.models) {
              const isFirstInGroup = r === startRow;
              const mCol = showImages ? 2 : 1;
              const qCol = showImages ? 3 : 2;
              const pCol = showImages ? 4 : 3;
              const sCol = showImages ? 5 : 4;

              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: mCol }, text: m.model || ' ' } });
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
                  const isMergedAway = !isFirstInGroup && ((showImages && (col === 0 || col === 1)) || (!showImages && col === 0));
                  tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: r, columnIndex: col }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.ROW_BG } } }, contentAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill,contentAlignment' }});
                  if (!isMergedAway) {
                      tableReqs.push({ updateTextStyle: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: col }, style: TABLE_STYLE, fields: 'fontFamily,italic,fontSize' }});
                      tableReqs.push({ updateParagraphStyle: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: col }, style: { alignment: 'CENTER' }, fields: 'alignment' }});
                  }
              }
              r++;
              currentRowY += rowH;
          }

          // Merge cells for multi-model groups
          if (group.models.length > 1) {
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
              const textRgb = frow.label === 'ОБЩИЙ ИТОГ:' ? { red: 1, green: 1, blue: 1 } : { red: 0, green: 0, blue: 0 };
              
              tableReqs.push({ updateTextStyle: { objectId: tableId, cellLocation: { rowIndex: rowIdx, columnIndex: totIdxL }, style: { ...TABLE_STYLE, bold: isBold, fontSize: { magnitude: fontSize, unit: 'PT' }, foregroundColor: { opaqueColor: { rgbColor: textRgb } } }, fields: 'fontFamily,italic,fontSize,bold,foregroundColor' }});
              tableReqs.push({ updateTextStyle: { objectId: tableId, cellLocation: { rowIndex: rowIdx, columnIndex: totIdxR }, style: { ...TABLE_STYLE, bold: isBold, fontSize: { magnitude: fontSize, unit: 'PT' }, foregroundColor: { opaqueColor: { rgbColor: textRgb } } }, fields: 'fontFamily,italic,fontSize,bold,foregroundColor' }});
              
              tableReqs.push({ updateParagraphStyle: { objectId: tableId, cellLocation: { rowIndex: rowIdx, columnIndex: totIdxL }, style: { alignment: 'CENTER' }, fields: 'alignment' }});
              tableReqs.push({ updateParagraphStyle: { objectId: tableId, cellLocation: { rowIndex: rowIdx, columnIndex: totIdxR }, style: { alignment: 'CENTER' }, fields: 'alignment' }});

              // Объединение пустых ячеек слева
              if (totIdxL > 1) {
                  tableReqs.push({ mergeTableCells: { objectId: tableId, tableRange: { location: { rowIndex: rowIdx, columnIndex: 0 }, rowSpan: 1, columnSpan: totIdxL } } });
              }
          });

          // Вставляем логотип в первую строку итогов (если есть пустое место слева)
          if (totIdxL > 1 && logoUrl) {
              const logoW = 1600000;
              const logoH = 266000; // ~6:1 aspect ratio
              const logoX = TABLE_X + 150000;
              const logoY = currentRowY + (HEADER_FOOTER_H / 2) - (logoH / 2);
              
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
  }

  // 7. Apply tables, then images (separate batches for resilience)
  const unusedSlideIds = allSlideIds.filter(id => !activeSlideIds.has(id));
  const allToDelete = [...unusedSlideIds, ...extraTemplateSlides];
  const delReqs = allToDelete.map(id => ({ deleteObject: { objectId: id } }));

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

  // 8. Export PDF & upload
  let pdfUrl = '';
  let pdfBuffer: Buffer | null = null;
  try {
    const exportRes = await drive.files.export({
      fileId: presentationId,
      mimeType: 'application/pdf',
    }, { responseType: 'arraybuffer' });
    
    pdfBuffer = Buffer.from(exportRes.data as ArrayBuffer);
    const stream = new Readable();
    stream.push(pdfBuffer);
    stream.push(null);

    const pdfUpload = await drive.files.create({
      requestBody: {
        name: `КП - ${data.client} - ${data.cpName}.pdf`,
        parents: [TARGET_FOLDER_ID],
        mimeType: 'application/pdf'
      },
      media: { body: stream, mimeType: 'application/pdf' },
      fields: 'id,webViewLink'
    });

    const pdfId = pdfUpload.data.id!;
    await drive.permissions.create({
      fileId: pdfId,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    const pdfInfo = await drive.files.get({ fileId: pdfId, fields: 'webViewLink' });
    pdfUrl = pdfInfo.data.webViewLink || '';
  } catch (err) { console.error('PDF failure', err); }

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
