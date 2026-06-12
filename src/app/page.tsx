'use client'

import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import { Plus, Trash2, FileText, User, Briefcase, Calculator, Search, RefreshCw, Building2, Phone, CheckCircle, CloudCheck, Loader2, Copy } from 'lucide-react'
import productsData from '@/data/products.json'

interface Item { id: string; productId: string; quantity: number }

export interface AdditionalItem {
  id: string;
  name: string;
  quantity: string;
  price: number;
}

export function parseQuantity(qtyStr: string | number): number {
  if (typeof qtyStr === 'number') return qtyStr;
  if (!qtyStr) return 1;
  const match = qtyStr.match(/[\d.,]+/);
  if (!match) return 1;
  const num = parseFloat(match[0].replace(',', '.'));
  return isNaN(num) ? 1 : num;
}

const AdditionalRow = memo(({ item, onUpdate, onDelete, onClone, calculatePrice, currencyLabel }: any) => {
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(item.quantity);
  const [price, setPrice] = useState(item.price);

  useEffect(() => { setName(item.name); }, [item.name]);
  useEffect(() => { setQty(item.quantity); }, [item.quantity]);
  useEffect(() => { setPrice(item.price); }, [item.price]);

  const parsedQty = parseQuantity(qty);
  const calculatedSum = calculatePrice(price) * parsedQty;

  return (
    <tr>
      <td data-label="Наименование">
        <input 
          className="model-search-input" 
          type="text" 
          value={name} 
          placeholder="Например: Установка кондиционеров"
          onChange={e => setName(e.target.value)}
          onBlur={() => name !== item.name && onUpdate(item.id, { name })}
          style={{ width: '100%', minWidth: '200px' }}
        />
      </td>
      <td data-label="Кол-во" style={{ textAlign: 'center' }}>
        <input 
          className="qty-input" 
          type="text" 
          value={qty} 
          placeholder="работа"
          onChange={e => setQty(e.target.value)}
          onBlur={() => qty !== item.quantity && onUpdate(item.id, { quantity: qty })}
          style={{ width: '100%', minWidth: '80px', textAlign: 'center' }}
        />
      </td>
      <td data-label="Цена" style={{ textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          <input 
            className="qty-input" 
            type="number" 
            min="0"
            value={price} 
            onChange={e => setPrice(Number(e.target.value) || 0)}
            onBlur={() => price !== item.price && onUpdate(item.id, { price })}
            style={{ width: '80px', textAlign: 'center' }}
          />
          <span className="price-unit">{currencyLabel}</span>
        </div>
      </td>
      <td data-label="Сумма" style={{ textAlign: 'right' }}>
        <span className="sum">{calculatedSum.toLocaleString()}</span>
      </td>
      <td style={{ textAlign: 'right' }}>
        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', alignItems: 'center' }}>
          <button 
            className="btn-danger" 
            style={{ background: 'transparent', color: 'var(--text-muted)', padding: '0.4rem' }}
            onClick={() => onClone(item.id)} 
            title="Дублировать строку"
          >
            <Copy size={14} />
          </button>
          <button className="btn-danger" onClick={() => onDelete(item.id)} title="Удалить строку">
            <Trash2 size={15} />
          </button>
        </div>
      </td>
    </tr>
  );
});

// --- Sub-components with Local Buffering ---

const SectionHeader = memo(({ icon: Icon, title, color, tag }: any) => (
  <div className="section-header">
    <div className={`section-icon ${color}`}><Icon size={15} /></div>
    <h2>{title}</h2>
    {tag && <span className="tag">{tag}</span>}
  </div>
))

const ManagerSection = memo(({ data, onChange }: any) => {
  const [local, setLocal] = useState(data);
  useEffect(() => { setLocal(data); }, [data]);
  const blur = () => { if (JSON.stringify(local) !== JSON.stringify(data)) onChange(local); };

  return (
    <div className="section">
      <SectionHeader icon={User} title="Менеджер" color="purple" />
      <div className="field">
        <label className="field-label">ФИО</label>
        <input className="field-input" placeholder="Иванов Иван" 
          value={local.name} 
          onChange={e => setLocal({ ...local, name: e.target.value })} 
          onBlur={blur}
        />
      </div>
      <div className="row cols-2">
        <div className="field">
          <label className="field-label">Телефон</label>
          <input className="field-input" placeholder="+998" 
            value={local.phone} 
            onChange={e => setLocal({ ...local, phone: e.target.value })} 
            onBlur={blur}
          />
        </div>
        <div className="field">
          <label className="field-label">Email</label>
          <input className="field-input" type="email" placeholder="name@umbt.uz" 
            value={local.email} 
            onChange={e => setLocal({ ...local, email: e.target.value })} 
            onBlur={blur}
          />
        </div>
      </div>
    </div>
  );
});

const SettingsSection = memo(({ cpName, setCpName, equipmentType, setEquipmentType, options, setOptions }: any) => {
  const [lCp, setLCp] = useState(cpName);
  const [lEq, setLEq] = useState(equipmentType);
  const [lRate, setLRate] = useState(options.exchangeRate);
  const [lFee, setLFee] = useState(options.transferFee);

  useEffect(() => { setLCp(cpName); }, [cpName]);
  useEffect(() => { setLEq(equipmentType); }, [equipmentType]);
  useEffect(() => { setLRate(options.exchangeRate); }, [options.exchangeRate]);
  useEffect(() => { setLFee(options.transferFee); }, [options.transferFee]);

  return (
    <div className="section">
      <SectionHeader icon={Briefcase} title="Настройки КП" color="blue" />
      <div className="row cols-2">
        <div className="field">
          <label className="field-label">Номер КП</label>
          <input className="field-input" value={lCp} onChange={e => setLCp(e.target.value)} onBlur={() => lCp !== cpName && setCpName(lCp)} />
        </div>
        <div className="field">
          <label className="field-label">Тип оборудования</label>
          <input className="field-input" placeholder="VRF / Чиллер" value={lEq} onChange={e => setLEq(e.target.value)} onBlur={() => lEq !== equipmentType && setEquipmentType(lEq)} />
        </div>
      </div>
      <div className="row cols-3" style={{ marginTop: '0.5rem' }}>
        <div className="field">
          <label className="field-label">Фото</label>
          <div className="toggle-group">
            <button className={options.showImages ? 'on' : ''} onClick={() => setOptions({ ...options, showImages: true })}>Да</button>
            <button className={!options.showImages ? 'on' : ''} onClick={() => setOptions({ ...options, showImages: false })}>Нет</button>
          </div>
        </div>
        <div className="field">
          <label className="field-label">Валюта</label>
          <div className="toggle-group">
            <button className={options.currency === 'ue' ? 'on' : ''} onClick={() => setOptions({ ...options, currency: 'ue' })}>у.е.</button>
            <button className={options.currency === 'sum' ? 'on' : ''} onClick={() => setOptions({ ...options, currency: 'sum' })}>UZS</button>
          </div>
        </div>
        <div className="field">
          <label className="field-label">Оплата</label>
          <div className="toggle-group">
            <button className={options.paymentType === 'cash' ? 'on' : ''} onClick={() => setOptions({ ...options, paymentType: 'cash' })}>Нал</button>
            <button className={options.paymentType === 'transfer' ? 'on' : ''} onClick={() => setOptions({ ...options, paymentType: 'transfer' })}>Безнал</button>
          </div>
        </div>
      </div>
      {options.paymentType === 'transfer' && (
        <div className="transfer-box" style={{ opacity: 1, marginTop: '1rem' }}>
          <div className="row cols-2">
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">Курс (1 у.е.)</label>
              <input className="field-input" type="number" value={lRate} onChange={e => setLRate(Number(e.target.value))} onBlur={() => lRate !== options.exchangeRate && setOptions({ ...options, exchangeRate: lRate })} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">Накрутка %</label>
              <input className="field-input" type="number" value={lFee} onChange={e => setLFee(Number(e.target.value))} onBlur={() => lFee !== options.transferFee && setOptions({ ...options, transferFee: lFee })} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

const ObjectSection = memo(({ client, setClient, company, setCompany, objectType, setObjectType, registrationDate, setRegistrationDate, address, setAddress }: any) => {
  const [lCli, setLCli] = useState(client);
  const [lCom, setLCom] = useState(company);
  const [lObj, setLObj] = useState(objectType);
  const [lReg, setLReg] = useState(registrationDate);
  const [lAdr, setLAdr] = useState(address);

  useEffect(() => { setLCli(client); }, [client]);
  useEffect(() => { setLCom(company); }, [company]);
  useEffect(() => { setLObj(objectType); }, [objectType]);
  useEffect(() => { setLReg(registrationDate); }, [registrationDate]);
  useEffect(() => { setLAdr(address); }, [address]);

  return (
    <div className="section">
      <SectionHeader icon={Building2} title="Объект" color="green" />
      <div className="row cols-4">
        <div className="field">
          <label className="field-label">Название</label>
          <input className="field-input" placeholder="ЖК 'Tashkent City'" value={lCli} onChange={e => setLCli(e.target.value)} onBlur={() => lCli !== client && setClient(lCli)} />
        </div>
        <div className="field">
          <label className="field-label">Компания</label>
          <input className="field-input" placeholder="ООО 'ST-STROY'" value={lCom} onChange={e => setLCom(e.target.value)} onBlur={() => lCom !== company && setCompany(lCom)} />
        </div>
        <div className="field">
          <label className="field-label">Тип</label>
          <input className="field-input" placeholder="БЦ / ЖК / Завод" value={lObj} onChange={e => setLObj(e.target.value)} onBlur={() => lObj !== objectType && setObjectType(lObj)} />
        </div>
        <div className="field">
          <label className="field-label">Дата регистрации</label>
          <input className="field-input" type="date" value={lReg} onChange={e => setLReg(e.target.value)} onBlur={() => lReg !== registrationDate && setRegistrationDate(lReg)} />
        </div>
      </div>
      <div className="field" style={{ marginTop: '0.25rem' }}>
        <label className="field-label">Адрес</label>
        <input className="field-input" placeholder="г. Ташкент, ул. Навои, 12" value={lAdr} onChange={e => setLAdr(e.target.value)} onBlur={() => lAdr !== address && setAddress(lAdr)} />
      </div>
    </div>
  );
});

const ContactSection = memo(({ data, onChange }: any) => {
  const [local, setLocal] = useState(data);
  useEffect(() => { setLocal(data); }, [data]);
  const blur = () => { if (JSON.stringify(local) !== JSON.stringify(data)) onChange(local); };

  return (
    <div className="section">
      <SectionHeader icon={Phone} title="Контактное лицо" color="orange" />
      <div className="row cols-3">
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label">ФИО</label>
          <input className="field-input" placeholder="Петров Пётр" value={local.name} onChange={e => setLocal({ ...local, name: e.target.value })} onBlur={blur} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label">Телефон</label>
          <input className="field-input" placeholder="+998 90 123 45 67" value={local.phone} onChange={e => setLocal({ ...local, phone: e.target.value })} onBlur={blur} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label">Должность</label>
          <input className="field-input" placeholder="Главный инженер" value={local.position} onChange={e => setLocal({ ...local, position: e.target.value })} onBlur={blur} />
        </div>
      </div>
    </div>
  );
});

const ModelSearchSelector = memo(({ value, onChange, cleanProducts }: { value: string, onChange: (val: string) => void, cleanProducts: any[] }) => {
  const currentProduct = cleanProducts.find((p: any) => p.id === value);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  
  useEffect(() => {
    if (currentProduct) {
      setQuery(currentProduct.model);
    }
  }, [currentProduct]);

  const filtered = useMemo(() => {
    if (!query) return cleanProducts.slice(0, 50);
    const q = query.toLowerCase();
    return cleanProducts.filter((p: any) => 
      p.model.toLowerCase().includes(q) || 
      (p.series || '').toLowerCase().includes(q) || 
      (p.category || '').toLowerCase().includes(q)
    ).slice(0, 50);
  }, [query, cleanProducts]);

  return (
    <div className="model-selector-container" style={{ position: 'relative' }}>
      <input 
        className="model-search-input"
        type="text" 
        value={query}
        onChange={e => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          setIsOpen(true);
          setQuery('');
        }}
        onBlur={() => {
          setTimeout(() => {
            setIsOpen(false);
            if (currentProduct) {
              setQuery(currentProduct.model);
            }
          }, 200);
        }}
        placeholder="Поиск модели..."
        style={{ paddingRight: '2.2rem' }}
      />
      {currentProduct && !isOpen && (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(currentProduct.model);
          }}
          title="Копировать название модели"
          style={{
            position: 'absolute',
            right: '0.4rem',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            padding: '4px',
            borderRadius: '4px',
            transition: 'all 0.15s'
          }}
          onMouseOver={(e) => e.currentTarget.style.color = 'var(--accent)'}
          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          <Copy size={13} />
        </button>
      )}
      {isOpen && (
        <div className="model-selector-dropdown">
          {filtered.length === 0 ? (
            <div className="dropdown-no-results">Ничего не найдено</div>
          ) : (
            filtered.map((p: any) => (
              <div 
                key={p.id} 
                className="dropdown-item"
                onMouseDown={() => {
                  onChange(p.id);
                  setQuery(p.model);
                  setIsOpen(false);
                }}
              >
                <div className="dropdown-item-model">{p.model}</div>
                <div className="dropdown-item-meta">{p.series || p.category}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
});

const EquipmentRow = memo(({ item, products, cleanProducts, onUpdate, onDelete, onClone, calculatePrice, currencyLabel }: any) => {
  const p = products.find((x: any) => x.id === item.productId);
  const [qty, setQty] = useState<number | string>(item.quantity);
  useEffect(() => { setQty(item.quantity); }, [item.quantity]);

  return (
    <tr>
      <td data-label="Модель">
        <ModelSearchSelector value={item.productId} onChange={val => onUpdate(item.id, { productId: val })} cleanProducts={cleanProducts} />
        <div className="cat-label">{p?.series || p?.category}</div>
      </td>
      <td data-label="Цена" style={{ textAlign: 'center' }}>
        <span className="price">{calculatePrice(p?.price || 0).toLocaleString()}</span>
        <span className="price-unit">{currencyLabel}</span>
      </td>
      <td data-label="Кол-во" style={{ textAlign: 'center' }}>
        <input className="qty-input" type="number" min="1" 
          value={qty} 
          onChange={e => {
            const val = e.target.value;
            setQty(val === '' ? '' : (parseInt(val) || 0));
          }} 
          onFocus={e => {
            if (Number(qty) === 0) {
              setQty('');
            } else {
              e.target.select();
            }
          }}
          onBlur={() => {
            const finalQty = qty === '' ? 1 : Number(qty);
            setQty(finalQty);
            if (finalQty !== item.quantity) {
              onUpdate(item.id, { quantity: finalQty });
            }
          }}
        />
      </td>
      <td data-label="Сумма" style={{ textAlign: 'right' }}>
        <span className="sum">{(p ? calculatePrice(p.price) * (Number(qty) || 0) : 0).toLocaleString()}</span>
      </td>
      <td style={{ textAlign: 'right' }}>
        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', alignItems: 'center' }}>
          <button 
            className="btn-danger" 
            style={{ background: 'transparent', color: 'var(--text-muted)', padding: '0.4rem' }}
            onClick={() => onClone(item.id)} 
            title="Дублировать строку"
          >
            <Copy size={14} />
          </button>
          <button className="btn-danger" onClick={() => onDelete(item.id)} title="Удалить строку">
            <Trash2 size={15} />
          </button>
        </div>
      </td>
    </tr>
  );
});

export default function Home() {
  const [manager, setManager] = useState({ name: '', phone: '', email: '' })
  const [client, setClient] = useState('')
  const [company, setCompany] = useState('')
  const [address, setAddress] = useState('')
  const [cpName, setCpName] = useState('')
  const [objectType, setObjectType] = useState('')
  const [registrationDate, setRegistrationDate] = useState('')
  const [equipmentType, setEquipmentType] = useState('')
  const [contactPerson, setContactPerson] = useState({ name: '', phone: '', position: '' })
  const [items, setItems] = useState<Item[]>([])
  const [additionalItems, setAdditionalItems] = useState<AdditionalItem[]>([])
  const [partnerBonusType, setPartnerBonusType] = useState<'percent' | 'fixed'>('percent')
  const [partnerBonusValue, setPartnerBonusValue] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [products, setProducts] = useState<any[]>(productsData)
  const [isMounted, setIsMounted] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  const [options, setOptions] = useState({
    showImages: true,
    currency: 'ue',
    paymentType: 'cash',
    exchangeRate: 12800,
    transferFee: 10
  })

  const uid = useCallback(() => Math.random().toString(36).substr(2, 9), [])

  // --- Initial Load ---
  useEffect(() => {
    const s = (k: string) => localStorage.getItem(k)
    try {
      const m = s('umbt_manager'); if (m) setManager(JSON.parse(m))
      if (s('umbt_client')) setClient(s('umbt_client')!)
      if (s('umbt_company')) setCompany(s('umbt_company')!)
      if (s('umbt_address')) setAddress(s('umbt_address')!)
      if (s('umbt_objectType')) setObjectType(s('umbt_objectType')!)
      if (s('umbt_regDate')) {
        let val = s('umbt_regDate')!;
        if (val && val.length === 7 && val.includes('-')) {
          val = `${val}-01`;
        }
        setRegistrationDate(val);
      }
      if (s('umbt_equipType')) setEquipmentType(s('umbt_equipType')!)
      const c = s('umbt_contact'); if (c) setContactPerson(JSON.parse(c))
      const it = s('umbt_items'); if (it) setItems(JSON.parse(it))
      else if (productsData.length > 0) setItems([{ id: uid(), productId: productsData[0].id, quantity: 1 }])
      const addIt = s('umbt_additional_items'); if (addIt) setAdditionalItems(JSON.parse(addIt))
      const savedOptions = s('umbt_options'); if (savedOptions) setOptions(JSON.parse(savedOptions))
      const prod = s('umbt_products'); if (prod) setProducts(JSON.parse(prod))
      const savedCp = s('umbt_cpName'); if (savedCp) setCpName(savedCp)
      if (s('umbt_bonusType')) setPartnerBonusType(s('umbt_bonusType') as 'percent' | 'fixed')
      if (s('umbt_bonusValue')) setPartnerBonusValue(Number(s('umbt_bonusValue')) || 0)
    } catch {}
    if (!s('umbt_cpName')) {
      const d = new Date()
      setCpName(`КП-${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\./g, '')}/01`)
    }

    const loadData = async () => {
      try {
        const res = await fetch('/api/products');
        const data = await res.json();
        if (data.success && data.products.length > 0) {
          setProducts(data.products);
          localStorage.setItem('umbt_products', JSON.stringify(data.products));
        }
      } catch (e) {
        console.error('Failed to load products from API:', e);
      }
    };

    loadData();
    setIsMounted(true)
  }, [uid])



  // --- Autosave ---
  useEffect(() => {
    if (!isMounted) return
    setSaveStatus('saving')
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('umbt_manager', JSON.stringify(manager))
        localStorage.setItem('umbt_client', client)
        localStorage.setItem('umbt_company', company)
        localStorage.setItem('umbt_address', address)
        localStorage.setItem('umbt_objectType', objectType)
        localStorage.setItem('umbt_regDate', registrationDate)
        localStorage.setItem('umbt_equipType', equipmentType)
        localStorage.setItem('umbt_contact', JSON.stringify(contactPerson))
        localStorage.setItem('umbt_items', JSON.stringify(items))
        localStorage.setItem('umbt_additional_items', JSON.stringify(additionalItems))
        localStorage.setItem('umbt_options', JSON.stringify(options))
        localStorage.setItem('umbt_products', JSON.stringify(products))
        localStorage.setItem('umbt_cpName', cpName)
        localStorage.setItem('umbt_bonusType', partnerBonusType)
        localStorage.setItem('umbt_bonusValue', partnerBonusValue.toString())
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch (e) { console.error(e) }
    }, 1000)
    return () => clearTimeout(timer)
  }, [manager, client, company, address, objectType, registrationDate, equipmentType, contactPerson, items, additionalItems, options, products, cpName, partnerBonusType, partnerBonusValue, isMounted])

  const cleanProducts = useMemo(() => products.filter(p => p.model && !p.model.startsWith('---') && p.id && !p.id.startsWith('---')), [products])
  const filteredProducts = useMemo(() => {
    if (!searchTerm) return cleanProducts.slice(0, 50)
    const t = searchTerm.toLowerCase()
    return cleanProducts.filter(p => p.model.toLowerCase().includes(t) || (p.series || '').toLowerCase().includes(t) || p.category.toLowerCase().includes(t)).slice(0, 100)
  }, [searchTerm, cleanProducts])

  const calculatePrice = useCallback((base: number) => {
    let p = base
    if (options.paymentType === 'transfer') p *= (1 + options.transferFee / 100)
    if (options.currency === 'sum') p *= options.exchangeRate
    return Math.round(p)
  }, [options])

  const equipmentTotal = useMemo(() => items.reduce((sum, item) => {
    const p = products.find(x => x.id === item.productId)
    return sum + (p ? calculatePrice(p.price) * item.quantity : 0)
  }, 0), [items, products, calculatePrice])

  const partnerBonusSum = useMemo(() => {
    if (partnerBonusType === 'percent') {
      return Math.round(equipmentTotal * (Number(partnerBonusValue) / 100));
    }
    return Number(partnerBonusValue) || 0;
  }, [equipmentTotal, partnerBonusType, partnerBonusValue]);

  const additionalTotal = useMemo(() => additionalItems.reduce((sum, item) => {
    const parsedQty = parseQuantity(item.quantity);
    return sum + calculatePrice(item.price) * parsedQty;
  }, 0), [additionalItems, calculatePrice]);

  const grandTotal = useMemo(() => {
    return equipmentTotal + additionalTotal;
  }, [equipmentTotal, additionalTotal]);

  const currencyLabel = options.currency === 'sum' ? 'сум' : 'у.е.'

  const updateItem = useCallback((id: string, updates: Partial<Item>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i))
  }, [])

  const deleteItem = useCallback((id: string) => {
    setItems(prev => prev.length > 1 ? prev.filter(i => i.id !== id) : prev)
  }, [])

  const cloneItem = useCallback((id: string) => {
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === id);
      if (idx === -1) return prev;
      const target = prev[idx];
      const newItem = { ...target, id: uid() };
      const copy = [...prev];
      copy.splice(idx + 1, 0, newItem);
      return copy;
    });
  }, [uid]);

  const updateAdditionalItem = useCallback((id: string, updates: Partial<AdditionalItem>) => {
    setAdditionalItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i))
  }, [])

  const deleteAdditionalItem = useCallback((id: string) => {
    setAdditionalItems(prev => prev.filter(i => i.id !== id))
  }, [])

  const cloneAdditionalItem = useCallback((id: string) => {
    setAdditionalItems(prev => {
      const idx = prev.findIndex(i => i.id === id);
      if (idx === -1) return prev;
      const target = prev[idx];
      const newItem = { ...target, id: uid() };
      const copy = [...prev];
      copy.splice(idx + 1, 0, newItem);
      return copy;
    });
  }, [uid]);

  const handleSync = async () => {
    setSyncing(true)
    try {
      const r = await fetch('/api/sync', { method: 'POST' }); const d = await r.json()
      if (d.success) { setProducts(d.products); setItems([]); alert('✅ База обновлена.'); }
      else alert('Ошибка: ' + d.error)
    } catch { alert('Ошибка сети') } finally { setSyncing(false) }
  }

  const handleGenerate = async () => {
    if (!manager.name || !client) { alert('Заполните ФИО менеджера и название объекта'); return }
    setLoading(true)
    try {
      const r = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          manager, 
          client, 
          cpName, 
          items: items.map(i => { 
            const p = products.find(x => x.id === i.productId); 
            return p ? { ...p, quantity: i.quantity } : null; 
          }).filter(Boolean), 
          additionalItems,
          equipmentTotal,
          partnerBonus: partnerBonusSum,
          additionalTotal,
          total: grandTotal, 
          extraData: { company, address, objectType, registrationDate, equipmentType, contactPerson }, 
          options 
        })
      })
      if (r.ok) { 
        const auditErr = r.headers.get('X-Audit-Error');
        if (auditErr) {
          alert('⚠️ PDF готов, но данные НЕ записаны в таблицу аудита!\nОшибка: ' + auditErr);
        }
        const b = await r.blob(); const url = URL.createObjectURL(b); setLastPdfUrl(url); const a = document.createElement('a'); a.href = url; a.download = `${cpName}.pdf`; a.click(); 
      }
      else { const e = await r.json(); alert(`Ошибка: ${e.error}`) }
    } catch { alert('Критическая ошибка') } finally { setLoading(false) }
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-brand">
            <img src="/images/branding/logo_umbt.jpg" alt="UMBT" />
            <span>KP Maker</span>
          </div>
          {saveStatus !== 'idle' && (
            <div className={`save-indicator ${saveStatus}`}>
              {saveStatus === 'saving' ? <><Loader2 size={12} className="spin" /> Сохранение...</> : <><CloudCheck size={12} /> Сохранено</>}
            </div>
          )}
          <div className="topbar-actions">
            <button className="btn btn-ghost" onClick={handleSync} disabled={syncing}>
              <RefreshCw size={14} className={syncing ? 'spin' : ''} />
              {syncing ? 'Обновление...' : 'Обновить базу'}
            </button>
            <button className="btn btn-ghost" onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; }}>
              Выйти
            </button>
          </div>
        </div>
      </header>

      <div className="page fade-in" style={{ opacity: isMounted ? 1 : 0 }}>
        <div className="cols-top">
          <ManagerSection data={manager} onChange={setManager} />
          <SettingsSection cpName={cpName} setCpName={setCpName} equipmentType={equipmentType} setEquipmentType={setEquipmentType} options={options} setOptions={setOptions} />
        </div>

        <ObjectSection client={client} setClient={setClient} company={company} setCompany={setCompany} objectType={objectType} setObjectType={setObjectType} registrationDate={registrationDate} setRegistrationDate={setRegistrationDate} address={address} setAddress={setAddress} />
        <ContactSection data={contactPerson} onChange={setContactPerson} />

        <div className="section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div className="section-icon pink"><Calculator size={15} /></div>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Оборудование</h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'var(--bg-input)', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>{items.length} поз.</span>
            </div>
            <button className="btn btn-primary" onClick={() => setItems([...items, { id: uid(), productId: products[0]?.id || '', quantity: 1 }])}>
              <Plus size={15} /> Добавить
            </button>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: '48%' }}>Модель</th>
                  <th style={{ width: '14%', textAlign: 'center' }}>Цена</th>
                  <th style={{ width: '10%', textAlign: 'center' }}>Кол-во</th>
                  <th style={{ width: '18%', textAlign: 'right' }}>Сумма</th>
                  <th style={{ width: '10%' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <EquipmentRow key={item.id} item={item} products={products} cleanProducts={cleanProducts} onUpdate={updateItem} onDelete={deleteItem} onClone={cloneItem} calculatePrice={calculatePrice} currencyLabel={currencyLabel} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="total-area" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
            <div className="total-bar" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
              <span className="total-label">Итого кондиционирование</span>
              <span className="total-value">{equipmentTotal.toLocaleString()}</span>
              <span className="total-currency">{currencyLabel}</span>
            </div>
            
            <div className="bonus-bar" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <span className="total-label" style={{ color: 'var(--text-secondary)', fontSize: '0.65rem' }}>Партнерский бонус (только кондиционеры)</span>
              <div className="toggle-group" style={{ width: 'auto', display: 'inline-flex', padding: '2px', border: '1px solid var(--border)' }}>
                <button className={partnerBonusType === 'percent' ? 'on' : ''} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setPartnerBonusType('percent')}>%</button>
                <button className={partnerBonusType === 'fixed' ? 'on' : ''} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setPartnerBonusType('fixed')}>{currencyLabel}</button>
              </div>
              <input 
                className="qty-input" 
                type="number" 
                min="0"
                value={partnerBonusValue}
                onChange={e => setPartnerBonusValue(Math.max(0, parseInt(e.target.value) || 0))}
                onFocus={e => e.target.select()}
                style={{ width: '80px', padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
              />
              <span className="bonus-sum-value" style={{ fontWeight: 600, color: 'var(--accent)', fontSize: '1.1rem' }}>
                - {partnerBonusSum.toLocaleString()} {currencyLabel}
              </span>
            </div>
            
            <div className="final-net-bar" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: '0.5rem', borderTop: '1px dashed var(--border)', paddingTop: '0.5rem' }}>
              <span className="total-label" style={{ fontSize: '0.65rem' }}>Раздел с кондиционированием за вычетом бонуса</span>
              <span className="total-value" style={{ fontSize: '1.3rem', color: 'var(--text-secondary)' }}>{(equipmentTotal - partnerBonusSum).toLocaleString()}</span>
              <span className="total-currency" style={{ fontSize: '0.85rem' }}>{currencyLabel}</span>
            </div>
          </div>
        </div>

        <div className="section" style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div className="section-icon orange"><Calculator size={15} /></div>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Дополнительный раздел</h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'var(--bg-input)', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>{additionalItems.length} поз.</span>
            </div>
            <button className="btn btn-primary" onClick={() => setAdditionalItems([...additionalItems, { id: uid(), name: '', quantity: '1', price: 0 }])}>
              <Plus size={15} /> Добавить
            </button>
          </div>
          {additionalItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Нет дополнительных позиций. Нажмите «Добавить», чтобы внести работы, монтаж или воздуховоды.
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: '48%' }}>Наименование</th>
                    <th style={{ width: '15%', textAlign: 'center' }}>Кол-во</th>
                    <th style={{ width: '17%', textAlign: 'center' }}>Цена</th>
                    <th style={{ width: '10%', textAlign: 'right' }}>Сумма</th>
                    <th style={{ width: '10%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {additionalItems.map(item => (
                    <AdditionalRow 
                      key={item.id} 
                      item={item} 
                      onUpdate={updateAdditionalItem} 
                      onDelete={deleteAdditionalItem} 
                      onClone={cloneAdditionalItem} 
                      calculatePrice={calculatePrice} 
                      currencyLabel={currencyLabel} 
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {additionalItems.length > 0 && (
            <div className="total-area" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <div className="total-bar" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
                <span className="total-label">Итого доп. раздел</span>
                <span className="total-value">{additionalTotal.toLocaleString()}</span>
                <span className="total-currency">{currencyLabel}</span>
              </div>
            </div>
          )}
        </div>

        <div className="section" style={{ marginTop: '1.5rem', border: '2px solid var(--accent)', background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Кондиционирование:</span>
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                {equipmentTotal.toLocaleString()} {currencyLabel}
              </span>
            </div>
            {additionalItems.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Дополнительный раздел:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                  {additionalTotal.toLocaleString()} {currencyLabel}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-main)' }}>ОБЩИЙ ИТОГ:</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent)' }}>
                  {grandTotal.toLocaleString()}
                </span>
                <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                  {currencyLabel}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="search-bar">
          <Search size={18} color="var(--text-muted)" />
          <input placeholder="Поиск по базе (модель, категория)..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        {searchTerm && (
          <div className="section" style={{ padding: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
            {filteredProducts.map(p => (
              <div key={p.id} className="search-item" onClick={() => { setItems([...items, { id: uid(), productId: p.id, quantity: 1 }]); setSearchTerm('') }}>
                <div className="si-model">{p.model}</div>
                <div className="si-meta">{p.series || p.category} · {calculatePrice(p.price).toLocaleString()} {currencyLabel}</div>
              </div>
            ))}
          </div>
        )}

        <div className="gen-wrap">
          {!lastPdfUrl ? (
            <button className="gen-btn" onClick={handleGenerate} disabled={loading}>
              {loading ? <RefreshCw className="spin" size={20} /> : <FileText size={20} />}
              {loading ? 'Генерация КП...' : 'Генерация PDF...'}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
              <button className="gen-btn" onClick={() => { const a = document.createElement('a'); a.href = lastPdfUrl; a.download = `${cpName}.pdf`; a.click(); }} style={{ background: 'var(--success)' }}>
                <CheckCircle size={20} /> Готово! Скачать КП
              </button>
              <button className="btn btn-ghost" onClick={() => setLastPdfUrl(null)} style={{ fontSize: '0.75rem' }}>Создать еще один</button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
