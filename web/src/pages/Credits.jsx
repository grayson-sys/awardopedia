import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, CheckCircle } from 'lucide-react';
import CreditPacks from '../components/CreditPacks';
import { useCredits } from '../App';
import { useSEO } from '../utils/seo';
import { sendMagicLink, verifyMagicLink } from '../utils/api';

export default function Credits() {
  const { SEOHead } = useSEO({ title: 'AI Credits', path: '/credits' });
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
      <div className="container" style={{ padding: 'var(--space-12) 0', maxWidth: 900 }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-2)', textAlign: 'center' }}>
          AI Analysis Credits
        </h1>
        <p style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-muted)', textAlign: 'center', marginBottom: 'var(--space-8)', maxWidth: 500, margin: '0 auto var(--space-8)' }}>
          Use AI to analyze contracts, summarize agency patterns, and get competitive insights. Each analysis costs 1 credit.
        </p>

        {verifying && (
          <div className="card" style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
            Verifying your login...
          </div>
        )}

        {!user ? (
          <div className="card" style={{ maxWidth: 420, margin: '0 auto var(--space-10)', textAlign: 'center' }}>
            <Mail size={32} style={{ color: 'var(--color-navy)', margin: '0 auto var(--space-4)' }} />
            <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-3)' }}>
              Sign in to purchase credits
            </h2>
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
          <div className="card" style={{ maxWidth: 420, margin: '0 auto var(--space-10)', textAlign: 'center' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-2)' }}>
              Signed in as {user.email}
            </p>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-3xl)', color: 'var(--color-navy)', marginBottom: 'var(--space-1)' }}>
              {credits}
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)' }}>
              credits remaining
            </div>
          </div>
        )}

        <CreditPacks />
      </div>
    </>
  );
}
