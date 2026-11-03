import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { loadPools, loadAseDexPools, loadStrategies } from '../lib/registry';
import { explorerAddressUrl, explorerTxUrl, toAse1, toHexAddress } from '../lib/rpc';
import { fmtWei, shortAddr } from '../lib/format';
import { botTypeFor } from '../lib/templates';
import {
  fetchUserTokenHoldings,
  getUserStrategies,
  getUserTxs,
  type DeployedStrategyRecord,
  type UserTokenHolding,
  type UserTxRecord,
} from '../lib/userStrategies';

function everyLabel(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) {
    const hours = Math.round((seconds / 3600) * 10) / 10;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(seconds / 86400);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function statusOf(
  status: DeployedStrategyRecord['status'],
  liveMatch?: { cron: any; stopped?: boolean | null } | null,
): { label: string; className: string } {
  if (liveMatch) {
    if (liveMatch.stopped) return { label: 'Stopped', className: 'status-badge off' };
    if (liveMatch.cron !== null) return { label: 'Running', className: 'status-badge live' };
  }
  switch (status) {
    case 'active': return { label: 'Running', className: 'status-badge live' };
    case 'funded': return { label: 'Funded', className: 'status-badge pending' };
    case 'initialized': return { label: 'Starting', className: 'status-badge pending' };
    case 'deployed': return { label: 'Needs setup', className: 'status-badge pending' };
    case 'failed': return { label: 'Failed', className: 'status-badge off' };
    default: return { label: status, className: 'status-badge off' };
  }
}

function planLabel(record: DeployedStrategyRecord): string {
  switch (record.template) {
    case 'dca': return `Buys every ${everyLabel(record.interval)}`;
    case 'twap': return 'Sells in timed parts';
    case 'grid': return record.threshold ? `${Number(record.threshold) / 100}% step grid` : 'Range grid';
    case 'limit-exit': return 'Sells once at target';
    case 'risk-managed': return 'Stop-loss / take-profit';
    case 'scale': return 'Sell ladder';
    case 'momentum-trader': return 'Momentum sells';
    case 'momentum-signal': return 'Signal only';
    default: return 'Custom contract';
  }
}

export function Portfolio() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'tokens' | 'bots' | 'activity'>('tokens');
  const [holdings, setHoldings] = useState<UserTokenHolding[]>([]);
  const [loadingHoldings, setLoadingHoldings] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);

  const pools = useAsync(() => loadPools(), 30000);
  const asedexPools = useAsync(() => loadAseDexPools(), 30000);
  const liveStrategies = useAsync(() => loadStrategies(), 25000);

  const allPools = useMemo(
    () => [...(pools.data ?? []), ...(asedexPools.data ?? [])],
    [pools.data, asedexPools.data],
  );

  const refreshHoldings = useCallback(async () => {
    if (!wallet.connected || !wallet.address || allPools.length === 0) return;
    setLoadingHoldings(true);
    try {
      const items = await fetchUserTokenHoldings(wallet.address, allPools, wallet.ase1Address);
      setHoldings(items);
    } catch (err) {
      console.warn('Failed to fetch holdings:', err);
    } finally {
      setLoadingHoldings(false);
    }
  }, [wallet.connected, wallet.address, wallet.ase1Address, allPools]);

  useEffect(() => {
    void refreshHoldings();
  }, [refreshHoldings]);

  const userStrategies: DeployedStrategyRecord[] = wallet.connected && wallet.address
    ? getUserStrategies(wallet.address)
    : [];

  const userTxs: UserTxRecord[] = wallet.connected && wallet.address
    ? getUserTxs(wallet.address)
    : [];

  const userLiveStrategies = useMemo(() => {
    const live = liveStrategies.data ?? [];
    return userStrategies.map((s) => ({
      record: s,
      live: live.find((item) => item.address.toLowerCase() === s.address.toLowerCase()) ?? null,
    }));
  }, [userStrategies, liveStrategies.data]);

  const totalAseInBots = useMemo(() => {
    return userLiveStrategies.reduce((acc, { live }) => {
      if (live?.balanceAse) {
        return acc + BigInt(live.balanceAse);
      }
      return acc;
    }, 0n);
  }, [userLiveStrategies]);

  const totalGrossProceeds = useMemo(() => {
    return userLiveStrategies.reduce((acc, { live }) => {
      if (live?.realisedWei) {
        return acc + BigInt(live.realisedWei);
      }
      return acc;
    }, 0n);
  }, [userLiveStrategies]);

  const nativeHolding = holdings.find((h) => h.isNative);
  const tokenHoldings = holdings.filter((h) => !h.isNative);
  // A bot that finished init + funding has no local "active" marker; it is live
  // until it is stopped, so count those as running instead of showing zero.
  const runningBots = userStrategies.filter(
    (strategy) => strategy.status === 'active' || strategy.status === 'funded',
  ).length;
  const botsToFinish = userStrategies.filter(
    (strategy) => strategy.status === 'deployed' || strategy.status === 'initialized',
  ).length;

  const copyAddress = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAddr(true);
      setTimeout(() => setCopiedAddr(false), 1800);
    } catch {
      // clipboard can be blocked by the browser
    }
  };

  if (!wallet.connected || !wallet.address) {
    return (
      <section className="wrap" style={{ padding: '60px 0 100px' }}>
        <div className="detail-head">
          <span className="label">Your Strata portfolio</span>
          <h1 className="detail-title">Connect your wallet.</h1>
          <p className="section-note" style={{ maxWidth: 640 }}>
            See your balances, the bots you run and every transaction they made — all from one wallet.
          </p>
        </div>
        <div className="panel" style={{ maxWidth: 500, margin: '30px auto', padding: '36px 24px', textAlign: 'center' }}>
          <div className="wallet-connect-icon" style={{ display: 'inline-flex', padding: 14, borderRadius: '50%', background: 'var(--surface-2)', marginBottom: 16 }}>
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
              <path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
              <path d="M16 3H4a2 2 0 0 0-2 2v2" />
              <circle cx="16" cy="14" r="2" />
            </svg>
          </div>
          <h2 style={{ fontSize: 20, marginBottom: 8 }}>Wallet not connected</h2>
          <p className="muted" style={{ marginBottom: 22, fontSize: 14 }}>
            Connect with the Asentum extension or mobile wallet to see your portfolio and manage your bots.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => wallet.openConnect()}>
            Connect Asentum wallet
          </button>
        </div>
      </section>
    );
  }

  const hexAddr = toHexAddress(wallet.address);
  const ase1Addr = wallet.ase1Address || toAse1(hexAddr);

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Portfolio · Asentum testnet</span>
        <h1 className="detail-title">My portfolio</h1>
        <p className="section-note" style={{ maxWidth: 720 }}>
          Balances, running bots and their history. Every bot is a contract you own — nothing is held by a server.
        </p>

        <div className="balance-hero">
          <div>
            <span className="label">ASE in wallet</span>
            <strong>{nativeHolding ? nativeHolding.balanceFmt : '—'}</strong>
            <small>native balance ready to trade</small>
          </div>
          <div>
            <span className="label">Bots running</span>
            <strong>{runningBots}</strong>
            <small>{userStrategies.length} total · {botsToFinish > 0 ? `${botsToFinish} unarmed` : 'all armed'}</small>
          </div>
          <div>
            <span className="label">Capital in bots</span>
            <strong style={{ color: totalAseInBots > 0n ? 'var(--accent)' : undefined }}>
              {totalAseInBots > 0n ? fmtWei(totalAseInBots, 2) : '0 ASE'}
            </strong>
            <small>locked inside active contracts</small>
          </div>
          <div>
            <span className="label">Gross proceeds</span>
            <strong style={{ color: totalGrossProceeds > 0n ? 'var(--up)' : undefined }}>
              {totalGrossProceeds > 0n ? fmtWei(totalGrossProceeds, 2) : '0 ASE'}
            </strong>
            <small>total ASE received from fills</small>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 16 }}>
          <span className="live-dot">connected</span>
          <span className="mono" style={{ fontSize: 13 }}>{shortAddr(ase1Addr, 14, 8)}</span>
          <button type="button" className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => copyAddress(ase1Addr)}>
            {copiedAddr ? 'Copied' : 'Copy'}
          </button>
          <a href={explorerAddressUrl(hexAddr)} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: 12 }}>
            Explorer ↗
          </a>
          <button type="button" className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: 12 }} onClick={refreshHoldings} disabled={loadingHoldings}>
            {loadingHoldings ? 'Refreshing…' : 'Refresh balances'}
          </button>
        </div>

        <div className="mode-switch" role="tablist" aria-label="Portfolio sections" style={{ marginTop: 26 }}>
          <button type="button" role="tab" aria-selected={activeTab === 'tokens'} className={activeTab === 'tokens' ? 'mode-option active' : 'mode-option'} onClick={() => setActiveTab('tokens')}>
            <span>My tokens ({tokenHoldings.length + (nativeHolding ? 1 : 0)})</span>
            <small>Wallet balances</small>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'bots'} className={activeTab === 'bots' ? 'mode-option active' : 'mode-option'} onClick={() => setActiveTab('bots')}>
            <span>My bots ({userStrategies.length})</span>
            <small>Manage & withdraw</small>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'activity'} className={activeTab === 'activity' ? 'mode-option active' : 'mode-option'} onClick={() => setActiveTab('activity')}>
            <span>Activity ({userTxs.length})</span>
            <small>Transactions</small>
          </button>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 90 }}>
        {activeTab === 'tokens' && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <span className="label">Wallet balances</span>
                <p className="muted" style={{ marginTop: 3, fontSize: 13 }}>Start a bot straight from the token you already hold.</p>
              </div>
              <Link to="/deploy" className="btn btn-primary" style={{ fontSize: 13 }}>+ Create a bot</Link>
            </div>

            {loadingHoldings && holdings.length === 0 ? (
              <div className="panel-body muted">Scanning wallet balances on Asentum…</div>
            ) : holdings.length === 0 ? (
              <div className="panel-body">
                <div className="empty-state">
                  <h3 style={{ fontSize: 17, marginBottom: 8 }}>No balances found for this wallet</h3>
                  <p style={{ fontSize: 14 }}>
                    Checked the native ASE balance and {allPools.length} live pool tokens across Auras and AseDex.
                    If you expect a token here, use Refresh balances — a slow RPC read can leave a token out of the first pass.
                    You need tokens to run a selling bot; DCA bots buy with ASE, so they work with an ASE balance alone.
                  </p>
                  <Link to="/deploy?template=dca" className="btn btn-primary" style={{ marginTop: 14 }}>
                    Start a DCA bot →
                  </Link>
                </div>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="leaderboard-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Balance</th>
                      <th>Venue</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nativeHolding && (
                      <tr>
                        <td><strong>ASE</strong> <span className="muted" style={{ fontSize: 12 }}>· native</span></td>
                        <td><strong>{nativeHolding.balanceFmt} ASE</strong></td>
                        <td><span className="badge">Gas</span></td>
                        <td style={{ textAlign: 'right' }}>
                          <Link to="/deploy?template=dca" className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 13 }}>
                            + Create DCA bot
                          </Link>
                        </td>
                      </tr>
                    )}
                    {tokenHoldings.map((token) => (
                      <tr key={token.token}>
                        <td>
                          <strong>{token.symbol}</strong>
                          <a href={explorerAddressUrl(token.token)} target="_blank" rel="noreferrer" className="muted mono" style={{ fontSize: 11, marginLeft: 8 }}>
                            {shortAddr(token.token)}
                          </a>
                        </td>
                        <td><strong>{token.balanceFmt} {token.symbol}</strong></td>
                        <td><span className="badge" style={{ textTransform: 'capitalize' }}>{token.venue}</span></td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '5px 12px', fontSize: 13 }}
                            onClick={() => navigate(`/deploy?pool=${token.poolId}&venue=${token.venue === 'asedex' ? 'asepad' : 'strata'}&token=${token.token}`)}
                          >
                            + Create a bot
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'bots' && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <span className="label">My bots</span>
                <p className="muted" style={{ marginTop: 3, fontSize: 13 }}>Open a bot to stop it, withdraw ASE or reclaim unsold tokens.</p>
              </div>
              <Link to="/deploy" className="btn btn-primary" style={{ fontSize: 13 }}>+ New bot</Link>
            </div>
            <div className="panel-body">
              {userStrategies.length === 0 ? (
                <div className="empty-state">
                  <h3 style={{ fontSize: 17, marginBottom: 8 }}>No bots yet</h3>
                  <p style={{ fontSize: 14 }}>Pick a strategy, set an amount and launch. Your wallet signs every step.</p>
                  <Link to="/deploy" className="btn btn-primary" style={{ marginTop: 14 }}>Launch your first bot →</Link>
                </div>
              ) : (
                <div className="bot-grid">
                  {userStrategies.map((strategy) => {
                    const liveMatch = (liveStrategies.data ?? []).find(
                      (item) => item.address.toLowerCase() === strategy.address.toLowerCase(),
                    );
                    const status = statusOf(strategy.status, liveMatch);
                    const bot = botTypeFor(strategy.template);
                    return (
                      <div className="bot-card" key={strategy.address}>
                        <div className="bot-card-head">
                          <div>
                            <div className="bot-card-title">
                              <span className="bot-card-mark" aria-hidden="true">{bot?.mark ?? 'BOT'}</span>
                              {bot?.title ?? strategy.templateName ?? strategy.template}
                            </div>
                            <div className="bot-card-pair">
                              {strategy.tokenSymbol || 'TOKEN'} / ASE · {strategy.venue === 'asedex' ? 'AseDex' : 'Auras'}
                            </div>
                          </div>
                          <span className={status.className}>{status.label}</span>
                        </div>

                        <div className="bot-facts">
                          <div><span>Plan</span><strong>{planLabel(strategy)}</strong></div>
                          <div>
                            <span>Amount</span>
                            <strong>
                              {strategy.template === 'dca'
                                ? `${strategy.buyBudgetAse || strategy.budget || '—'} ASE`
                                : strategy.template === 'grid'
                                  ? `${strategy.budget || '—'} ${strategy.tokenSymbol || ''}${strategy.buyBudgetAse ? ` + ${strategy.buyBudgetAse} ASE` : ''}`
                                  : strategy.budget ? `${strategy.budget} ${strategy.tokenSymbol ?? ''}` : '—'}
                            </strong>
                          </div>
                          <div><span>Cadence</span><strong>{everyLabel(strategy.interval)}</strong></div>
                          <div>
                            <span>Progress</span>
                            <strong style={{ color: 'var(--accent)' }}>
                              {(() => {
                                if (!liveMatch) return new Date(strategy.createdAt).toLocaleDateString();
                                const trades = liveMatch.trades;
                                if (strategy.template === 'dca') {
                                  const totalBudget = Number(strategy.buyBudgetAse || strategy.budget || '0');
                                  const perBuy = Number(strategy.buySizeAse || strategy.size || '0');
                                  const totalRuns = perBuy > 0 ? Math.floor(totalBudget / perBuy) : 0;
                                  if (totalRuns > 0) {
                                    const pct = Math.min(100, Math.round((trades / totalRuns) * 100));
                                    return `${trades} of ${totalRuns} buys (${pct}%)`;
                                  }
                                }
                                if (strategy.template === 'twap') {
                                  const totalSlices = Number(strategy.slices || '0');
                                  if (totalSlices > 0) {
                                    const pct = Math.min(100, Math.round((trades / totalSlices) * 100));
                                    return `${trades} of ${totalSlices} orders (${pct}%)`;
                                  }
                                }
                                if (strategy.template === 'scale') {
                                  const totalLevels = Number(strategy.levels || '0');
                                  if (totalLevels > 0) {
                                    const pct = Math.min(100, Math.round((trades / totalLevels) * 100));
                                    return `${trades} of ${totalLevels} tiers (${pct}%)`;
                                  }
                                }
                                if (strategy.template === 'limit-exit') {
                                  return trades > 0 ? 'Executed (100%)' : 'Monitoring price';
                                }
                                return `${trades} trade${trades === 1 ? '' : 's'} executed`;
                              })()}
                            </strong>
                          </div>
                          {liveMatch && BigInt(liveMatch.balanceAse || '0') > 0n && (
                            <div>
                              <span>In contract</span>
                              <strong>{fmtWei(liveMatch.balanceAse, 3)}</strong>
                            </div>
                          )}
                          {liveMatch && BigInt(liveMatch.realisedWei || '0') > 0n && (
                            <div>
                              <span>Proceeds</span>
                              <strong style={{ color: 'var(--up)' }}>{fmtWei(liveMatch.realisedWei, 3)}</strong>
                            </div>
                          )}
                        </div>

                        {strategy.status === 'deployed' && (
                          <div className="notice" style={{ borderLeftColor: '#e8b84b', background: 'rgba(232, 184, 75, 0.08)' }}>
                            <strong style={{ color: '#e8b84b' }}>Setup incomplete (unarmed)</strong>
                            <p style={{ margin: '4px 0 8px', fontSize: 12.5 }}>The contract is on-chain but its schedule was not started.</p>
                            <Link to={`/strategies/${strategy.address}`} className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }}>
                              Finish setup & arm bot →
                            </Link>
                          </div>
                        )}

                        <div className="bot-actions">
                          <Link to={`/strategies/${strategy.address}`} className="btn btn-primary" style={{ fontSize: 12.5 }}>
                            Manage bot
                          </Link>
                          <Link to={`/strategies/${strategy.address}`} className="btn btn-ghost" style={{ fontSize: 12.5 }}>
                            Stop / Withdraw
                          </Link>
                          <a className="btn btn-ghost" href={explorerAddressUrl(strategy.address)} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, flex: '0 0 auto', padding: '0 10px' }}>
                            Explorer ↗
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <span className="label">Transaction activity</span>
                <p className="muted" style={{ marginTop: 3, fontSize: 13 }}>Deployments, starts, deposits and withdrawals from this wallet.</p>
              </div>
            </div>
            {userTxs.length === 0 ? (
              <div className="panel-body">
                <div className="empty-state">No transactions recorded in this browser yet.</div>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="leaderboard-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Action</th>
                      <th>Transaction</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userTxs.map((tx) => (
                      <tr key={tx.hash}>
                        <td className="muted" style={{ fontSize: 12 }}>{new Date(tx.timestamp).toLocaleTimeString()}</td>
                        <td><strong>{tx.description}</strong></td>
                        <td className="mono" style={{ fontSize: 12 }}>
                          <a href={explorerTxUrl(tx.hash)} target="_blank" rel="noreferrer">{shortAddr(tx.hash)} ↗</a>
                        </td>
                        <td>
                          {tx.status === 'confirmed' ? (
                            <span className="badge" style={{ color: 'var(--up)', borderColor: 'var(--up)' }}>Confirmed</span>
                          ) : tx.status === 'pending' ? (
                            <span className="badge" style={{ color: '#e8b84b', borderColor: '#e8b84b' }}>Pending</span>
                          ) : (
                            <span className="badge" style={{ color: 'var(--down)', borderColor: 'var(--down)' }}>Failed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
