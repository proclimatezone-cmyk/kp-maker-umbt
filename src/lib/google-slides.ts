import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';

const TEMPLATE_ID = '1o0UwoDw31SoDXq2vUtvr5QKf2SLlcFm9D6CwmX-wyc4';
const TARGET_FOLDER_ID = '12akf-jI3SDHuHqxeDYlCfGPAxjHn5QgW';
const AUDIT_SHEET_ID = '1y8MKzptCnTUnBymmuB-KLzPM1ZnYX6PM7jjxz8J9YM4';

// Style Constants
const TABLE_STYLE = {
    fontFamily: 'Segoe UI',
    italic: true,
    fontSize: { magnitude: 10, unit: 'PT' }
};

interface GroupedItem {
  category: string;
  series: string;
  image: string;
  models: {
    model: string;
    quantity: number;
    price: number;
  }[];
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

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  const slides = google.slides({ version: 'v1', auth: oauth2Client });
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  // 1. Group items
  const groups: GroupedItem[] = [];
  data.items.forEach(item => {
    let group = groups.find(g => g.category === item.category && g.series === item.series);
    if (!group) {
      group = {
        category: item.category,
        series: item.series,
        image: item.image,
        models: []
      };
      groups.push(group);
    }
    group.models.push({
      model: item.model,
      quantity: item.quantity,
      price: item.price
    });
  });

  // 3. Copy Template FIRST
  console.log('Copying template:', TEMPLATE_ID, 'to folder:', TARGET_FOLDER_ID);
  const copy = await drive.files.copy({
    fileId: TEMPLATE_ID,
    requestBody: {
      name: `КП - ${data.client} - ${data.cpName}`,
      parents: [TARGET_FOLDER_ID]
    }
  });
  const presentationId = copy.data.id!;

  // 3.5. Fetch explicit slide IDs
  const presentationFetch = await slides.presentations.get({ presentationId });
  const allSlideIds = presentationFetch.data.slides!.map(s => s.objectId!);
  const slide1Id = allSlideIds[0];
  const slide2Id = allSlideIds.length > 1 ? allSlideIds[1] : slide1Id;

  // 2. Select Slide (Slide 1 if <= 4 items, else Slide 2)
  const activeSlideId = data.items.length <= 4 ? slide1Id : slide2Id;

  // 4. Fill Placeholders
  const placeholders = [
    { find: '{{client}}', replace: data.client },
    { find: '{{title}}', replace: `Коммерческое предложение ${data.cpName}` },
    { find: '{{date_text}}', replace: `Дата ${new Date().toLocaleDateString('ru-RU')}` },
    { find: '{{manager_name}}', replace: data.manager.name },
    { find: '{{manager_phone}}', replace: data.manager.phone },
    { find: '{{manager_email}}', replace: data.manager.email },
  ];

