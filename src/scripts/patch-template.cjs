const fs = require('fs');
const path = require('path');

const xmlPath = path.join(__dirname, '..', '..', 'original_extracted', 'word', 'document.xml');
let xml = fs.readFileSync(xmlPath, 'utf8');

console.log('Original length:', xml.length);

// 1. Patch CP Title and Date
// <w:t xml:space="preserve">Коммерческое предложение </w:t></w:r><w:r w:rsidR="00862ACE"><w:rPr>...<w:t>0303</w:t></w:r>...
// This is messy in XML because Word splits text into multiple <w:r> tags.
// We'll use a broad RegEx to find the sequence and replace it with a single <w:r> containing our tag.

// Patch "Коммерческое предложение" number
// We look for the pattern of the digits 030326/01 split by tags
xml = xml.replace(/Коммерческое предложение <\/w:t>.*?<w:t>.*?0303<\/w:t>.*?<w:t>26<\/w:t>.*?<w:t>\/0<\/w:t>.*?<w:t>1<\/w:t>/g, 'Коммерческое предложение {cp_number}');

// Patch "Дата"
xml = xml.replace(/Дата <\/w:t>.*?<w:t>03<\/w:t>.*?<w:t>\.<\/w:t>.*?<w:t>0<\/w:t>.*?<w:t>3<\/w:t>.*?<w:t>\.202<\/w:t>.*?<w:t>6<\/w:t>/g, 'Дата {date}');

// 2. Patch Table Rows
// We need to find the rows starting with MVi-252WV2GN1(B) and AHUKZ-02D.
// Each row is wrapped in <w:tr>...</w:tr>

// Rough RegEx to find the data rows in the table. 
// We want to replace the sequence of TWO <w:tr> tags with a single loop.
const rowRegex = /<w:tr [^>]*?>.*?MVi-252WV2GN1\(B\).*?<\/w:tr>.*?<w:tr [^>]*?>.*?AHUKZ-02D.*?<\/w:tr>/s;

const newRowXml = `
{#items}
<w:tr>
  <w:tc>
    <w:p><w:r><w:t>{image_tag}</w:t></w:r></w:p>
  </w:tc>
  <w:tc>
    <w:p><w:r><w:t>{name}</w:t></w:r></w:p>
  </w:tc>
  <w:tc>
    <w:p><w:r><w:t>{model}</w:t></w:r></w:p>
  </w:tc>
  <w:tc>
    <w:p><w:r><w:t>{quantity}</w:t></w:r></w:p>
  </w:tc>
  <w:tc>
    <w:p><w:r><w:t>{price}</w:t></w:r></w:p>
  </w:tc>
  <w:tc>
    <w:p><w:r><w:t>{sum}</w:t></w:r></w:p>
  </w:tc>
</w:tr>
{/items}
`;

// Note: The simple replacement above might break Word's strict XML if styles/formatting are lost.
// Better to find the exact row tags and wrap them.
// But for this automated task, let's try a direct replacement of the known content.
// Actually, I'll just look for the MVi row and replace it with tags.

xml = xml.replace(/<w:tr [^>]*?>.*?MVi-252WV2GN1\(B\).*?<\/w:tr>/s, 
`{#items}<w:tr><w:tc><w:p><w:r><w:t>{%image_tag}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{name}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{model}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{quantity}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{price}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{sum}</w:t></w:r></w:p></w:tc></w:tr>{/items}`);

// ... (previous replacements)

// 3. Patch Manager Info at the bottom
// We look for the last paragraph about "Срок действия предложения" and add manager info after it
const managerXml = `
<w:p><w:pPr><w:jc w:val="right"/></w:pPr></w:p>
<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Менеджер: {manager_name}</w:t></w:r></w:p>
<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Телефон: {manager_phone}</w:t></w:r></w:p>
<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Email: {manager_email}</w:t></w:r></w:p>
`;

xml = xml.replace('</w:body>', managerXml + '</w:body>');

fs.writeFileSync(xmlPath, xml);
console.log('Patched XML saved with Manager Info.');
console.log('New length:', xml.length);
