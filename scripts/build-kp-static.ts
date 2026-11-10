/**
 * Одноразовая сборка статичных страниц КП (обложка без номера/даты + 2 страницы
 * о компании) из templates/kp-new.docx через Google Drive.
 * Запуск после правки шаблона:  set -a; . ./.env.local; npx tsx scripts/build-kp-static.ts
 */
import fs from 'fs'
import path from 'path'
import PizZip from 'pizzip'
import { PDFDocument } from 'pdf-lib'
import { convertDocxToPdf } from '../src/lib/docx-to-pdf'

const root = process.cwd()
const zip = new PizZip(fs.readFileSync(path.join(root, 'templates/kp-new.docx')))
let xml = zip.file('word/document.xml')!.asText()
xml = xml.replace(/<w:t>№ \{cp_number\}<\/w:t>/g, '<w:t></w:t>').replace(/<w:t>Дата: \{cp_date\}<\/w:t>/g, '<w:t></w:t>')
if (xml.includes('{cp_number}') || xml.includes('{cp_date}')) throw new Error('Номер/дата на обложке не найдены в ожидаемом виде')
// Таблица и всё после неё не нужны — обрезаем тело до разрыва страницы перед таблицей.
const tbl = xml.indexOf('<w:tbl>')
const sect = xml.lastIndexOf('<w:sectPr', xml.indexOf('</w:body>'))
xml = xml.slice(0, tbl) + '<w:p/>' + xml.slice(xml.indexOf('<w:sectPr', xml.indexOf('{#terms}')), xml.indexOf('</w:body>'))
  .replace(/^[\s\S]*?(<w:sectPr)/, '$1') + '</w:body></w:document>'
void sect
zip.file('word/document.xml', xml)
const docx = zip.generate({ type: 'nodebuffer' })
;(async () => {
  const pdf = await PDFDocument.load(await convertDocxToPdf(docx, 'kp-static'))
  const out = await PDFDocument.create()
  const pages = await out.copyPages(pdf, [0, 1, 2])
  pages.forEach(p => out.addPage(p))
  fs.writeFileSync(path.join(root, 'templates/kp-static.pdf'), await out.save())
  console.log('pages in source:', pdf.getPageCount(), '→ templates/kp-static.pdf')
})()
