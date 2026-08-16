import fetch from 'node-fetch';

async function testApi() {
  const data = {
    manager: { name: 'Test', phone: '123', email: 'test@test.com' },
    cpName: 'CP-123',
    items: [
      { id: '1', productId: 'p1', name: 'Item 1', model: 'M1', quantity: 1, price: 100, image: '/images/products/v8i_pro.png' }
    ],
    total: 100
  };

  try {
    const response = await fetch('http://localhost:3000/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    console.log('Status:', response.status);
    const text = await response.text();
    console.log('Response Body:', text);
  } catch (err) {
    console.error('Fetch Error:', err.message);
  }
}

testApi();
