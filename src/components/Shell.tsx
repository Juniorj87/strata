import { Link, NavLink } from 'react-router-dom';
import { ConnectModal, useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { getHeads } from '../lib/rpc';
import { useTheme } from '../lib/theme';

const nav = [
  { to: '/deploy', label: 'Create Bot' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/strategies', label: 'Strategies' },
  { to: '/leaderboard', label: 'Leaderboard' },
];

const REPO = 'https://github.com/Juniorj87/strata';

function TwitterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

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
                Build, launch and monitor automated on-chain strategies. Start with Lite; use Pro when you need developer controls.
              </span>
              <span className="live-dot" style={{ marginTop: 8 }}>
                chain 1423{heads ? ` · block ${heads.finalized.toLocaleString('en-US')}` : ''}
              </span>
            </div>
            <div className="footer-col">
              <span className="label">Product</span>
              <Link to="/strategies">Explore strategies</Link>
              <Link to="/deploy">Create a strategy</Link>
              <Link to="/leaderboard">Leaderboard</Link>
              <Link to="/how">How it works</Link>
              <a href="https://www.asentum.com/docs" target="_blank" rel="noreferrer">
                Documentation ↗
              </a>
            </div>
            <div className="footer-col">
              <span className="label">Trading Venues</span>
              <a href="https://auras.finance" target="_blank" rel="noreferrer">
                Auras Finance ↗
              </a>
              <a href="https://asepad.fun" target="_blank" rel="noreferrer">
                AsePad / AseDex ↗
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
            <div className="footer-socials" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <a
                className="social-link"
                href={REPO}
                target="_blank"
                rel="noreferrer"
                aria-label="Strata on GitHub"
                title="GitHub"
                style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center' }}
              >
                <GitHubIcon />
              </a>
              <a
                className="social-link"
                href="#"
                onClick={(e) => e.preventDefault()}
                aria-label="Strata on X (Twitter)"
                title="Twitter / X (coming soon)"
                style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center' }}
              >
                <TwitterIcon />
              </a>
            </div>
            <span className="mono">chain 1423 · ASE native</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
