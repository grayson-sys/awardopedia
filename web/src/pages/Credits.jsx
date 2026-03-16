import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, CheckCircle } from 'lucide-react';
import CreditPacks from '../components/CreditPacks';
import { useCredits } from '../App';
import { useSEO } from '../utils/seo';
import { sendMagicLink, verifyMagicLink } from '../utils/api';

const COST_TABLE = [
  { action: 'Plain-English contract summary',         credits: 1 },
  { action: 'Full opportunity analysis',              credits: 3 },
  { action: 'Fit score vs your capability statement', credits: 3 },
  { action: 'Proposal theme suggestions',             credits: 3 },
  { action: 'Competitor deep-dive',                   credits: 5 },
  { action: 'Agency spending pattern report',         credits: 5 },
];

export default function Credits() {
  const { SEOHead } = useSEO({
    title: 'AI Credits — Powered by Claude',
    desc: 'Buy Claude AI credits for contract analysis, competitor research, and proposal intelligence. Transparent pricing, no subscription required.',
    path: '/credits',
  });
  const { user, setUser, credits, setCredits } = useCredits();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (token) {
      setVerifying(true);
      verifyMagicLink(token)
        .then((res) => {
          localStorage.setItem('awardopedia_token', res.jwt);
          setUser(res.user);
          setCredits(res.user.credits || 0);
        })
        .catch((err) => setError(err.message))
        .finally(() => setVerifying(false));
    }
  }, [params]);

  async function handleSendLink(e) {
    e.preventDefault();
    setError('');
    try {
      await sendMagicLink(email);
      setSent(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <SEOHead />
      <div className="container" style={{ padding: 'var(--space-12) 0', maxWidth: 860 }}>

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-10)' }}>
          <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-3)' }}>
            AI Analysis Credits
          </h1>
          <p style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-muted)', maxWidth: 540, margin: '0 auto' }}>
            AI features on Awardopedia are powered by{' '}
            <strong style={{ color: 'var(--color-text)' }}>Claude</strong> — the AI built by
            Anthropic, used by research teams at Fortune 500 companies. We handle
            the prompting, data context, and formatting. You get the answer.
          </p>
        </div>

        {/* Credit Balance (logged in) or Sign-in */}
        {verifying && (
          <div className="card" style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
            Verifying your login…
          </div>
        )}

        {!user ? (
          <div className="card" style={{ maxWidth: 400, margin: '0 auto var(--space-10)', textAlign: 'center' }}>
            <Mail size={32} style={{ color: 'var(--color-navy)', margin: '0 auto var(--space-4)' }} />
            <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-1)' }}>
              Sign in to purchase
            </h2>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-4)' }}>
              No password needed — we'll email you a link.
            </p>
            {sent ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', justifyContent: 'center', color: 'var(--color-success)' }}>
                <CheckCircle size={16} />
                Check your email for a login link
              </div>
            ) : (
              <form onSubmit={handleSendLink}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="filter-panel__input"
                  style={{ marginBottom: 'var(--space-3)' }}
                />
                <button type="submit" className="btn-primary" style={{ width: '100%' }}>
                  Send Magic Link
                </button>
              </form>
            )}
            {error && (
              <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-3)' }}>
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="card" style={{ maxWidth: 400, margin: '0 auto var(--space-10)', textAlign: 'center' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-2)' }}>
              Signed in as {user.email}
            </p>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-3xl)', color: 'var(--color-navy)', marginBottom: 'var(--space-1)' }}>
              {(credits || 0).toLocaleString()}
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)' }}>
              credits remaining
            </div>
          </div>
        )}

        {/* Packs */}
        <CreditPacks />

        {/* What costs what */}
        <div style={{ marginTop: 'var(--space-12)' }}>
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-6)', textAlign: 'center' }}>
            What each credit gets you
          </h2>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-navy-light)' }}>
                  <th style={{ padding: 'var(--space-3) var(--space-5)', textAlign: 'left', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--color-navy)' }}>
                    Action
                  </th>
                  <th style={{ padding: 'var(--space-3) var(--space-5)', textAlign: 'right', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--color-navy)' }}>
                    Credits
                  </th>
                </tr>
              </thead>
              <tbody>
                {COST_TABLE.map((row, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: i < COST_TABLE.length - 1 ? '1px solid var(--color-border)' : undefined,
                    }}
                  >
                    <td style={{ padding: 'var(--space-3) var(--space-5)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
                      {row.action}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-5)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--color-amber)', textAlign: 'right', fontWeight: 'var(--font-weight-medium)' }}>
                      {row.credits} cr
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* The honest comparison */}
        <div style={{ marginTop: 'var(--space-12)' }}>
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-6)', textAlign: 'center' }}>
            How it stacks up
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
            {[
              {
                label: 'GovWin IQ',
                price: '~$200/mo',
                note: 'No AI analysis included. Subscription required for everything.',
                muted: true,
              },
              {
                label: 'BD Consultant',
                price: '$150–$250/hr',
                note: 'Manual research. One analyst, one contract at a time.',
                muted: true,
              },
              {
                label: 'Awardopedia Pro',
                price: '$29 one-time',
                note: '165 full opportunity analyses. Claude reads every contract. No subscription.',
                highlight: true,
              },
            ].map((item) => (
              <div
                key={item.label}
                className="card"
                style={{
                  textAlign: 'center',
                  border: item.highlight ? '2px solid var(--color-amber)' : undefined,
                  opacity: item.muted ? 0.7 : 1,
                }}
              >
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-1)' }}>
                  {item.label}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-medium)', color: item.highlight ? 'var(--color-amber)' : 'var(--color-text)', marginBottom: 'var(--space-2)' }}>
                  {item.price}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-muted)', lineHeight: 1.5 }}>
                  {item.note}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Fine print / trust */}
        <p style={{ textAlign: 'center', fontSize: 'var(--font-size-xs)', color: 'var(--color-muted)', marginTop: 'var(--space-8)', lineHeight: 1.6 }}>
          Credits never expire. One-time purchase — no subscription, no auto-renew.{' '}
          AI analysis is powered by the Claude API (Anthropic). We use your credits
          to run analysis queries on your behalf. All underlying contract data is
          sourced from{' '}
          <a href="https://usaspending.gov" target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--color-navy)' }}>
            USASpending.gov
          </a>{' '}
          and is always free to access without credits.
        </p>

      </div>
    </>
  );
}
