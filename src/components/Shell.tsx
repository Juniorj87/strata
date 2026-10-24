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

const REPO = 'https://github.com/Juniorj87/strata';

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true" focusable="false">
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
            <a href="https://www.asentum.com/docs" target="_blank" rel="noreferrer">
              Docs ↗
            </a>
            <a
              className="gh-link"
              href={REPO}
              target="_blank"
              rel="noreferrer"
              aria-label="Strata source on GitHub"
              title="Strata source on GitHub"
            >
              <GitHubIcon />
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
              <a href={REPO} target="_blank" rel="noreferrer">
                GitHub ↗
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
