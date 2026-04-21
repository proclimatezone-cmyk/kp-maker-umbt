import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch'; 

async function runTest() {
    console.log('🚀 Starting QA Test with random data...');

    // Load actual products
    const productsPath = path.resolve('src/data/products.json');
    const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));

    // Filter valid products
    const validProducts = products.filter(p => p.model && !p.model.startsWith('---'));

    // Pick 3-5 random items
    const numItems = Math.floor(Math.random() * 3) + 3; // 3 to 5 items
    let items = [];
    let total = 0;

    console.log(`📦 Selecting ${numItems} random products...`);
    for (let i = 0; i < numItems; i++) {
        const p = validProducts[Math.floor(Math.random() * validProducts.length)];
        const qty = Math.floor(Math.random() * 5) + 1; // 1 to 5 quantity
        const actualImages = ['/images/products/v8i_pro.png', '/images/products/wall_mounted.png', '/images/products/fcu_duct.png', '/images/products/cassette_4way.png'];
        const pImage = (p.image === '/images/products/placeholder.png' || !p.image) ? actualImages[Math.floor(Math.random() * actualImages.length)] : p.image;
        
        items.push({
            category: p.category,
            series: p.series || p.category,
            model: p.model,
            quantity: qty,
            price: p.price,
            image: pImage
        });
        total += p.price * qty;
    }

    const randomNum = Math.floor(Math.random() * 9000) + 1000;
    const testData = {
        manager: {
            name: 'Рандомный Тест',
            phone: '+998 90 ' + Math.floor(1000000 + Math.random() * 9000000),
            email: `tester${randomNum}@umbt.uz`
        },
        cpName: `QA-RND-${randomNum}`,
        client: 'OOO "Случайный Заказ"',
        extraData: {
            objectName: `Тестовый Объект ${randomNum}`,
            company: 'QA Automation',
            address: `г. Ташкент, ул. Тестовая, ${Math.floor(Math.random() * 100)}`
        },
        items: items,
        total: total
    };

    console.log(`Отправка данных с ${items.length} товарами на сумму $${total}`);

    try {
        const response = await fetch('http://localhost:3000/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        });

        if (response.ok) {
            console.log('✅ Success! Server returned OK.');
            const contentType = response.headers.get('content-type');
            const presentationUrl = response.headers.get('x-presentation-url');
            if (presentationUrl) {
                console.log(`🔗 Link to Slide: ${presentationUrl}`);
            }
            
            if (contentType && contentType.includes('application/pdf')) {
                 const arrayBuffer = await response.arrayBuffer();
                 const buffer = Buffer.from(arrayBuffer);
                 const outName = `qa_test_result_rnd_${randomNum}.pdf`;
                 fs.writeFileSync(outName, buffer);
                 console.log(`💾 Saved PDF as ${outName}`);
            } else {
                 console.log('📑 Response was not a PDF file.');
                 console.log(await response.text());
            }
        } else {
            const errStr = await response.text();
            console.error('❌ API Error:', errStr);
        }
    } catch (err) {
        console.error('❌ Connection Error:', err.message);
        console.log('Убедитесь, что сервер включен (npm run dev)');
    }
}

runTest();
