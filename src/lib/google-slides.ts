import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';

const TEMPLATE_ID = '1o0UwoDw31SoDXq2vUtvr5QKf2SLlcFm9D6CwmX-wyc4';
const TARGET_FOLDER_ID = '12akf-jI3SDHuHqxeDYlCfGPAxjHn5QgW';
const AUDIT_SHEET_ID = '1y8MKzptCnTUnBymmuB-KLzPM1ZnYX6PM7jjxz8J9YM4';

// Style Constants
const TABLE_STYLE = {
    fontFamily: 'Segoe UI',
    italic: true,
    fontSize: { magnitude: 11, unit: 'PT' }
};

// Layout Constants
const PRODUCT_ROW_H = 1500000;
const ACCESSORY_ROW_H = 450000;
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

async function uploadToDrive(imageUrl: string, fileName: string): Promise<string | null> {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const response = await fetch(imageUrl);
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
    console.error('Upload to Drive failed', e);
    return null;
  }
}

function isAccessory(g: GroupedItem) {
  const c = g.category.toLowerCase();
  return c.includes('аксессуар') || c.includes('автоматика') || c.includes('пульт') || c.includes('панель') || c.includes('опция');
}

export async function generateSlidesKP(data: {
  cpName: string;
  client: string;
  items: any[];
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

  // 2. Group adjacent items by category+series (Preserves original order)
  const groups: GroupedItem[] = [];
  aggregated.forEach(item => {
    const cat = item.category || 'Оборудование';
    const ser = item.series || '';
    let img = item.slidesImage && item.slidesImage.startsWith('http') ? item.slidesImage : item.image;
    
    // 2.0 Determine if it's an accessory to decide on photo and grouping
    const isAcc = (c: string) => {
      const lc = c.toLowerCase();
      return lc.includes('аксессуар') || lc.includes('автоматика') || lc.includes('пульт') || lc.includes('панель') || lc.includes('опция');
    };
    const currentIsAcc = isAcc(cat);

    // Force no image for accessories as requested
    if (currentIsAcc) img = '';
    
    // Only group with PREVIOUS if it matches exactly (category, series, image, and accessory-status)
    let group = groups.length > 0 ? groups[groups.length - 1] : null;
    const prevIsAcc = group ? isAcc(group.category) : false;

    if (group && group.category === cat && group.series === ser && group.image === img && currentIsAcc === prevIsAcc) {
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
  

  // 3. Split groups into per-slide chunks
  const tablesData: { slideIndex: number, groups: GroupedItem[], rows: number }[] = [];
  let currentTable: { slideIndex: number, groups: GroupedItem[], rows: number } = { slideIndex: 0, groups: [], rows: 0 };
  
  for (const group of groups) {
    let modelsRemaining = [...group.models];
    
    while (modelsRemaining.length > 0) {
      const limit = currentTable.slideIndex === 0 ? MAX_ROWS_SLIDE_1 : MAX_ROWS_SLIDE_N;
      const spaceLeft = Math.max(0, limit - currentTable.rows);
      
      if (spaceLeft === 0) {
        tablesData.push(currentTable);
        currentTable = { slideIndex: currentTable.slideIndex + 1, groups: [], rows: 0 };
        continue;
      }

      const take = Math.min(modelsRemaining.length, spaceLeft);
      const chunkModels = modelsRemaining.slice(0, take);
      modelsRemaining = modelsRemaining.slice(take);

      currentTable.groups.push({ ...group, models: chunkModels });
      currentTable.rows += take;
    }
  }
  if (currentTable.groups.length > 0) tablesData.push(currentTable);

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

  // 4. PRE-UPLOAD ALL IMAGES IN PARALLEL (Local and Remote)
  console.log('Pre-uploading all images to Drive in parallel...');
  const fileIdsToDelete: string[] = [];
  const imageMap = new Map<string, string>();
  const uniqueImages = [...new Set(groups.map(g => g.image).filter(Boolean))];

  await Promise.all(uniqueImages.map(async (imgPath, idx) => {
    try {
      if (imgPath.startsWith('http')) {
        // Remote image -> Drive Proxy
        const driveUrl = await uploadToDrive(imgPath, `kp_remote_img_${Date.now()}_${idx}`);
        if (driveUrl) {
           // Conversion to direct link format for better rendering
           const finalUrl = driveUrl.replace('drive.google.com/uc?id=', 'lh3.googleusercontent.com/d/');
           imageMap.set(imgPath, finalUrl);
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
  }));

  const placeholders = [
    { find: '{{client}}', replace: data.client },
    { find: '{{title}}', replace: `Коммерческое предложение ${data.cpName}` },
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
  const numCols = opts.showImages ? 6 : 5;
  const columnWidths = opts.showImages ? COL_WIDTHS_WITH_IMG : COL_WIDTHS_NO_IMG;
  const colPriceLabel = 'Цена';
  const sumLabel = 'Сумма';
  const headers = opts.showImages
    ? ['Внешний вид', 'Наименование', 'Модель', 'Кол-во', colPriceLabel, sumLabel]
    : ['Наименование', 'Модель', 'Кол-во', colPriceLabel, sumLabel];

  for (let t = 0; t < tablesData.length; t++) {
      const tData = tablesData[t];
      const sId = allSlideIds[Math.min(tData.slideIndex, allSlideIds.length - 1)];
      activeSlideIds.add(sId);
      const isLastTable = t === tablesData.length - 1;
      const tableId = `kp_${Date.now()}_${t}`;
      const extraRows = isLastTable ? (opts.paymentType === 'transfer' ? 2 : 1) : 0;
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
          if (opts.showImages) {
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
          const catIdx = opts.showImages ? 1 : 0;
          const catText = `${group.category}${group.series ? `\n${group.series}` : ''}`.trim();
          tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: catIdx }, text: catText || ' ' } });

          // Model rows
          for (const m of group.models) {
              const isFirstInGroup = r === startRow;
              const mCol = opts.showImages ? 2 : 1;
              const qCol = opts.showImages ? 3 : 2;
              const pCol = opts.showImages ? 4 : 3;
              const sCol = opts.showImages ? 5 : 4;

              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: mCol }, text: m.model || ' ' } });
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: qCol }, text: m.quantity.toString() || '0' } });

              let adjustedPrice = m.price;
              if (opts.paymentType === 'transfer') adjustedPrice *= (1 + opts.transferFee / 100);
              if (opts.currency === 'sum') adjustedPrice *= opts.exchangeRate;
              adjustedPrice = Math.round(adjustedPrice);

              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: pCol }, text: adjustedPrice.toLocaleString() } });
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: sCol }, text: (adjustedPrice * m.quantity).toLocaleString() } });

              // Cell styling
              for (let col = 0; col < numCols; col++) {
                  const isMergedAway = !isFirstInGroup && ((opts.showImages && (col === 0 || col === 1)) || (!opts.showImages && col === 0));
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
              if (opts.showImages) tableReqs.push({ mergeTableCells: { objectId: tableId, tableRange: { location: { rowIndex: startRow, columnIndex: 0 }, rowSpan: group.models.length, columnSpan: 1 } } });
              tableReqs.push({ mergeTableCells: { objectId: tableId, tableRange: { location: { rowIndex: startRow, columnIndex: opts.showImages ? 1 : 0 }, rowSpan: group.models.length, columnSpan: 1 } } });
          }
      }

      // Footer rows (transfer info + totals)
      if (isLastTable) {
          const totIdxL = opts.showImages ? 4 : 3;
          const totIdxR = opts.showImages ? 5 : 4;
          
          if (opts.paymentType === 'transfer') {
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: totIdxL }, text: `Оплата: Перечисление (${opts.transferFee}%)` } });
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: totIdxR }, text: ' ' } });
              tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: r, columnIndex: totIdxL }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.ROW_BG } } }, contentAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill,contentAlignment' }});
              tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: r, columnIndex: totIdxR }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.ROW_BG } } }, contentAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill,contentAlignment' }});
              r++;
              currentRowY += HEADER_FOOTER_H;
          }


          tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: totIdxL }, text: 'Итого:' } });
          tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: totIdxR }, text: data.total.toLocaleString() || '0' } });
          
          tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: r, columnIndex: totIdxL }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.TOTAL_L } } }, contentAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill,contentAlignment' }});
          tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: r, columnIndex: totIdxR }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.TOTAL_R } } }, contentAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill,contentAlignment' }});
          
          for (let col = totIdxL; col <= totIdxR; col++) {
             const fontSize = col === totIdxR ? 12 : 14; 
             tableReqs.push({ updateTextStyle: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: col }, style: { ...TABLE_STYLE, bold: true, fontSize: { magnitude: fontSize, unit: 'PT' } }, fields: 'fontFamily,italic,fontSize,bold' }});
             tableReqs.push({ updateParagraphStyle: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: col }, style: { alignment: 'CENTER' }, fields: 'alignment' }});
          }

          // Merge empty cells to the left of Итого and place logo
          if (totIdxL > 1) {
            tableReqs.push({ mergeTableCells: { objectId: tableId, tableRange: { location: { rowIndex: r, columnIndex: 0 }, rowSpan: 1, columnSpan: totIdxL } } });
          }
          // Also merge on transfer row if present
          if (opts.paymentType === 'transfer' && totIdxL > 1) {
            tableReqs.push({ mergeTableCells: { objectId: tableId, tableRange: { location: { rowIndex: r - 1, columnIndex: 0 }, rowSpan: 1, columnSpan: totIdxL } } });
          }
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
    
    // Column mapping: A=0..W=22
    const rowData = [
      '',                                                    // A: Номер объекта (auto from sheet)
      data.client || '',                                     // B: Название объекта
      data.extraData?.company || '',                         // C: Компания заявитель
      data.extraData?.objectType || '',                      // D: Тип объекта
      '',                                                    // E: Комментарий
      data.extraData?.address || '',                         // F: Адрес объекта
      data.manager?.name || '',                              // G: Менеджер
      data.extraData?.registrationDate || '',                // H: Месяц регистрации
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
