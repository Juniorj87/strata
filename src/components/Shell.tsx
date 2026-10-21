import { Link, NavLink } from 'react-router-dom';

const nav = [
  { to: '/strategies', label: 'Strategies' },
  { to: '/#how', label: 'How it works' },
  { to: '/deploy', label: 'Deploy' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark">STRATA</span>
            <span className="brand-tag">on asentum</span>
          </Link>
          <nav className="nav">
            {nav.map((item) =>
              item.to.includes('#') ? (
                <a key={item.to} href={item.to}>
                  {item.label}
                </a>
              ) : (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {item.label}
                </NavLink>
              ),
            )}
            <a href="https://www.asentum.com/docs" target="_blank" rel="noreferrer">
              Docs ↗
            </a>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="footer">
        <div className="wrap">
          <div className="footer-grid">
            <div className="footer-col">
              <span className="brand-mark" style={{ fontSize: 15 }}>
                STRATA
              </span>
              <span className="dim" style={{ fontSize: 13, maxWidth: 260 }}>
                Trading logic as a contract. The chain is the scheduler, the AMM is the venue, the source is
                public.
              </span>
            </div>
            <div className="footer-col">
              <span className="label">Product</span>
              <Link to="/strategies">Strategies</Link>
              <Link to="/deploy">Deploy a strategy</Link>
              <a href="https://ide.asentum.com" target="_blank" rel="noreferrer">
                Asentum IDE ↗
              </a>
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
            <span>Community build on the Asentum testnet. Not affiliated with the Asentum team.</span>
            <span className="mono">chain 1423 · ASE native</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
