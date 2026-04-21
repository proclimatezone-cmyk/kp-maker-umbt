'use client'

import { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2, FileText, Download, User, Briefcase, Calculator, Search, RefreshCw, CheckCircle2 } from 'lucide-react'
import productsData from '@/data/products.json'

interface Item {
  id: string
  productId: string
  quantity: number
}

export default function Home() {
  const [manager, setManager] = useState({ name: '', phone: '', email: '' })
  const [client, setClient] = useState('')
  const [company, setCompany] = useState('')
  const [address, setAddress] = useState('')
  const [cpName, setCpName] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [showImages, setShowImages] = useState(true)
  const [currency, setCurrency] = useState('ue')
  const [paymentType, setPaymentType] = useState('cash')
  const [exchangeRate, setExchangeRate] = useState(12800)
  const [transferFee, setTransferFee] = useState(10)

  // Load persistence
  useEffect(() => {
    const savedManager = localStorage.getItem('umbt_manager')
    if (savedManager) setManager(JSON.parse(savedManager))
    
    // Default CP Name based on date
    const date = new Date()
    const dateStr = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\./g, '')
    setCpName(`КП-${dateStr}/01`)

    // Initial item
    setItems([{ id: Math.random().toString(36).substr(2, 9), productId: productsData[0].id, quantity: 1 }])
  }, [])

  // Save persistence
  useEffect(() => {
    localStorage.setItem('umbt_manager', JSON.stringify(manager))
  }, [manager])

  // Memoized and cleaned products data
  const cleanProducts = useMemo(() => {
    return productsData.filter(p => 
      p.model && 
      !p.model.startsWith('---') && 
      p.id && 
      !p.id.startsWith('---')
    )
  }, [])

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return cleanProducts.slice(0, 50)
    const term = searchTerm.toLowerCase()
    return cleanProducts.filter(p => 
      p.model.toLowerCase().includes(term) || 
      p.name.toLowerCase().includes(term) || 
      p.category.toLowerCase().includes(term)
    ).slice(0, 100)
  }, [searchTerm, cleanProducts])

  const getAdjustedPrice = (basePrice: number) => {
    let p = basePrice;
    if (paymentType === 'transfer') p = p * (1 + transferFee / 100);
    if (currency === 'sum') p = p * exchangeRate;
    return Math.round(p);
  }

  const addItem = () => {
    setItems([...items, { id: Math.random().toString(36).substr(2, 9), productId: productsData[0].id, quantity: 1 }])
  }

  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter(item => item.id !== id))
    }
  }

  const updateItem = (id: string, field: keyof Item, value: any) => {
    setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item))
  }

  const calculateTotal = () => {
    return items.reduce((total, item) => {
      const product = productsData.find(p => p.id === item.productId)
      return total + (product ? getAdjustedPrice(product.price) * item.quantity : 0)
    }, 0)
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      if (res.ok) alert('База данных успешно обновлена!')
      else alert('Ошибка при синхронизации')
    } catch (e) {
      alert('Ошибка сети')
    } finally {
      setSyncing(false)
    }
  }

  const handleGenerate = async () => {
    if (!manager.name || !client) {
      alert('Пожалуйста, заполните ФИО менеджера и название объекта/клиента.')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manager,
          client,
          cpName,
          items: items.map(item => ({
            ...productsData.find(p => p.id === item.productId),
            quantity: item.quantity
          })),
          total: calculateTotal(),
          extraData: { company, address }, options: { showImages, currency, paymentType, exchangeRate, transferFee }
        })
      })

      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${cpName}.pdf`
        a.click()
      } else {
        const errorData = await response.json()
        alert(`Ошибка: ${errorData.error}`)
      }
    } catch (error) {
      alert('Произошла критическая ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="animate-in">
      <header className="header">
        <div className="container nav">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <img src="/logo.png" alt="UMBT Logo" className="logo" />
            <span style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--primary)', letterSpacing: '0.05em' }}>UMBT CP MAKER</span>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button className="btn btn-outline" onClick={handleSync} disabled={syncing}>
              <RefreshCw size={16} className={syncing ? 'spin' : ''} /> 
              {syncing ? 'Обновление...' : 'Обновить базу'}
            </button>
            <div className="btn btn-outline" style={{ fontSize: '0.875rem' }}>v1.1.0</div>
          </div>
        </div>
      </header>

      <div className="container" style={{ marginTop: '3rem', paddingBottom: '5rem' }}>
        <div className="grid grid-cols-2">
          {/* Manager Info */}
          <section className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div style={{ background: 'var(--primary-light)', padding: '0.5rem', borderRadius: '0.5rem' }}>
                <User size={20} color="var(--primary)" />
              </div>
              <h2 style={{ fontSize: '1.25rem' }}>Менеджер (Автосохранение)</h2>
            </div>
            <div className="form-group">
              <label className="label">ФИО Менеджера</label>
              <input 
                type="text" 
                className="input" 
                placeholder="Иванов Иван Иванович" 
                value={manager.name}
                onChange={e => setManager({...manager, name: e.target.value})}
              />
            </div>
            <div className="grid grid-cols-2">
              <div className="form-group">
                <label className="label">Телефон</label>
                <input 
                  type="text" 
                  className="input" 
                  placeholder="+998" 
                  value={manager.phone}
                  onChange={e => setManager({...manager, phone: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label className="label">Email</label>
                <input 
                  type="email" 
                  className="input" 
                  placeholder="manager@umbt.uz" 
                  value={manager.email}
                  onChange={e => setManager({...manager, email: e.target.value})}
                />
              </div>
            </div>
          </section>

          {/* CP Config */}
          <section className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div style={{ background: 'var(--primary-light)', padding: '0.5rem', borderRadius: '0.5rem' }}>
                <Briefcase size={20} color="var(--primary)" />
              </div>
              <h2 style={{ fontSize: '1.25rem' }}>Настройки документа</h2>
            </div>
            <div className="grid grid-cols-2">
              <div className="form-group">
                <label className="label">Номер КП</label>
                <input 
                  type="text" 
                  className="input" 
                  value={cpName}
                  onChange={e => setCpName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="label">Название объекта</label>
                <input 
                  type="text" 
                  className="input" 
                  placeholder="ЖК 'Tashkent City'" 
                  value={client}
                  onChange={e => setClient(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="label">Компания заявитель</label>
              <input 
                type="text" 
                className="input" 
                placeholder="ООО 'ST-STROY'" 
                value={company}
                onChange={e => setCompany(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="label">Адрес объекта</label>
              <input 
                type="text" 
                className="input" 
                placeholder="г. Ташкент, ул. Навои..." 
                value={address}
                onChange={e => setAddress(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2" style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem', gap: '1.5rem' }}>
              <div>
                 <label className="label">Фото в документе</label>
                 <div className="segmented-control">
                    <button className={showImages ? 'active' : ''} onClick={() => setShowImages(true)}>Показывать</button>
                    <button className={!showImages ? 'active' : ''} onClick={() => setShowImages(false)}>Скрыть</button>
                 </div>
              </div>
              <div>
                 <label className="label">Валюта КП</label>
                 <div className="segmented-control">
                    <button className={currency === 'ue' ? 'active' : ''} onClick={() => setCurrency('ue')}>у.е. (USD)</button>
                    <button className={currency === 'sum' ? 'active' : ''} onClick={() => setCurrency('sum')}>UZS (Сум)</button>
                 </div>
              </div>
            </div>

            <div className="grid grid-cols-2" style={{ marginTop: '1.5rem', gap: '1.5rem' }}>
              <div>
                 <label className="label">Форма оплаты</label>
                 <div className="segmented-control">
                    <button className={paymentType === 'cash' ? 'active' : ''} onClick={() => setPaymentType('cash')}>Наличная</button>
                    <button className={paymentType === 'transfer' ? 'active' : ''} onClick={() => setPaymentType('transfer')}>Перечисление</button>
                 </div>
              </div>
            </div>

            {paymentType === 'transfer' && (
               <div className="grid grid-cols-2 animate-in" style={{ marginTop: '1.5rem', gap: '1.5rem', background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '1rem', border: '1px dashed var(--border)' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="label">Курс (1 у.е. = сум)</label>
                    <input type="number" className="input" value={exchangeRate} onChange={e => setExchangeRate(Number(e.target.value))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="label">Накрутка на безн. (%)</label>
                    <input type="number" className="input" value={transferFee} onChange={e => setTransferFee(Number(e.target.value))} />
                  </div>
               </div>
            )}
            </section>
        </div>

        {/* Calculator Table */}
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ background: 'var(--primary-light)', padding: '0.5rem', borderRadius: '0.5rem' }}>
                <Calculator size={20} color="var(--primary)" />
              </div>
              <h2 style={{ fontSize: '1.25rem' }}>Калькулятор оборудования</h2>
            </div>
            <button className="btn btn-primary" onClick={addItem}>
              <Plus size={18} /> Добавить позицию
            </button>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '45%' }}>Оборудование (Поиск снизу)</th>
                  <th style={{ width: '15%', textAlign: 'center' }}>{currency === 'sum' ? 'Цена (сум)' : 'Цена (у.е.)'}</th>
                  <th style={{ width: '15%', textAlign: 'center' }}>Кол-во</th>
                  <th style={{ width: '15%', textAlign: 'right' }}>{currency === 'sum' ? 'Сумма (сум)' : 'Сумма (у.е.)'}</th>
                  <th style={{ width: '10%' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const product = productsData.find(p => p.id === item.productId)
                  return (
                    <tr key={item.id} className="animate-in">
                      <td>
                        <div style={{ position: 'relative' }}>
                          <select 
                            className="input" 
                            style={{ background: 'none', border: 'none', fontWeight: 600, appearance: 'none', paddingLeft: '0' }}
                            value={item.productId}
                            onChange={e => updateItem(item.id, 'productId', e.target.value)}
                          >
                            {cleanProducts.map(p => (
                              <option key={p.id} value={p.id} style={{ color: '#000' }}>
                                [{p.category}] {p.model} - {p.name}
                              </option>
                            ))}
                          </select>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            Категория: {product?.category}
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{ fontWeight: 500 }}>{getAdjustedPrice(product?.price || 0).toLocaleString()}</span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input 
                          type="number" 
                          className="input" 
                          style={{ width: '70px', padding: '0.5rem', textAlign: 'center', margin: '0 auto' }}
                          min="1"
                          value={item.quantity}
                          onChange={e => updateItem(item.id, 'quantity', parseInt(e.target.value) || 0)}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>
                          {(product ? getAdjustedPrice(product.price) * item.quantity : 0).toLocaleString()}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-outline" style={{ color: 'var(--error)', padding: '0.6rem' }} onClick={() => removeItem(item.id)}>
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2.5rem', paddingTop: '2rem', borderTop: '1px solid var(--border)' }}>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.5rem' }}>ОБЩАЯ СТОИМОСТЬ</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
                  {calculateTotal().toLocaleString()}
                </span>
                <span style={{ fontSize: '1.25rem', color: 'var(--primary)', fontWeight: 500 }}>{currency === 'sum' ? 'сум' : 'у.е.'}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Search Helper */}
        <section className="card" style={{ padding: '1.5rem 2.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
             <Search size={20} color="var(--primary)" />
             <input 
                type="text" 
                className="input" 
                placeholder="Быстрый поиск по всей базе (модель, название)..." 
                style={{ border: 'none', background: 'none', fontSize: '1.1rem', padding: 0 }}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
             />
          </div>
          {searchTerm && (
            <div style={{ marginTop: '1.5rem', maxHeight: '300px', overflowY: 'auto' }}>
              {filteredProducts.map(p => (
                <div 
                  key={p.id} 
                  className="search-result-item"
                  onClick={() => {
                    setItems([...items, { id: Math.random().toString(36).substr(2, 9), productId: p.id, quantity: 1 }])
                    setSearchTerm('')
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{p.model}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{p.category} | {p.name} | {getAdjustedPrice(p.price)} {currency === 'sum' ? 'сум' : 'у.е.'}</div>
                </div>
              ))}
              {filteredProducts.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Ничего не найдено</div>}
            </div>
          )}
        </section>

        {/* Generate Button */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '3rem' }}>
          <button 
            className="btn btn-primary" 
            style={{ padding: '1.5rem 4rem', fontSize: '1.25rem', borderRadius: '1rem' }}
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? (
              <><RefreshCw size={24} className="spin" /> Формирование PDF...</>
            ) : (
              <><FileText size={24} /> Сформировать КП</>
            )}
          </button>
        </div>
      </div>
    </main>
  )
}
