import { Link } from 'react-router-dom';

const steps = [
  { number: '01', title: 'Choose what you want to do', text: 'Pick a ready-made strategy such as a signal, scheduled sale, TWAP split, scale ladder or risk-managed exit. Every template explains what it does and what it cannot do.' },
  { number: '02', title: 'Set the market and limits', text: 'Select a live Auras pair, the token allocation and the schedule. Risk-managed strategies also let you set stop-loss, take-profit, drawdown and daily realised-loss limits.' },
  { number: '03', title: 'Review the costs', text: 'Strata checks the live token balance, token decimals and minimum Cron escrow before asking your wallet to sign. You can review the token budget and the gas budget separately.' },
  { number: '04', title: 'The network runs the schedule', text: 'The strategy calls the Asentum Cron Registry. No browser tab or private server needs to stay open. Each run spends from the funded escrow.' },
  { number: '05', title: 'Monitor, stop and withdraw', text: 'Track fills and estimates from the strategy page. The owner can stop the schedule, then withdraw ASE and reclaim unused tokens.' },
];

export function How() {
  return (
    <>
      <section className="wrap detail-head friendly-guide-head">
        <span className="label">Getting started · no-code first</span>
        <h1 className="detail-title">From idea to on-chain strategy.</h1>
        <p className="section-note" style={{ maxWidth: 720 }}>
          Strata turns a set of trading rules into a contract on Asentum. In Lite, you choose a template and review simple explanations. You do not need to write JavaScript, use PowerShell or keep a bot running on your computer.
        </p>
        <div className="hero-actions" style={{ marginTop: 24 }}>
          <Link className="btn btn-primary" to="/deploy">Create a strategy →</Link>
          <Link className="btn btn-ghost" to="/deploy?mode=pro">I use code · Pro</Link>
        </div>
      </section>

      <section className="wrap section friendly-guide-steps">
        {steps.map((step) => (
          <article className="friendly-guide-step" key={step.number}>
            <span className="feature-number">{step.number}</span>
            <div><h2>{step.title}</h2><p>{step.text}</p></div>
          </article>
        ))}
      </section>

      <section className="wrap section friendly-guide-safety">
        <div className="panel">
          <div className="panel-body">
            <span className="label">Important before you deploy</span>
            <h2 className="section-title">Know exactly what a template will do.</h2>
            <p className="muted">Strata uses spot execution through Auras. Grid can buy below and sell above its deployment reference price using separate ASE and token reserves; DCA makes scheduled ASE-to-token purchases from a prefunded budget. TWAP divides a sale into separate atomic swaps. These are scheduled AMM operations, not continuous order-book execution. Risk checks also run only when their Cron schedule executes.</p>
            <p className="muted" style={{ marginTop: 12 }}>A contract source hash confirms that the source read from the chain matches its stored hash. It does not prove that a strategy is profitable, safe in every market, or independently audited.</p>
            <div className="hero-actions" style={{ marginTop: 22 }}>
              <Link className="btn btn-primary" to="/deploy">Review templates</Link>
              <Link className="btn btn-ghost" to="/analytics">See performance data</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
