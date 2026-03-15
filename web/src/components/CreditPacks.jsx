import { Zap, Star, Rocket } from 'lucide-react';
import { purchaseCredits } from '../utils/api';

const packs = [
  { id: 'starter', name: 'Starter', credits: 100, price: 9, icon: Zap, description: 'Great for trying AI analysis' },
  { id: 'pro', name: 'Pro', credits: 500, price: 29, icon: Star, description: 'Best value for regular users', popular: true },
  { id: 'power', name: 'Power', credits: 2000, price: 79, icon: Rocket, description: 'For power users and teams' },
];

export default function CreditPacks() {
  async function handlePurchase(packId) {
    try {
      const { url } = await purchaseCredits(packId);
      window.location.href = url;
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: 'var(--space-6)',
    }}>
      {packs.map((pack) => {
        const Icon = pack.icon;
        return (
          <div
            key={pack.id}
            className="card"
            style={{
              textAlign: 'center',
              position: 'relative',
              border: pack.popular ? '2px solid var(--color-amber)' : undefined,
            }}
          >
            {pack.popular && (
              <div style={{
                position: 'absolute',
                top: -12,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'var(--color-amber)',
                color: 'var(--color-white)',
                fontSize: 'var(--font-size-xs)',
                fontWeight: 'var(--font-weight-medium)',
                padding: '2px 12px',
                borderRadius: 'var(--border-radius)',
              }}>
                Most Popular
              </div>
            )}
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--border-radius)',
              background: 'var(--color-navy-light)',
              color: 'var(--color-navy)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto var(--space-4)',
            }}>
              <Icon size={24} />
            </div>
            <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-1)' }}>
              {pack.name}
            </h3>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-3xl)', fontWeight: 'var(--font-weight-medium)', color: 'var(--color-navy)' }}>
              ${pack.price}
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)', margin: 'var(--space-1) 0 var(--space-2)' }}>
              {pack.credits} credits
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-muted)', marginBottom: 'var(--space-4)' }}>
              {pack.description}
            </div>
            <button className="btn-primary" onClick={() => handlePurchase(pack.id)} style={{ width: '100%' }}>
              Buy {pack.name}
            </button>
          </div>
        );
      })}
    </div>
  );
}