  const fillReqs = placeholders.map(p => ({
    replaceAllText: { replaceText: p.replace, containsText: { text: p.find, matchCase: false } }
  }));

  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: { requests: fillReqs }
  });

  // 5. Build Table(s)
  const opts = data.options || { showImages: true, currency: 'ue', paymentType: 'cash', exchangeRate: 12500, transferFee: 10 };
  
  const COLORS = {
    HEADER_BG: { red: 122/255, green: 147/255, blue: 172/255 },
    ROW_BG:    { red: 240/255, green: 241/255, blue: 243/255 },
    TOTAL_L:   { red: 189/255, green: 215/255, blue: 238/255 },
    TOTAL_R:   { red: 172/255, green: 185/255, blue: 202/255 },
    BORDER:    { red: 0, green: 0, blue: 0 },
  };

  const MAX_ROWS_SLIDE_1 = 4;
  const MAX_ROWS_SLIDE_N = 10;
  const tablesData = [];
  let currentTable = { slideIndex: 0, groups: [], rows: 0 };
  
  for (const group of groups) {
      const limit = currentTable.slideIndex === 0 ? MAX_ROWS_SLIDE_1 : MAX_ROWS_SLIDE_N;
      if (currentTable.rows > 0 && currentTable.rows + group.models.length > limit) {
          tablesData.push(currentTable);
          currentTable = { slideIndex: currentTable.slideIndex + 1, groups: [group], rows: group.models.length };
      } else {
          currentTable.groups.push(group);
          currentTable.rows += group.models.length;
      }
  }
  if (currentTable.groups.length > 0) {
      tablesData.push(currentTable);
  }

  // 5. Pre-upload Images in Parallel for SPEED
  const fileIdsToDelete = []
  const imageMap = new Map()
  if (opts.showImages) {
    const uniqueImages = [...new Set(groups.map(g => g.image))]
    await Promise.all(uniqueImages.map(async (imgPath) => {
      try {
        const fullPath = path.join(process.cwd(), 'public', imgPath.replace(/^\//, ''))
        if (fs.existsSync(fullPath)) {
          const upload = await drive.files.create({
            requestBody: { name: `kp_img_${Date.now()}`, mimeType: 'image/png' },
            media: { body: fs.createReadStream(fullPath) },
            fields: 'id'
          })
          const fileId = upload.data.id!
          fileIdsToDelete.push(fileId)
          await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } })
          imageMap.set(imgPath, `https://drive.google.com/uc?id=${fileId}`)
        }
      } catch (err) { console.error('Image upload failed', err) }
    }))
  }

  // 5. Build Table(s)
  const imageRequests = [];
  const activeSlideIds = new Set();
  
  for (let t = 0; t < tablesData.length; t++) {
      const tData = tablesData[t];
      const sId = allSlideIds[Math.min(tData.slideIndex, allSlideIds.length - 1)];
      activeSlideIds.add(sId);
      const isLastTable = t === tablesData.length - 1;
      
      const tableId = `kp_${Date.now()}_${t}`;
      const numCols = opts.showImages ? 6 : 5;
      const extraRows = isLastTable ? (opts.paymentType === 'transfer' ? 2 : 1) : 0;
      const displayRows = 1 + tData.rows + extraRows;
      const startY = tData.slideIndex === 0 ? 3000000 : 1000000;
      
      tableReqs.push({
          createTable: {
              objectId: tableId, rows: displayRows, columns: numCols,
              elementProperties: {
                  pageObjectId: sId,
                  size: { width: { magnitude: 6500000, unit: 'EMU' }, height: { magnitude: 400000 * displayRows, unit: 'EMU' } },
                  transform: { scaleX: 1, scaleY: 1, translateX: 350000, translateY: startY, unit: 'EMU' }
              }
          }
      });

      const priceLabel = opts.currency === 'sum' ? 'Сумма (сум)' : 'Сумма (у.е.)';
      const colPriceLabel = opts.currency === 'sum' ? 'Цена (сум)' : 'Цена (у.е.)';
      const headers = opts.showImages ? 
          ['Внешний вид', 'Наименование', 'Модель', 'Кол-во', colPriceLabel, priceLabel] : 
          ['Наименование', 'Модель', 'Кол-во', colPriceLabel, priceLabel];

      headers.forEach((h, i) => {
          tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: 0, columnIndex: i }, text: h } });
          tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: 0, columnIndex: i }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.HEADER_BG } } }, verticalAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill,verticalAlignment' }});
          tableReqs.push({ updateTextStyle: { objectId: tableId, cellLocation: { rowIndex: 0, columnIndex: i }, style: { ...TABLE_STYLE, bold: true, foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 1, blue: 1 } } } }, fields: 'fontFamily,italic,fontSize,bold,foregroundColor' }});
          tableReqs.push({ updateParagraphStyle: { objectId: tableId, cellLocation: { rowIndex: 0, columnIndex: i }, style: { alignment: 'CENTER' }, fields: 'alignment' }});
      });

      let r = 1;
      for (const group of tData.groups) {
          const startRow = r;
          if (opts.showImages) {
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: 0 }, text: ' ' } });
              const imageUrl = imageMap.get(group.image);
              if (imageUrl) {
                  const totalGroupHeight = group.models.length * 400000;
                  const imageYOffset = (totalGroupHeight / 2) - (350000 / 2);
                  imageRequests.push({ 
                    createImage: { 
                        url: imageUrl, 
                        elementProperties: { 
                            pageObjectId: sId, 
                            size: { width: { magnitude: 650000, unit: 'EMU' }, height: { magnitude: 350000, unit: 'EMU' } }, 
                            transform: { scaleX: 1, scaleY: 1, translateX: 400000, translateY: startY + (startRow * 400000) + imageYOffset, unit: 'EMU' } 
                        } 
                    } 
                  });
              }
          }
          const catIdx = opts.showImages ? 1 : 0;
          const seriesText = group.series ? `\n${group.series}` : '';
          tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: catIdx }, text: `${group.category}${seriesText}` } });


      for (const m of group.models) {
              const isFirstInGroup = r === startRow;
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: opts.showImages ? 2 : 1 }, text: m.model } });
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: opts.showImages ? 3 : 2 }, text: m.quantity.toString() } });
              
              let adjustedPrice = m.price;
              if (opts.paymentType === 'transfer') adjustedPrice = adjustedPrice * (1 + opts.transferFee / 100);
              if (opts.currency === 'sum') adjustedPrice = adjustedPrice * opts.exchangeRate;
              adjustedPrice = Math.round(adjustedPrice);
              
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: opts.showImages ? 4 : 3 }, text: adjustedPrice.toLocaleString() } });
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: opts.showImages ? 5 : 4 }, text: (adjustedPrice * m.quantity).toLocaleString() } });
              
              for (let col = 0; col < numCols; col++) {
                  const isMergedAway = !isFirstInGroup && ((opts.showImages && (col === 0 || col === 1)) || (!opts.showImages && col === 0));
                  tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: r, columnIndex: col }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.ROW_BG } } }, verticalAlignment: 'MIDDLE' }, fields: 'tableCellBackgroundFill,verticalAlignment' }});
                  if (!isMergedAway) {
                      tableReqs.push({ updateTextStyle: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: col }, style: TABLE_STYLE, fields: 'fontFamily,italic,fontSize' }});
                      const alignment = (col === 0 || (opts.showImages && col === 1)) ? 'CENTER' : 'CENTER'; // All centered as requested
                      tableReqs.push({ updateParagraphStyle: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: col }, style: { alignment: 'CENTER' }, fields: 'alignment' }});
                  }
              }
              r++;
          }
          if (group.models.length > 1) {
              if (opts.showImages) {
                  tableReqs.push({ mergeTableCells: { objectId: tableId, tableRange: { location: { rowIndex: startRow, columnIndex: 0 }, rowSpan: group.models.length, columnSpan: 1 } } });
              }
              const nameCol = opts.showImages ? 1 : 0;
              tableReqs.push({ mergeTableCells: { objectId: tableId, tableRange: { location: { rowIndex: startRow, columnIndex: nameCol }, rowSpan: group.models.length, columnSpan: 1 } } });
          }
      }

      if (isLastTable) {
          const totIdxL = opts.showImages ? 4 : 3;
          const totIdxR = opts.showImages ? 5 : 4;
          
          if (opts.paymentType === 'transfer') {
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: totIdxL }, text: `Оплата: Перечисление (${opts.transferFee}%)` } });
              tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: totIdxR }, text: opts.currency === 'sum' ? `Курс: ${opts.exchangeRate.toLocaleString()} сум` : '' } });
              
              // Fill background
              tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: r, columnIndex: totIdxL }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.ROW_BG } } } }, fields: 'tableCellBackgroundFill' }});
              tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: r, columnIndex: totIdxR }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.ROW_BG } } } }, fields: 'tableCellBackgroundFill' }});
              r++;
          }

          tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: totIdxL }, text: 'Итого:' } });
          tableReqs.push({ insertText: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: totIdxR }, text: `${data.total.toLocaleString()}` } });
          tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: r, columnIndex: totIdxL }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.TOTAL_L } } } }, fields: 'tableCellBackgroundFill' }});
          tableReqs.push({ updateTableCellProperties: { objectId: tableId, tableRange: { location: { rowIndex: r, columnIndex: totIdxR }, rowSpan: 1, columnSpan: 1 }, tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: COLORS.TOTAL_R } } } }, fields: 'tableCellBackgroundFill' }});
          
          for (let col = totIdxL; col <= totIdxR; col++) {
             tableReqs.push({ updateTextStyle: { objectId: tableId, cellLocation: { rowIndex: r, columnIndex: col }, style: { ...TABLE_STYLE, bold: true, fontSize: { magnitude: 12, unit: 'PT' } }, fields: 'fontFamily,italic,fontSize,bold' }});
          }
      }

      const columnWidths = opts.showImages ? 
          [750000, 1300000, 2100000, 550000, 900000, 900000] :
          [2050000, 2100000, 550000, 900000, 900000];
      const colReqs = columnWidths.map((w, index) => ({ updateTableColumnProperties: { objectId: tableId, columnIndices: [index], tableColumnProperties: { columnWidth: { magnitude: w, unit: 'EMU' } }, fields: 'columnWidth' }}));
      
      tableReqs.push(...colReqs);
      tableReqs.push({ updateTableBorderProperties: { objectId: tableId, borderPosition: 'ALL', tableBorderProperties: { tableBorderFill: { solidFill: { color: { rgbColor: COLORS.BORDER } } }, weight: { magnitude: 1, unit: 'PT' } }, fields: 'tableBorderFill,weight' }});
  }

  const slideIdsToRemove = allSlideIds.filter(id => !activeSlideIds.has(id));
  const delReqs = slideIdsToRemove.map(id => ({ deleteObject: { objectId: id } }));

  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: { requests: [...tableReqs, ...imageRequests, ...delReqs] }
  });

  for (const fileId of fileIdsToDelete) {
    try { await drive.files.delete({ fileId }); } catch (e) {}
  }


  // 6. Report to Spreadsheet
  try {
    const equipMain = data.items.filter(i => !i.isExtra).map(i => `${i.model} x ${i.quantity}`).join(', ');
    const equipExtra = data.items.filter(i => i.isExtra).map(i => `${i.model} x ${i.quantity}`).join(', ');
    
    await sheets.spreadsheets.values.append({
        spreadsheetId: AUDIT_SHEET_ID,
        range: 'Объекты!A:W',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [[
                '', // Номер объекта
                data.extraData?.objectName || '',
                data.extraData?.company || '',
                '', // Тип объекта
                '', // Комментарий
                data.extraData?.address || '',
                data.manager.name,
                new Date().toLocaleString('ru-RU', { month: 'long' }),
                'КП выдано', 
                '', // Месяц заказа
                '', // Сумма заказа
                'Да', // КП выдано
                data.cpName,
                data.total,
                '', // Реализация
                '',
                equipMain,
                equipExtra,
                data.manager.phone,
                '', '', '', ''
            ]]
        }
    });
  } catch (e) {
    console.error('Audit failure', e);
  }

  return presentationId;
}
