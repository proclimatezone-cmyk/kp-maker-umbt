"use client";
import { useState } from 'react';
import { Mail, ArrowRight, ShieldCheck, AlertCircle, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError('Введите почту');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        router.push('/');
        router.refresh(); // Force reload to apply layout/auth state
      } else {
        setError(data.error || 'Доступ запрещен');
      }
    } catch (err) {
      setError('Ошибка сети. Проверьте подключение.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh', 
      background: 'radial-gradient(circle at top right, #fdf2f8, #f8f9fb)', 
      padding: '1rem' 
    }}>
      <div className="section scale-in" style={{ 
        maxWidth: '420px', 
        width: '100%', 
        padding: '2.5rem',
        boxShadow: '0 20px 50px rgba(0,0,0,0.05)',
        border: '1px solid rgba(255,255,255,0.8)',
        backdropFilter: 'blur(10px)',
        background: 'rgba(255,255,255,0.9)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ 
            width: '64px', 
            height: '64px', 
            background: 'white', 
            borderRadius: '16px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            margin: '0 auto 1.25rem',
            boxShadow: 'var(--shadow-md)'
          }}>
            <img src="/images/branding/logo_umbt.jpg" alt="UMBT" style={{ height: '40px', borderRadius: '4px' }} />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>
            КП Maker <span style={{ color: 'var(--accent)' }}>Pro</span>
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.75rem', lineHeight: 1.5 }}>
            Введите вашу корпоративную почту для доступа к системе формирования предложений.
          </p>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="field">
            <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text)' }}>
              <Mail size={14} className="text-accent" /> Электронная почта
            </label>
            <input 
              type="email" 
              className="field-input" 
              placeholder="vashapochta@umbt.uz" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoFocus
              style={{ padding: '0.85rem 1rem', fontSize: '1rem' }}
            />
          </div>

          {error && (
            <div className="fade-in" style={{ 
              display: 'flex', 
              alignItems: 'flex-start', 
              gap: '0.75rem', 
              background: '#fff1f2', 
              color: '#e11d48', 
              padding: '1rem', 
              borderRadius: 'var(--radius-sm)', 
              fontSize: '0.85rem', 
              border: '1px solid #fecdd3' 
            }}>
              <AlertCircle size={18} style={{ marginTop: '2px', flexShrink: 0 }} />
              <span style={{ fontWeight: 500 }}>{error}</span>
            </div>
          )}

          <button 
            type="submit" 
            className="gen-btn" 
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', padding: '1rem' }}
          >
            {loading ? (
              <RefreshCw className="spin" size={20} />
            ) : (
              <>Войти в систему <ArrowRight size={20} /></>
            )}
          </button>
        </form>

        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          gap: '0.5rem', 
          marginTop: '2.5rem', 
          fontSize: '0.75rem', 
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border)',
          paddingTop: '1.5rem'
        }}>
          <ShieldCheck size={14} />
          <span>Безопасное соединение · Привязка к IP</span>
        </div>
      </div>
    </div>
  );
}
