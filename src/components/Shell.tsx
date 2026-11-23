import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ConnectModal, useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { getHeads } from '../lib/rpc';
import { useTheme } from '../lib/theme';
import { Logo } from './Logo';

function NavIcon({ name }: { name: string }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'strategies':
      return (
        <svg {...common}>
          <path d="M4 7.5 12 3l8 4.5-8 4.5z" />
          <path d="M4 12.5 12 17l8-4.5M4 17 12 21.5 20 17" />
        </svg>
      );
    case 'portfolio':
      return (
        <svg {...common}>
          <path d="M3 20V10M9 20V4M15 20v-7M21 20V7" />
        </svg>
      );
    case 'leaderboard':
      return (
        <svg {...common}>
          <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />
          <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" />
        </svg>
      );
    case 'activity':
      return (
        <svg {...common}>
          <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
        </svg>
      );
    case 'swap':
      return (
        <svg {...common}>
          <path d="M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3" />
        </svg>
      );
    case 'analytics':
      return (
        <svg {...common}>
          <path d="M4 20V4M4 20h16" />
          <path d="M8 16v-4M12 16V8M16 16v-6M20 16V6" />
        </svg>
      );
    case 'advanced':
      return (
        <svg {...common}>
          <path d="M7 5v14M7 9h3v6H7zM14 4v16M14 11h3v5h-3z" />
        </svg>
      );
    case 'token':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8M9.5 10.2c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1.1 1.6-2.5 1.8-2.5.8-2.5 1.8 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
          <path d="M4 5.5V21.5M8 7h8M8 11h6" />
        </svg>
      );
  }
}

// One destination per job. The fills ledger is reachable from the leaderboard
// instead of taking a top-bar slot.
const nav = [
  { to: '/swap', label: 'Swap', icon: 'swap' },
  { to: '/advanced', label: 'Advanced', icon: 'advanced' },
  { to: '/strategies', label: 'Bots', icon: 'strategies' },
  { to: '/portfolio', label: 'Portfolio', icon: 'portfolio' },
  { to: '/leaderboard', label: 'Leaderboard', icon: 'leaderboard' },
];

const REPO = 'https://github.com/Juniorj87/strata';

const EXPLORE_PATHS = new Set(['/leaderboard', '/activity', '/analytics']);

