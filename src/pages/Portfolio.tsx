import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsentum, useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { loadPools, loadAseDexPools, loadStrategies } from '../lib/registry';
import { explorerAddressUrl, explorerTxUrl, toAse1, toHexAddress } from '../lib/rpc';
import { fmtWei, shortAddr, weiToAse } from '../lib/format';
import { botTypeFor } from '../lib/templates';
import {
  fetchUserTokenHoldings,
  getUserStrategies,
  getUserTxs,
  saveUserStrategy,
  saveUserTx,
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
  // A receipt-confirmed stop wins over a status read that may be stale.
  if (status === 'stopped') return { label: 'Stopped', className: 'status-badge off' };
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

function amountLabel(record: DeployedStrategyRecord): string {
  if (record.template === 'dca') return `${record.buyBudgetAse || record.budget || '—'} ASE`;
  if (record.template === 'grid') {
    return `${record.budget || '—'} ${record.tokenSymbol || ''}${record.buyBudgetAse ? ` + ${record.buyBudgetAse} ASE` : ''}`.trim();
  }
  return record.budget ? `${record.budget} ${record.tokenSymbol ?? ''}`.trim() : '—';
}

const ALLOC_COLORS = ['var(--accent)', 'var(--accent-2)', 'var(--up)', 'var(--warn)', 'var(--dim)'];

export function Portfolio() {
  const wallet = useWallet();
  const client = useAsentum();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'tokens' | 'bots' | 'activity'>('tokens');
  const [holdings, setHoldings] = useState<UserTokenHolding[]>([]);
  const [loadingHoldings, setLoadingHoldings] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const [botNotice, setBotNotice] = useState<Record<string, { kind: 'ok' | 'err'; text: string }>>({});

  const pools = useAsync(() => loadPools(), 60_000);
  const asedexPools = useAsync(() => loadAseDexPools(), 60_000);
  const liveStrategies = useAsync(
    () => loadStrategies(wallet.address ?? undefined),
    25000,
    true,
    wallet.address,
  );

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

  const stopBot = async (record: DeployedStrategyRecord) => {
    if (!wallet.connected || !wallet.address) {
      wallet.openConnect();
      return;
    }
    setStopping(record.address);
    setBotNotice((prev) => ({ ...prev, [record.address]: { kind: 'ok', text: 'Confirm the stop in your wallet…' } }));
    try {
      const hash = await client.call(record.address, 'stop', []);
      saveUserTx(wallet.address, {
        hash,
        type: 'cancel',
        description: `Stop ${record.templateName ?? record.template} bot`,
        timestamp: Date.now(),
        status: 'pending',
        strategyAddress: record.address,
      });
      setBotNotice((prev) => ({ ...prev, [record.address]: { kind: 'ok', text: 'Stop sent · waiting for the receipt…' } }));
      const receipt = await client.waitReceipt(hash, 120_000);
      if (!receipt.success) throw new Error('The stop transaction reverted on chain.');
      saveUserTx(wallet.address, {
        hash,
        type: 'cancel',
        description: `Stop ${record.templateName ?? record.template} bot`,
        timestamp: Date.now(),
        status: 'confirmed',
        strategyAddress: record.address,
      });
      saveUserStrategy({ ...record, status: 'stopped' });
      setBotNotice((prev) => ({ ...prev, [record.address]: { kind: 'ok', text: `Bot stopped · ${hash.slice(0, 12)}…` } }));
      liveStrategies.refresh();
      void refreshHoldings();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const text = /reject|denied|cancel|declin/i.test(raw)
        ? 'The wallet rejected the transaction. The bot keeps running.'
        : raw;
      setBotNotice((prev) => ({ ...prev, [record.address]: { kind: 'err', text } }));
    } finally {
      setStopping(null);
    }
  };

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
  const runningBots = userStrategies.filter(
    (strategy) => strategy.status === 'active' || strategy.status === 'funded',
  ).length;
  const botsToFinish = userStrategies.filter(
    (strategy) => strategy.status === 'deployed' || strategy.status === 'initialized',
  ).length;

  const allocation = useMemo(() => {
    const rows = holdings.map((holding) => {
      let valueAse = 0;
      if (holding.isNative) {
        valueAse = holding.balanceNum;
      } else {
        const pool = allPools.find((item) => item.id === holding.poolId && item.token.toLowerCase() === holding.token.toLowerCase())
          ?? allPools.find((item) => item.token.toLowerCase() === holding.token.toLowerCase());
        valueAse = pool ? holding.balanceNum * Number(weiToAse(pool.spot, 6)) : 0;
      }
      return { holding, valueAse };
    });
    const total = rows.reduce((sum, row) => sum + row.valueAse, 0);
    return { rows: rows.sort((a, b) => b.valueAse - a.valueAse), total };
  }, [holdings, allPools]);

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
      <section className="wrap" style={{ padding: '70px 0 100px' }}>
        <div className="detail-head" style={{ paddingTop: 0 }}>
          <span className="label">Portfolio · Asentum testnet</span>
          <h1 className="detail-title">Your capital, in one view.</h1>
          <p className="section-note" style={{ maxWidth: 620 }}>
            Connect a wallet to see balances, the bots you run, the capital committed to them and every
            transaction they made.
          </p>
        </div>

        <div className="panel" style={{ maxWidth: 520, margin: '34px 0', padding: '34px 28px' }}>
          <div className="wallet-connect-icon">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
              <path d="M16 3H4a2 2 0 0 0-2 2v2" />
              <circle cx="16" cy="14" r="2" />
            </svg>
          </div>
          <h2 style={{ fontSize: 22, marginBottom: 8 }}>Wallet not connected</h2>
          <p className="muted" style={{ marginBottom: 22, fontSize: 13.5, lineHeight: 1.65 }}>
            Connect with the Asentum extension or mobile wallet. Strata reads your balances and contracts; it
            never takes custody of your funds.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => wallet.openConnect()}>
              Connect Asentum wallet
            </button>
            <Link className="btn btn-ghost" to="/strategies">
              Browse strategies
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const hexAddr = toHexAddress(wallet.address);
  const ase1Addr = wallet.ase1Address || toAse1(hexAddr);

  return (
    <>
      <section className="wrap detail-head">
        <div className="pf-head">
          <div>
            <span className="label">Portfolio · Asentum testnet</span>
            <h1 className="detail-title" style={{ marginBottom: 10 }}>My portfolio</h1>
            <p className="section-note" style={{ maxWidth: 560 }}>
              Balances, running bots and their history. Every bot is a contract you own — nothing is held by a
              server.
            </p>
          </div>
          <Link className="btn btn-primary" to="/deploy">
            Create a bot <span className="arr" aria-hidden="true">→</span>
          </Link>
        </div>

        <div className="pf-address">
          <span className="live-dot">Connected</span>
          <span className="mono" style={{ color: 'var(--text-2)' }}>{shortAddr(ase1Addr, 14, 8)}</span>
          <button type="button" className="chip" onClick={() => copyAddress(ase1Addr)}>
            {copiedAddr ? 'Copied' : 'Copy address'}
          </button>
          <a href={explorerAddressUrl(hexAddr)} target="_blank" rel="noreferrer" className="chip">
            Explorer ↗
          </a>
          <button type="button" className="chip" onClick={refreshHoldings} disabled={loadingHoldings}>
            {loadingHoldings ? 'Refreshing…' : 'Refresh balances'}
          </button>
        </div>

        {(() => {
          const botValue = Number(weiToAse(totalAseInBots, 2));
          const totalValue = allocation.total + botValue;
          const deployedPct = totalValue > 0 ? Math.min(100, (botValue / totalValue) * 100) : 0;
          return (
            <div className="pf-value">
              <div>
                <span className="label">Estimated portfolio value</span>
                <strong>
                  {totalValue > 0 ? `${totalValue.toLocaleString('en-US', { maximumFractionDigits: 2 })} ASE` : '—'}
                </strong>
                <small>
                  Wallet balances at the current AMM spot plus ASE held by your contracts. Token inventory still
                  inside a contract is not marked to market here.
                </small>
              </div>
              <div className="pf-value-side">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span className="label">Deployed</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>
                    {deployedPct.toFixed(1)}%
                  </span>
                </div>
                <div className="alloc-bar" style={{ marginTop: 8 }}>
                  <span style={{ width: `${Math.max(0.5, deployedPct)}%`, background: 'var(--accent)' }} />
                </div>
                <div className="pf-value-split">
                  <span>Wallet <b className="mono">{allocation.total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b></span>
                  <span>In bots <b className="mono">{botValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b></span>
                </div>
              </div>
            </div>
          );
        })()}

        <div className="balance-hero">
          <div>
            <span className="label">ASE in wallet</span>
            <strong>{nativeHolding ? nativeHolding.balanceFmt : '—'}</strong>
            <small>Native balance ready to trade</small>
          </div>
          <div>
            <span className="label">Capital in bots</span>
            <strong style={{ color: totalAseInBots > 0n ? 'var(--accent)' : undefined }}>
              {totalAseInBots > 0n ? fmtWei(totalAseInBots, 2) : '0 ASE'}
            </strong>
            <small>Locked inside active contracts</small>
          </div>
          <div>
            <span className="label">Gross proceeds</span>
            <strong style={{ color: totalGrossProceeds > 0n ? 'var(--up)' : undefined }}>
              {totalGrossProceeds > 0n ? fmtWei(totalGrossProceeds, 2) : '0 ASE'}
            </strong>
            <small>Total ASE received from fills</small>
          </div>
          <div>
            <span className="label">Bots running</span>
            <strong>{runningBots}</strong>
            <small>
              {userStrategies.length} total · {botsToFinish > 0 ? `${botsToFinish} unarmed` : 'all armed'}
            </small>
          </div>
        </div>

        {holdings.length > 0 && allocation.total > 0 && (
          <div className="alloc" style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
              <span className="label">Estimated allocation</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>
                {allocation.total.toLocaleString('en-US', { maximumFractionDigits: 2 })} ASE at current pool spot
              </span>
            </div>
            <div className="alloc-bar">
              {allocation.rows.map((row, index) => (
                <span
                  key={row.holding.token}
                  style={{
                    width: `${Math.max(1, (row.valueAse / allocation.total) * 100)}%`,
                    background: ALLOC_COLORS[index % ALLOC_COLORS.length],
                  }}
                  title={`${row.holding.symbol} · ${((row.valueAse / allocation.total) * 100).toFixed(1)}%`}
                />
              ))}
            </div>
            <div className="alloc-legend">
              {allocation.rows.slice(0, 6).map((row, index) => (
                <span key={row.holding.token}>
                  <i style={{ background: ALLOC_COLORS[index % ALLOC_COLORS.length] }} />
                  {row.holding.symbol} {((row.valueAse / allocation.total) * 100).toFixed(1)}%
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mode-switch" role="tablist" aria-label="Portfolio sections">
          <button type="button" role="tab" aria-selected={activeTab === 'tokens'} className={activeTab === 'tokens' ? 'mode-option active' : 'mode-option'} onClick={() => setActiveTab('tokens')}>
            <span>Assets ({tokenHoldings.length + (nativeHolding ? 1 : 0)})</span>
            <small>Wallet balances</small>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'bots'} className={activeTab === 'bots' ? 'mode-option active' : 'mode-option'} onClick={() => setActiveTab('bots')}>
            <span>Bots ({userStrategies.length})</span>
            <small>Manage & withdraw</small>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'activity'} className={activeTab === 'activity' ? 'mode-option active' : 'mode-option'} onClick={() => setActiveTab('activity')}>
            <span>Activity ({userTxs.length})</span>
            <small>Transactions</small>
          </button>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 96 }}>
        {activeTab === 'tokens' && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <span className="label">Wallet balances</span>
                <p className="muted" style={{ marginTop: 4 }}>
                  Start a bot straight from the token you already hold.
                </p>
              </div>
              <Link to="/deploy" className="btn btn-ghost btn-sm">
                Create a bot
              </Link>
            </div>

            {loadingHoldings && holdings.length === 0 ? (
              <div className="panel-body">
                <div style={{ display: 'grid', gap: 10 }}>
                  {[0, 1, 2].map((row) => (
                    <div className="skeleton" key={row} style={{ height: 38 }} />
                  ))}
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>Scanning wallet balances on Asentum…</p>
              </div>
            ) : holdings.length === 0 ? (
              <div className="panel-body">
                <div className="empty-state">
                  <h3>No balances found for this wallet</h3>
                  <p style={{ fontSize: 13.5 }}>
                    Checked the native ASE balance and {allPools.length} live pool tokens across Auras and AseDex.
                    If you expect a token here, use Refresh balances — a slow RPC read can leave a token out of the
                    first pass. You need tokens to run a selling bot; DCA bots buy with ASE, so they work with an
                    ASE balance alone.
                  </p>
                  <Link to="/deploy?template=dca" className="btn btn-primary btn-sm" style={{ marginTop: 10 }}>
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
                      <th>Est. value</th>
                      <th>Venue</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nativeHolding && (
                      <tr>
                        <td>
                          <strong>ASE</strong> <span className="muted" style={{ fontSize: 11.5 }}>· native</span>
                        </td>
                        <td className="mono"><strong>{nativeHolding.balanceFmt} ASE</strong></td>
                        <td className="mono">{nativeHolding.balanceFmt} ASE</td>
                        <td><span className="badge">Gas</span></td>
                        <td style={{ textAlign: 'right' }}>
                          <Link to="/deploy?template=dca" className="btn btn-ghost btn-sm">
                            Create DCA bot
                          </Link>
                        </td>
                      </tr>
                    )}
                    {tokenHoldings.map((token) => {
                      const pool = allPools.find((item) => item.id === token.poolId)
                        ?? allPools.find((item) => item.token.toLowerCase() === token.token.toLowerCase());
                      const estimated = pool ? token.balanceNum * Number(weiToAse(pool.spot, 6)) : null;
                      return (
                        <tr key={token.token}>
                          <td>
                            <strong>{token.symbol}</strong>
                            <a href={explorerAddressUrl(token.token)} target="_blank" rel="noreferrer" className="muted mono" style={{ fontSize: 10.5, marginLeft: 8 }}>
                              {shortAddr(token.token)}
                            </a>
                          </td>
                          <td className="mono"><strong>{token.balanceFmt} {token.symbol}</strong></td>
                          <td className="mono">
                            {estimated === null
                              ? <span className="dim">No live pool</span>
                              : `${estimated.toLocaleString('en-US', { maximumFractionDigits: 2 })} ASE`}
                          </td>
                          <td>
                            <span className="badge" style={{ textTransform: 'capitalize' }}>{token.venue}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => navigate(`/deploy?pool=${token.poolId}&venue=${token.venue === 'asedex' ? 'asepad' : 'strata'}&token=${token.token}`)}
                            >
                              Create a bot
                            </button>
                          </td>
                        </tr>
                      );
                    })}
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
                <p className="muted" style={{ marginTop: 4 }}>
                  Open a bot to stop it, withdraw ASE or reclaim unsold tokens.
                </p>
              </div>
              <Link to="/deploy" className="btn btn-ghost btn-sm">
                New bot
              </Link>
            </div>
            <div className="panel-body">
              {userStrategies.length === 0 ? (
                <div className="empty-state">
                  <h3>No bots yet</h3>
                  <p style={{ fontSize: 13.5 }}>Pick a strategy, set an amount and launch. Your wallet signs every step.</p>
                  <Link to="/deploy" className="btn btn-primary btn-sm" style={{ marginTop: 10 }}>
                    Launch your first bot →
                  </Link>
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
                          <div><span>Amount</span><strong>{amountLabel(strategy)}</strong></div>
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
                          <div className="notice" style={{ borderLeftColor: 'var(--warn)', background: 'var(--warn-soft)' }}>
                            <strong style={{ color: 'var(--warn)' }}>Setup incomplete (unarmed)</strong>
                            <span>The contract is on-chain but its schedule was not started.</span>
                            <Link to={`/strategies/${strategy.address}`} className="link-arrow" style={{ marginTop: 6 }}>
                              Finish setup & arm bot →
                            </Link>
                          </div>
                        )}

                        {botNotice[strategy.address] && (
                          <p
                            role={botNotice[strategy.address].kind === 'err' ? 'alert' : 'status'}
                            className={botNotice[strategy.address].kind === 'err' ? 'swap-note down' : 'swap-note muted'}
                            style={{ margin: '0 0 10px' }}
                          >
                            {botNotice[strategy.address].text}
                          </p>
                        )}

                        <div className="bot-actions">
                          <Link to={`/strategies/${strategy.address}`} className="btn btn-primary">
                            Manage bot
                          </Link>
                          {liveMatch?.stopped !== true && strategy.status !== 'failed' && (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={stopping === strategy.address}
                              onClick={() => void stopBot(strategy)}
                            >
                              {stopping === strategy.address ? 'Stopping…' : 'Stop bot'}
                            </button>
                          )}
                          <Link to={`/strategies/${strategy.address}`} className="btn btn-ghost">
                            Withdraw
                          </Link>
                          <a className="btn btn-ghost" href={explorerAddressUrl(strategy.address)} target="_blank" rel="noreferrer" style={{ flex: '0 0 auto', padding: '0 10px' }}>
                            ↗
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
                <p className="muted" style={{ marginTop: 4 }}>
                  Deployments, starts, deposits and withdrawals from this wallet.
                </p>
              </div>
              <Link to="/activity" className="btn btn-ghost btn-sm">
                Network activity
              </Link>
            </div>
            {userTxs.length === 0 ? (
              <div className="panel-body">
                <div className="empty-state">
                  <h3>No transactions recorded yet</h3>
                  <p style={{ fontSize: 13.5 }}>
                    This list is built from the transactions this browser recorded for your wallet. Deploy a bot
                    and each signed step appears here.
                  </p>
                </div>
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
                      <th>Contract</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userTxs.map((tx) => (
                      <tr key={tx.hash}>
                        <td className="mono dim" style={{ fontSize: 11 }}>
                          {new Date(tx.timestamp).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td><strong>{tx.description}</strong></td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          <a href={explorerTxUrl(tx.hash)} target="_blank" rel="noreferrer" className="wallet-link">
                            {shortAddr(tx.hash)} ↗
                          </a>
                        </td>
                        <td>
                          <span className={tx.status === 'confirmed' ? 'status-badge live' : tx.status === 'pending' ? 'status-badge pending' : 'status-badge off'}>
                            {tx.status}
                          </span>
                        </td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {tx.strategyAddress ? (
                            <Link to={`/strategies/${tx.strategyAddress}`} className="wallet-link">
                              {shortAddr(tx.strategyAddress)}
                            </Link>
                          ) : (
                            <span className="dim">—</span>
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
