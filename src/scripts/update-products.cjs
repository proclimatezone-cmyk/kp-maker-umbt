const fs = require('fs');
const path = require('path');

const rawData = [
  {
    category: "VRF Серия V8i PRO",
    name: "VRF серии V8i PRO наружный блок",
    image: "/images/products/v8i_pro.png",
    models: ["MV8i-252WV2GN1(MA)", "MV8i-280WV2GN1(MA)", "MV8i-335WV2GN1(MA)", "MV8i-400WV2GN1(MA)", "MV8i-450WV2GN1(MA)", "MV8i-500WV2GN1(MA)", "MV8i-560WV2GN1(MA)", "MV8i-615WV2GN1(MA)", "MV8i-670WV2GN1(MA)", "MV8i-730WV2GN1(MA)", "MV8i-785WV2GN1(MA)", "MV8i-850WV2GN1(MA)", "MV8i-900WV2GN1(MA)", "MV8i-950WV2GN1(MA)", "MV8i-1010WV2GN1(MA)", "MV8i-1060WV2GN1(MA)", "MV8i-1120WV2GN1(MA)", "MV8i-1170WV2GN1(MA)"]
  },
  {
    category: "VRF Серия V8 Easy Fit",
    name: "VRF серии V8 Easy Fit наружный блок",
    image: "/images/products/vrf_v8.png",
    models: ["MVi-252WV2GN1(B)", "MVi-280WV2GN1(B)", "MVi-335WV2GN1(B)", "MVi-400WV2GN1(A)", "MVi-450WV2GN1(A)", "MVi-500WV2GN1(A)", "MVi-560WV2GN1(A)", "MVi-615WV2GN1(A)", "MVi-670WV2GN1(A)"]
  },
  {
    category: "VRF Серия V8 Mini",
    name: "VRF серии V8 Mini наружный блок",
    image: "/images/products/vrf_v8.png",
    models: ["MV8M-100WV2HN1", "MV8M-140WV2HN1", "MV8M-160WV2HN1"]
  },
  {
    category: "VRF Настенные блоки",
    name: "VRF настенный блок",
    image: "/images/products/wall_mounted.png",
    models: ["MIH22GHN18", "MIH28GHN18", "MIH36GHN18", "MIH45GHN18", "MIH56GHN18", "MIH71GHN18", "MIH80GHN18"]
  },
  {
    category: "VRF V8 Канальные блоки",
    name: "VRF V8 канальный блок",
    image: "/images/products/fcu_duct.png",
    models: ["MIH22T2HN18", "MIH28T2HN18", "MIH36T2HN18", "MIH45T2HN18", "MIH56T2HN18", "MIH71T2HN18", "MIH80T2HN18", "MIH90T2HN18", "MIH112T2HN18", "MIH125T2HN18", "MIH140T2HN18", "MIH160T2HN18"]
  },
  {
    category: "VRF V8 Кассетные 4-х поточные",
    name: "VRF V8 кассетный 4-х поточный блок",
    image: "/images/products/cassette_4way.png",
    models: ["MIH28Q4HN18", "MIH36Q4HN18", "MIH45Q4HN18", "MIH56Q4HN18", "MIH71Q4HN18", "MIH80Q4HN18", "MIH90Q4HN18", "MIH100Q4HN18", "MIH112Q4HN18", "MIH140Q4HN18", "MIH160Q4HN18", "MIH180Q4HN18"]
  },
  {
    category: "ATOM Серия",
    name: "VRF серии ATOM наружный блок",
    image: "/images/products/vrf_v8.png",
    models: ["MDV-V28WDHN1(AtB)", "MDV-V36WDHN1A(AtB)", "MDV-V42WDHN1A(AtB)", "MDV-V48WDHN1(AtB)", "MDV-V56WDHN1(AtB)", "MDV-V60WDHN1(AtB)", "MDV-V68WDHN1(AtB)"]
  },
  {
    category: "Чиллеры",
    name: "Чиллер",
    image: "/images/products/chiller_kingplus.png",
    models: ["MC-SS260-RN1TL", "MC-SU75-RN8L-B", "MC-SU140-RN8L-B"]
  },
  {
    category: "Фанкойлы Канальные",
    name: "Канальный фанкойл",
    image: "/images/products/fcu_duct.png",
    models: ["MKT3-200G50-CR", "MKT3-300G50-CR", "MKT3-400G50-CR", "MKT3-500G50-CR", "MKT3-600G50-CR", "MKT3-700G50-CR", "MKT3-800G50-CR", "MKT3-1000G50-CR", "MKT3-1200G50-CR", "MKT3-1400G50-CR"]
  },
  {
    category: "Аксессуары",
    name: "Аксессуар",
    image: "/images/products/controller.png",
    models: ["T-MBQ4-02E1", "T-MBQ4-01F", "WDC3-86S", "WDC3-86T (white)", "GW3-MOD", "TC3-7", "TC3-10.1", "MIA-RK"]
  }
];

const products = [];
rawData.forEach(cat => {
  cat.models.forEach(model => {
    products.push({
      id: model.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      category: cat.category,
      name: cat.name,
      model: model,
      price: 0, // Default price 0 as per request
      image: cat.image,
      specs: ""
    });
  });
});

fs.writeFileSync(path.join(__dirname, '..', 'data', 'products.json'), JSON.stringify(products, null, 2));
console.log('Updated products.json with', products.length, 'items.');