/** The leaderboard tab also covers its fills ledger and the analytics redirect. */
function isNavActive(to: string, path: string, isActive: boolean): boolean {
  return isActive || (to === '/leaderboard' && EXPLORE_PATHS.has(path));
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

function XIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.3-8.4L1.8 2h6.5l4.4 6.9L18.9 2Zm-1.1 18h1.7L7.3 3.9H5.5L17.8 20Z"/></svg>;
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M20 14.4A8.2 8.2 0 1 1 9.6 4a6.7 6.7 0 0 0 10.4 10.4Z" />
    </svg>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [theme, toggleTheme] = useTheme();
  const { data: heads } = useAsync(() => getHeads(), 12_000);
  const wallet = useWallet();
  const [isLocked, setIsLocked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
    // Without this a nav click kept the previous page's scroll offset, so a
    // new route opened halfway down and looked like the page it came from.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);

  useEffect(() => {
    let active = true;
    const checkLock = async () => {
      if (typeof window !== 'undefined' && (window as any).asentum?.isUnlocked && wallet.connected) {
        try {
          const unlocked = await (window as any).asentum.isUnlocked();
          if (active) setIsLocked(!unlocked);
        } catch {
          if (active) setIsLocked(false);
        }
      } else {
        if (active) setIsLocked(false);
      }
    };
    void checkLock();
    window.addEventListener('focus', checkLock);
    const interval = window.setInterval(() => {
      void checkLock();
    }, 2500);
    return () => {
      active = false;
      window.removeEventListener('focus', checkLock);
      window.clearInterval(interval);
    };
  }, [wallet.connected]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Link to="/" className="brand" aria-label="Strata home">
            <Logo size={25} />
          </Link>

          <nav className="nav" aria-label="Primary">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isNavActive(item.to, location.pathname, isActive) ? 'active' : '')}
              >
                <NavIcon name={item.icon} />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="nav-actions">
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              type="button"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>

            {wallet.connected && wallet.ase1Address ? (
              <>
                <a
                  className="mono wallet-chip"
                  href={`https://explorer.asentum.com/address/${wallet.ase1Address}`}
                  target="_blank"
                  rel="noreferrer"
                  title={
                    isLocked
                      ? 'Wallet is locked in the browser extension. Enter your password to unlock.'
                      : wallet.ase1Address
                  }
                  style={isLocked ? { borderColor: 'var(--warn)', color: 'var(--warn)' } : undefined}
                >
                  <span className="dot" style={isLocked ? { background: 'var(--warn)' } : undefined} />
                  {isLocked ? 'Locked' : <span className="wallet-address-text">{wallet.ase1Address}</span>}
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm wallet-disconnect"
                  onClick={() => wallet.disconnect()}
                  title="Disconnect wallet session"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => wallet.openConnect()} type="button">
                {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
              </button>
            )}

            <Link className="btn btn-primary btn-sm" to="/deploy">
              Create bot
            </Link>

            <button
              type="button"
              className="menu-toggle"
              aria-expanded={menuOpen}
              aria-label="Toggle navigation menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>

        <div className={menuOpen ? 'mobile-nav open' : 'mobile-nav'}>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isNavActive(item.to, location.pathname, isActive) ? 'active' : '')}
            >
              <NavIcon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
          <div className="mobile-nav-actions">
            {!wallet.connected && (
              <button className="btn btn-ghost" type="button" onClick={() => wallet.openConnect()}>
                {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
              </button>
            )}
            <Link className="btn btn-primary" to="/deploy">
              Create bot
            </Link>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <ConnectModal />

      <footer className="footer">
        <div className="wrap">
          <div className="footer-grid">
            <div className="footer-col">
              <Logo size={24} />
              <span>
                Trading rules as on-chain contracts. Choose a strategy, fund it from your wallet, and the
                Asentum network runs the schedule.
              </span>
              <span className="live-dot" style={{ marginTop: 6 }}>
                Testnet · block {heads?.finalized ? heads.finalized.toLocaleString('en-US') : '—'}
              </span>
            </div>

            <div className="footer-col">
              <span className="label">Product</span>
              <Link to="/swap">Swap</Link>
              <Link to="/advanced">Advanced Trading</Link>
              <Link to="/strategies">Strategy catalog</Link>
              <Link to="/create-token">Create Token</Link>
              <Link to="/deploy">Launch a bot</Link>
              <Link to="/portfolio">Portfolio</Link>
              <Link to="/activity">Activity</Link>
            </div>

            <div className="footer-col">
              <span className="label">Explore</span>
              <Link to="/leaderboard">Wallet leaderboard</Link>
              <Link to="/activity">Fills ledger</Link>
              <Link to="/advanced">Advanced trading</Link>
              <Link to="/how">Documentation</Link>
            </div>

            <div className="footer-col">
              <span className="label">Resources</span>
              <Link to="/how">Documentation</Link>
              <a href="https://www.asentum.com/docs" target="_blank" rel="noreferrer">
                Asentum docs ↗
              </a>
              <a href="https://www.asentum.com/docs/guides/scheduled-calls" target="_blank" rel="noreferrer">
                Scheduled calls ↗
              </a>
              <a href={REPO} target="_blank" rel="noreferrer">
                Source repository ↗
              </a>
            </div>

            <div className="footer-col">
              <span className="label">Venues</span>
              <a href="https://auras.finance" target="_blank" rel="noreferrer">
                Auras Finance ↗
              </a>
              <a href="https://asepad.fun" target="_blank" rel="noreferrer">AsePad / AseDex ↗</a>
              <span className="muted">Primary market data: Auras · additional venue: AseDex</span>
              <a href="https://explorer.asentum.com" target="_blank" rel="noreferrer">
                Explorer ↗
              </a>
            </div>
          </div>

          <div className="footer-bottom">
            <span>Strata · experimental testnet software, not investment advice.</span>
            <div className="footer-socials">
              <a className="social-link" href={REPO} target="_blank" rel="noreferrer" aria-label="Strata on GitHub" title="GitHub"><GitHubIcon /></a>
              <a className="social-link" href="https://x.com/search?q=StrataDEX" target="_blank" rel="noreferrer" aria-label="Find Strata on X" title="Strata on X"><XIcon /></a>
            </div>
            <span className="mono">chain 1423 · ASE native</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
