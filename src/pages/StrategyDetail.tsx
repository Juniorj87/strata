import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAsentum, useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { loadStrategy, type LiveStrategy } from '../lib/registry';
import { explorerAddressUrl, explorerTxUrl, toAse1, toHexAddress } from '../lib/rpc';
import { fmtDuration, fmtWei, shortHash, weiToAse } from '../lib/format';
import { CodeBlock } from '../components/CodeBlock';
import { MARKETPLACE_ADDRESS } from '../lib/marketplace';
import { StrategyPnlPanel } from '../components/StrategyPnlPanel';
import { botTypeFor } from '../lib/templates';
import { getUserStrategies, saveUserStrategy, saveUserTx } from '../lib/userStrategies';

function nextRunLabel(cron: { nextRunAt: string } | null): string {
  if (!cron?.nextRunAt) return 'not scheduled';
  const raw = Number(cron.nextRunAt);
  if (!Number.isFinite(raw) || raw === 0) return 'not scheduled';
  const seconds = raw > 1e12 ? Math.floor((raw - Date.now()) / 1000) : Math.floor(raw - Date.now() / 1000);
  return seconds > 0 ? `in ${fmtDuration(seconds)}` : 'due now';
}

function formatToken(raw: bigint, decimals: number, symbol: string): string {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} ${symbol}`.trim();
}

interface FillRow {
  key: string;
  block: number;
  side: 'Bought' | 'Sold';
  amount: string;
  ase: string;
  txHash: string;
}

function buildFills(strategy: LiveStrategy): FillRow[] {
  const tokenAddress = (strategy.token ?? '').toLowerCase();
  if (!tokenAddress) return [];
  return strategy.fillEvents
    .slice()
    .sort((a, b) => b.block - a.block)
    .slice(0, 20)
    .map((event) => {
      const amountIn = BigInt(String(event.args.amountIn ?? '0'));
      const amountOut = BigInt(String(event.args.amountOut ?? '0'));
      const sold = String(event.args.tokenIn ?? '').toLowerCase() === tokenAddress;
      const amount = sold ? amountIn : amountOut;
      const ase = sold ? amountOut : amountIn;
      return {
        key: `${event.txHash}-${event.block}-${event.name}`,
        block: event.block,
        side: sold ? 'Sold' : 'Bought',
        amount: strategy.tokenDecimals !== null
          ? formatToken(amount, strategy.tokenDecimals, strategy.symbol ?? '')
          : `${amount.toString()} raw`,
        ase: fmtWei(ase, 4),
        txHash: event.txHash,
      } satisfies FillRow;
    });
}

export function StrategyDetail() {
  const { address = '' } = useParams();
  const wallet = useWallet();
  const client = useAsentum();
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [marketTitle, setMarketTitle] = useState('');
  const [marketDescription, setMarketDescription] = useState('');
  const [marketTags, setMarketTags] = useState('');
  const [marketStatus, setMarketStatus] = useState('');
  const { data: strategy, loading, error, refresh } = useAsync(
    () => loadStrategy(address.toLowerCase()),
    12000,
    address.length > 0,
  );

  const userHex = wallet.address ? (() => { try { return toHexAddress(wallet.address).toLowerCase(); } catch { return wallet.address.toLowerCase(); } })() : '';
  const userAse1 = wallet.ase1Address ? wallet.ase1Address.toLowerCase() : (userHex ? toAse1(userHex).toLowerCase() : '');

  const userStrategies = wallet.address ? getUserStrategies(wallet.address) : [];
  const localMatch = userStrategies.find(
    (s) => s.address.toLowerCase() === address.toLowerCase()
  );

  const walletIsOwner = Boolean(
    localMatch || (
      strategy?.owner && (userHex || userAse1) && (() => {
        const ownerLower = strategy.owner.toLowerCase();
        try {
          if (userHex && userHex === ownerLower) return true;
          if (userAse1 && userAse1 === ownerLower) return true;
          if (userAse1 && toHexAddress(userAse1).toLowerCase() === ownerLower) return true;
          if (userHex && toAse1(userHex).toLowerCase() === ownerLower) return true;
        } catch {
          if (userHex === ownerLower || userAse1 === ownerLower) return true;
        }
        return false;
      })()
    )
  );

  const publishToMarketplace = async () => {
    if (!strategy || !walletIsOwner || !MARKETPLACE_ADDRESS) return;
    setActionBusy(true);
    setMarketStatus('');
    setActionError('');
    try {
      const title = marketTitle.trim() || strategy.name;
      const txHash = await client.call(MARKETPLACE_ADDRESS, 'publishStrategy', [strategy.address, title, marketDescription.trim(), marketTags.trim()]);
      const receipt = await client.waitReceipt(txHash, 120000);
      if (!receipt.success) throw new Error('Marketplace publication reverted. Inspect the transaction receipt.');
      setMarketStatus(`Published on-chain · ${txHash.slice(0, 12)}…`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  };

  const runOwnerAction = async (method: 'stop' | 'withdraw' | 'withdrawTokens') => {
    const recipient = userAse1 || userHex;
    if (!walletIsOwner || !recipient) return;
    setActionBusy(true);
    setActionMessage('');
    setActionError('');
    try {
      let args: string[] = [];
      if (method === 'withdraw') {
        const amount = BigInt(strategy?.balanceAse || '0');
        if (amount <= 0n) throw new Error('The bot contract has no ASE balance to withdraw.');
        args = [recipient, amount.toString()];
      } else if (method === 'withdrawTokens') {
        args = [recipient];
      }
      const target = strategy?.ase1 || strategy?.address || address;
      const txHash = await client.call(target, method, args);
      if (wallet.address && method === 'stop') {
        saveUserTx(wallet.address, {
          hash: txHash,
          type: 'cancel',
          description: `Stop ${strategy?.name ?? 'bot'}`,
          timestamp: Date.now(),
          status: 'pending',
          strategyAddress: strategy?.address ?? address,
        });
      }
      const receipt = await client.waitReceipt(txHash, 120000);
      if (!receipt.success) throw new Error(`${method} transaction reverted. Open the transaction in the explorer for details.`);
      if (method === 'stop' && wallet.address && strategy) {
        const record = getUserStrategies(wallet.address).find(
          (item) => item.address.toLowerCase() === strategy.address.toLowerCase(),
        );
        if (record) saveUserStrategy({ ...record, status: 'stopped' });
        saveUserTx(wallet.address, {
          hash: txHash,
          type: 'cancel',
          description: `Stop ${strategy.name}`,
          timestamp: Date.now(),
          status: 'confirmed',
          strategyAddress: strategy.address,
        });
      }
      setActionMessage(
        `${method === 'stop' ? 'Bot stopped' : method === 'withdraw' ? 'ASE withdrawn' : 'Tokens reclaimed'} · ${txHash.slice(0, 12)}…`,
      );
      refresh();
      if (method === 'stop') {
        // The node can lag one block; keep re-reading until the contract
        // reports stopped instead of leaving the badge on "Active".
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          refresh();
        }
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  };

  if (loading && !strategy) {
    return (
      <section className="wrap section" style={{ minHeight: 380 }}>
        <div className="detail-head">
          <span className="label">
            {localMatch ? `${localMatch.template.toUpperCase()} bot` : 'Connecting to bot'}
          </span>
          <h1 className="detail-title">{localMatch ? (localMatch.templateName || `${localMatch.template} bot`) : 'Loading contract…'}</h1>
          <p className="section-note" style={{ color: 'var(--accent)' }}>
            Reading live bot state from Asentum…
          </p>
        </div>
        <div className="skeleton" style={{ height: 240, marginTop: 16 }} />
      </section>
    );
  }

  if (error || !strategy) {
    return (
      <section className="wrap section">
        <h1 className="detail-title">Bot not found</h1>
        <p className="muted">
          {error ? `Chain read failed: ${error}` : 'No contract source at that address - it may not exist yet.'}
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button type="button" className="btn btn-primary" onClick={refresh}>
            Retry loading
          </button>
          <Link className="btn btn-ghost" to="/portfolio">
            Back to portfolio
          </Link>
        </div>
      </section>
    );
  }

  const bot = botTypeFor(strategy.template);
  // A confirmed stop is stored locally as well: if the status read lags or
  // the node rate-limits it, the page must not keep showing the bot as active.
  const knownStopped = strategy.stopped === true || localMatch?.status === 'stopped';
  const running = !knownStopped && strategy.cron !== null;
  const statusLabel = knownStopped ? 'Stopped' : running ? 'Active & Trading' : 'Idle / Unarmed';
  const statusClass = knownStopped ? 'status-badge off' : running ? 'status-badge live' : 'status-badge pending';
  const fills = buildFills(strategy);
  const canWithdrawAse = BigInt(strategy.balanceAse || '0') > 0n
    && !((strategy.template === 'grid' || strategy.template === 'dca') && !knownStopped);

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">
          {bot ? `${bot.title} bot` : `${strategy.template} contract`}
        </span>
        <h1 className="detail-title">{strategy.name}</h1>
        <div className="detail-meta">
          <span className={statusClass}>{statusLabel}</span>
          <span>{strategy.symbol ? `${strategy.symbol} / ASE` : 'pair unavailable'}</span>
          <span>·</span>
          <span className="mono">{strategy.ase1}</span>
          <span>·</span>
          <a className="link-arrow" href={explorerAddressUrl(strategy.address)} target="_blank" rel="noreferrer">
            explorer ↗
          </a>
        </div>

        {walletIsOwner ? (
          <div className="manage-bar">
            <button
              className="btn btn-ghost"
              style={{ borderColor: knownStopped ? undefined : 'var(--down)', color: knownStopped ? undefined : 'var(--down)' }}
              type="button"
              disabled={actionBusy || knownStopped}
              onClick={() => runOwnerAction('stop')}
            >
              {actionBusy ? 'Working…' : 'Stop bot'}
            </button>
            <button
              className={canWithdrawAse ? 'btn btn-primary' : 'btn btn-ghost'}
              type="button"
              disabled={actionBusy || !canWithdrawAse}
              onClick={() => runOwnerAction('withdraw')}
            >
              Withdraw ASE
            </button>
            {strategy.token && strategy.template !== 'momentum-signal' && (
              <button
                className={knownStopped ? 'btn btn-primary' : 'btn btn-ghost'}
                type="button"
                disabled={actionBusy || !knownStopped}
                onClick={() => runOwnerAction('withdrawTokens')}
              >
                Reclaim tokens
              </button>
            )}
          </div>
        ) : (
          <div className="manage-bar">
            <Link className="btn btn-primary" to={`/deploy?template=${strategy.template}`}>Deploy a bot like this</Link>
          </div>
        )}

        {walletIsOwner && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            {knownStopped
              ? 'The schedule is cancelled. Any ASE and tokens left in the contract can be withdrawn.'
              : canWithdrawAse
                ? 'Stop the bot before withdrawing if it still has scheduled runs; unused gas escrow returns to the contract.'
                : 'Stop the bot first to withdraw ASE from a grid or DCA contract, so its reserved buy budget cannot be drained mid-run.'}
          </p>
        )}
        {actionMessage && <p className="muted" role="status" style={{ marginTop: 10 }}>{actionMessage}</p>}
        {actionError && <div className="notice deploy-error" role="alert" style={{ marginTop: 10, maxWidth: 720 }}>{actionError}</div>}
        {wallet.connected && !walletIsOwner && (
          <p className="muted" role="note" style={{ fontSize: 12.5, marginTop: 10 }}>
            The connected wallet is not this bot&apos;s owner, so only its public state is shown. Connect the wallet that
            deployed it to stop or withdraw.
          </p>
        )}
      </section>

      <section className="wrap">
        <div className="metrics">
          <div className="metric">
            <div className="metric-label">Trades</div>
            <div className="metric-value">{strategy.trades}</div>
          </div>
          <div className="metric">
            <div className="metric-label">ASE in contract</div>
            <div className="metric-value">{fmtWei(strategy.balanceAse, 3)}</div>
          </div>
          {strategy.token && strategy.tokenDecimals !== null && (
            <div className="metric">
              <div className="metric-label">Tokens in contract</div>
              <div className="metric-value">
                {formatToken(BigInt(strategy.tokenBalance || '0'), strategy.tokenDecimals, strategy.symbol ?? '')}
              </div>
            </div>
          )}
          <div className="metric">
            <div className="metric-label">Gross received</div>
            <div className="metric-value">{fmtWei(strategy.realisedWei, 3)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Runs every</div>
            <div className="metric-value">
              {strategy.intervalSec ? fmtDuration(strategy.intervalSec) : '-'}
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">Schedule status</div>
            <div className="metric-value" style={{ fontSize: 16 }}>
              {strategy.cron?.runsLeft ? `${strategy.cron.runsLeft} runs left` : knownStopped ? 'Stopped' : 'Continuous'}
            </div>
          </div>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 24 }}>
        {strategy.token && strategy.tokenDecimals !== null && <StrategyPnlPanel strategy={strategy} />}
      </section>

      <section className="wrap" style={{ paddingBottom: 34 }}>
        <div className="panel">
          <div className="panel-head">
            <div>
              <span className="label">Trade history</span>
              <p className="muted" style={{ marginTop: 3, fontSize: 13 }}>Latest on-chain fills for this bot.</p>
            </div>
            <span className="pill pill-live">{fills.length} shown</span>
          </div>
          {fills.length === 0 ? (
            <div className="panel-body muted">No trades yet. The bot will show each fill here once it executes.</div>
          ) : (
            <div className="table-scroll">
              <table className="fills-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Amount</th>
                    <th>ASE</th>
                    <th>Block</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {fills.map((fill) => (
                    <tr key={fill.key}>
                      <td className={fill.side === 'Bought' ? 'fill-buy' : 'fill-sell'}>{fill.side}</td>
                      <td>{fill.amount}</td>
                      <td>{fill.ase}</td>
                      <td className="dim">#{fill.block.toLocaleString('en-US')}</td>
                      <td>
                        <a href={explorerTxUrl(fill.txHash)} target="_blank" rel="noreferrer" className="link-arrow">
                          {shortHash(fill.txHash)} ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 80 }}>
        <div className="panels">
          <div style={{ display: 'grid', gap: 16 }}>
            <details className="dev-accordion">
              <summary>Technical data · contract source, events and schedule (Pro)</summary>
              <div className="panel-body">
                <dl className="kv">
                  <dt>Pool</dt><dd>{strategy.poolId ? `#${strategy.poolId}` : '-'}</dd>
                  <dt>Pair</dt><dd>{strategy.symbol ? `${strategy.symbol}/ASE` : '-'}</dd>
                  <dt>Interval</dt><dd>{strategy.cron ? fmtDuration(Math.round(Number(strategy.cron.intervalSec) / 1000)) : strategy.intervalSec ? fmtDuration(strategy.intervalSec) : '-'}</dd>
                  <dt>Next run</dt><dd>{nextRunLabel(strategy.cron)}</dd>
                  <dt>Runs left</dt><dd>{strategy.cron?.runsLeft ?? '-'}</dd>
                  <dt>Gas escrow</dt><dd>{strategy.cron ? `${weiToAse(strategy.cron.gasEscrow, 4)} ASE` : '-'}</dd>
                  <dt>Job id</dt><dd>{strategy.jobId ?? '-'}</dd>
                  <dt>Deploy block</dt><dd>{strategy.deployBlock.toLocaleString('en-US')}</dd>
                  <dt>Source hash</dt><dd className="break-value">{strategy.codeHash || '-'}</dd>
                  <dt>Read-back hash</dt><dd className="break-value">{strategy.localHash}</dd>
                </dl>
                <p className="muted" style={{ marginTop: 14, fontSize: 12.5 }}>
                  The source returned by the network matches the hash stored in the contract account. This checks source consistency only; it is not a security audit.
                  {strategy.verified ? ' Current status: match.' : ' Current status: could not verify.'}
                </p>
              </div>
            </details>

            <details className="dev-accordion">
              <summary>Contract source · {strategy.source.length.toLocaleString('en-US')} characters</summary>
              <CodeBlock source={strategy.source} />
            </details>

            <details className="dev-accordion">
              <summary>Events · {strategy.events.length} on chain</summary>
              {strategy.events.length === 0 ? (
                <div className="panel-body muted">No events emitted yet.</div>
              ) : (
                strategy.events.map((event) => (
                  <div className="log-row" key={`${event.txHash}-${event.block}-${event.name}`}>
                    <span className="dim">#{event.block.toLocaleString('en-US')}</span>
                    <span>
                      {event.name}
                      <span className="dim" style={{ display: 'block', fontSize: 11 }}>
                        {Object.entries(event.args)
                          .filter(([key]) => key !== 'poolId')
                          .map(([key, value]) => `${key}=${String(value).slice(0, 28)}`)
                          .join('  ')}
                      </span>
                      <a className="dim" style={{ display: 'block', fontSize: 11 }} href={explorerTxUrl(event.txHash)} target="_blank" rel="noreferrer">
                        {shortHash(event.txHash)} ↗
                      </a>
                    </span>
                    <span />
                  </div>
                ))
              )}
            </details>
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            <div className="panel">
              <div className="panel-head">
                <span className="label">Contract</span>
                <span className={strategy.verified ? 'pill pill-live' : 'pill pill-ended'}>{strategy.verified ? 'Verified' : 'Unverified'}</span>
              </div>
              <div className="panel-body">
                <dl className="kv">
                  <dt>Address</dt><dd className="break-value">{strategy.ase1}</dd>
                  <dt>Owner</dt><dd className="break-value">{strategy.owner ?? '-'}</dd>
                  <dt>Status</dt><dd>{statusLabel}</dd>
                </dl>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <a className="btn btn-ghost" href={explorerAddressUrl(strategy.address)} target="_blank" rel="noreferrer" style={{ flex: 1, justifyContent: 'center' }}>Explorer ↗</a>
                  <button className="chip" type="button" onClick={refresh}>Refresh</button>
                </div>
              </div>
            </div>

            {walletIsOwner && (
              <details className="dev-accordion">
                <summary>Publish to marketplace · owner only</summary>
                <div className="panel-body">
                  <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>Share this verified contract so other users can inspect the source and copy its settings. Publishing does not transfer ownership or funds.</p>
                  {MARKETPLACE_ADDRESS ? (
                    <>
                      <div className="field"><label htmlFor="marketTitle">Listing name</label><input id="marketTitle" className="input" value={marketTitle} onChange={(event) => setMarketTitle(event.target.value)} placeholder={strategy.name} maxLength={60} /></div>
                      <div className="field"><label htmlFor="marketDescription">Short description</label><textarea id="marketDescription" className="input" value={marketDescription} onChange={(event) => setMarketDescription(event.target.value)} placeholder="Explain what your bot does and when it may be useful…" maxLength={280} rows={3} /></div>
                      <div className="field"><label htmlFor="marketTags">Tags · optional</label><input id="marketTags" className="input" value={marketTags} onChange={(event) => setMarketTags(event.target.value)} placeholder="dca, conservative, testnet" maxLength={120} /></div>
                      <button className="btn btn-primary" type="button" disabled={actionBusy} onClick={publishToMarketplace}>{actionBusy ? 'Publishing…' : 'Publish bot'}</button>
                      {marketStatus && <p className="muted" role="status" style={{ marginTop: 10 }}>{marketStatus}</p>}
                    </>
                  ) : (
                    <div className="notice"><strong>The shared catalog is being configured</strong><span>The site operator must deploy the shared listing registry first. Your bot is not affected.</span></div>
                  )}
                </div>
              </details>
            )}

            <div className="panel">
              <div className="panel-body" style={{ textAlign: 'center' }}>
                <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
                  Copy this setup with your own amount and interval.
                </p>
                <Link className="btn btn-primary" to={`/deploy?template=${strategy.template}`} style={{ width: '100%', justifyContent: 'center' }}>
                  Create a bot from this one
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
