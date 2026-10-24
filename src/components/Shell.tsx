import { Link, NavLink } from 'react-router-dom';
import { ConnectModal, useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { getHeads } from '../lib/rpc';
import { useTheme } from '../lib/theme';

const nav = [
  { to: '/strategies', label: 'Strategies' },
  { to: '/how', label: 'How it works' },
  { to: '/deploy', label: 'Deploy' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [theme, toggleTheme] = useTheme();
  const { data: heads } = useAsync(() => getHeads(), 5000);
  const wallet = useWallet();

  return (
    <div className="app">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark">STRATA</span>
          </Link>
          <nav className="nav">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                {item.label}
              </NavLink>
            ))}
            <a href="https://www.asentum.com/docs" target="_blank" rel="noreferrer">
              Docs ↗
            </a>
            <button className="theme-toggle" onClick={toggleTheme} type="button" aria-label="Toggle colour theme">
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
            {wallet.connected && wallet.ase1Address ? (
              <a
                className="mono wallet-chip"
                href={`https://explorer.asentum.com/address/${wallet.ase1Address}`}
                target="_blank"
                rel="noreferrer"
                title={wallet.ase1Address}
              >
                ● {`${wallet.ase1Address.slice(0, 10)}…${wallet.ase1Address.slice(-4)}`}
              </a>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => wallet.openConnect()} type="button">
                {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
              </button>
            )}
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <ConnectModal />
      <footer className="footer">
        <div className="wrap">
          <div className="footer-grid">
            <div className="footer-col">
              <span className="brand-mark" style={{ fontSize: 15 }}>
                STRATA
              </span>
              <span className="dim" style={{ fontSize: 13, maxWidth: 280 }}>
                Adaptive trading strategies as contracts. The chain is the scheduler, the AMM is the venue, the
                source is public.
              </span>
              <span className="live-dot" style={{ marginTop: 8 }}>
                chain 1423{heads ? ` · block ${heads.finalized.toLocaleString('en-US')}` : ''}
              </span>
            </div>
            <div className="footer-col">
              <span className="label">Product</span>
              <Link to="/strategies">Strategies</Link>
              <Link to="/deploy">Deploy a strategy</Link>
              <Link to="/how">How it works</Link>
            </div>
            <div className="footer-col">
              <span className="label">Ecosystem</span>
              <a href="https://auras.finance" target="_blank" rel="noreferrer">
                Auras ↗
              </a>
              <a href="https://social.asentum.com" target="_blank" rel="noreferrer">
                ASocial ↗
              </a>
              <a href="https://explorer.asentum.com" target="_blank" rel="noreferrer">
                Explorer ↗
              </a>
              <a href="https://www.asentum.com/docs/guides/scheduled-calls" target="_blank" rel="noreferrer">
                Scheduled calls ↗
              </a>
            </div>
          </div>
          <div className="footer-bottom">
            <span>
              Strata · trading strategies as contracts.
            </span>
            <span className="mono">chain 1423 · ASE native</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
