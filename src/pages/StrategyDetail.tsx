import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsentum, useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { loadStrategy, type LiveStrategy } from '../lib/registry';
import { explorerAddressUrl, explorerTxUrl, toAse1, toHexAddress } from '../lib/rpc';
import { fmtDuration, fmtWei, shortHash, weiToAse } from '../lib/format';
import { CodeBlock } from '../components/CodeBlock';
import { MARKETPLACE_ADDRESS } from '../lib/marketplace';
import { StrategyPnlPanel } from '../components/StrategyPnlPanel';
import { buildCloneStrategyUrl, buildCronDecisionFeed, inspectContractSafety } from '../lib/strategyAudit';
import { botTypeFor, isPerpTemplate } from '../lib/templates';
import { closeBot } from '../lib/botLifecycle';
import { PERPS_APP_URL, perpsPriceToNumber } from '../lib/perps';
import { getUserStrategies, removeUserStrategy, saveUserStrategy, saveUserTx } from '../lib/userStrategies';

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
  const isPerp = isPerpTemplate(strategy.template) || strategy.venue === 'asepad-perps';
  const tokenAddress = (strategy.token ?? '').toLowerCase();
  if (!tokenAddress && !isPerp) return [];
  return strategy.fillEvents
    .slice()
    .sort((a, b) => b.block - a.block)
    .slice(0, 20)
    .map((event) => {
      if (isPerp) {
        const rawSide = String(event.args.side ?? 'LONG');
        const sizeRaw = BigInt(String(event.args.sizeWei ?? event.args.sizeDelta ?? '0').replace(/^-/, '') || '0');
        const priceWei = BigInt(String(event.args.price ?? '0') || '0');
        const marginWei = BigInt(String(event.args.marginWei ?? '0') || '0');
        const notionalWei = BigInt(String(event.args.notionalWei ?? '0') || '0');
        const aseVal = marginWei > 0n ? marginWei : notionalWei > 0n ? notionalWei : (sizeRaw * priceWei) / 10n ** 18n;
        const isSell = rawSide.toUpperCase() === 'SHORT' || rawSide.toLowerCase().includes('close-long') || rawSide.toLowerCase().includes('reduce-long');
        return {
          key: `${event.txHash}-${event.block}-${rawSide}`,
          block: event.block,
          side: isSell ? 'Sold' : 'Bought',
          amount: strategy.tokenDecimals !== null
            ? `${rawSide} · ${formatToken(sizeRaw, strategy.tokenDecimals, strategy.symbol ?? '')}`
            : `${rawSide} · ${sizeRaw.toString()}`,
          ase: fmtWei(aseVal, 4),
          txHash: event.txHash,
        } satisfies FillRow;
      }
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
  const navigate = useNavigate();
  const wallet = useWallet();
  const client = useAsentum();
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [marketTitle, setMarketTitle] = useState('');
  const [marketDescription, setMarketDescription] = useState('');
  const [marketTags, setMarketTags] = useState('');
  const [marketStatus, setMarketStatus] = useState('');
  const [detailTab, setDetailTab] = useState<'overview' | 'decisions' | 'technical'>('overview');
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

  const removeUnfinished = () => {
    if (!localMatch || !wallet.address) return;
    removeUserStrategy(localMatch.address, wallet.address);
    navigate('/portfolio');
  };

  const runOwnerAction = async (mode: 'close' | 'withdraw') => {
    const recipient = userAse1 || userHex;
    if (!walletIsOwner || !recipient) return;
    setActionBusy(true);
    setActionMessage('');
    setActionError('');
    try {
      const isPerp = Boolean(strategy && (isPerpTemplate(strategy.template) || strategy.venue === 'asepad-perps'));
      const result = await closeBot({
        client,
        contract: strategy?.ase1 || strategy?.address || address,
        balanceAddress: strategy?.address || address,
        recipient,
        token: strategy?.token ?? null,
        // Older signal contracts shipped without withdrawTokens. New source
        // has the method, so decide from the deployed source, not the template.
        supportsTokenWithdraw: !isPerp && (strategy?.template !== 'momentum-signal'
          || Boolean(strategy?.source?.includes('withdrawTokens'))),
        supportsPerpClose: isPerp,
        perpMarketId: strategy?.marketId ?? null,
        needsStop: mode === 'close',
        onProgress: setActionMessage,
        onStopped: () => {
          if (!wallet.address || !strategy) return;
          const record = getUserStrategies(wallet.address).find(
            (item) => item.address.toLowerCase() === strategy.address.toLowerCase(),
          );
          if (record) saveUserStrategy({ ...record, status: 'stopped' });
        },
        onStep: (method, hash) => {
          if (!wallet.address) return;
          saveUserTx(wallet.address, {
            hash,
            type: method === 'stop' ? 'cancel' : method === 'closePosition' ? 'perps' : 'withdraw',
            description: `${
              method === 'stop'
                ? 'Stop'
                : method === 'closePosition'
                  ? 'Close perp position & reclaim vault margin from'
                  : method === 'withdraw'
                    ? 'Withdraw ASE from'
                    : 'Reclaim tokens from'
            } ${strategy?.name ?? 'bot'}`,
            timestamp: Date.now(),
            status: 'confirmed',
            strategyAddress: strategy?.address ?? address,
          });
        },
      });
      const parts = [result.stopped ? 'Bot stopped' : 'Funds withdrawn'];
      if (result.aseWithdrawn > 0n) parts.push(`${fmtWei(result.aseWithdrawn, 3)} ASE returned`);
      if (result.tokenReclaimed > 0n && strategy?.tokenDecimals != null) {
        parts.push(`${formatToken(result.tokenReclaimed, strategy.tokenDecimals, strategy?.symbol ?? 'tokens')} returned`);
      }
      if (!result.stopped && result.aseWithdrawn === 0n && result.tokenReclaimed === 0n) {
        parts.push('nothing left to withdraw');
      }
      setActionMessage(parts.join(' · '));
      refresh();
      if (result.stopped) {
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
  const isPerp = isPerpTemplate(strategy.template) || strategy.venue === 'asepad-perps';
  // A confirmed stop is stored locally as well: if the status read lags or
  // the node rate-limits it, the page must not keep showing the bot as active.
  const knownStopped = strategy.stopped === true || localMatch?.status === 'stopped';
  // A deployed-but-uninitialised contract has no owner, so stop() reverts.
  const notArmed = localMatch?.status === 'deployed';
  const running = !knownStopped && strategy.cron !== null;
  const statusLabel = knownStopped
    ? 'Stopped'
    : running
      ? 'Active & Trading'
      : notArmed
        ? 'Not armed'
        : 'Schedule ended';
  const statusClass = knownStopped ? 'status-badge off' : running ? 'status-badge live' : 'status-badge pending';
  const fills = buildFills(strategy);
  const needsStop = !knownStopped;
  const canReclaimTokens = !isPerp && (strategy.template !== 'momentum-signal' || strategy.source.includes('withdrawTokens'));
  const hasPerpVaultState = Boolean(
    isPerp && strategy.perpPosition
    && (BigInt(strategy.perpPosition.collateralWei || '0') > 0n || BigInt(strategy.perpPosition.sizeWei || '0') !== 0n),
  );
  const hasBalance = BigInt(strategy.balanceAse || '0') > 0n
    || hasPerpVaultState
    || (strategy.token !== null
      && canReclaimTokens
      && BigInt(strategy.tokenBalance || '0') > 0n);
  const deployCopyUrl = buildCloneStrategyUrl(strategy);
  const safetyChecks = inspectContractSafety(strategy);
  const decisionFeed = buildCronDecisionFeed(strategy);

  return (
    <>
      <section className="wrap detail-head">
        <Link className="link-arrow" to="/portfolio" style={{ display: 'inline-block', marginBottom: 10 }}>
          ← My bots
        </Link>
        <div>
          <span className="label">
            {bot ? `${bot.title} bot` : `${strategy.template} contract`}
          </span>
        </div>
        <h1 className="detail-title">{strategy.name}</h1>
        <p className="section-note" style={{ maxWidth: 720, marginTop: 12 }}>
          {notArmed
            ? 'This contract was deployed but never armed: it has no owner on chain, holds no funds and will never run. Remove the entry and create a new bot.'
            : 'This is your bot\'s management page: live status, balances, trade history and contract details. Nothing here needs configuring — the bot runs on-chain on its schedule. To stop it and send everything back to your wallet, use Close bot & return funds.'}
        </p>
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
          notArmed ? (
            <div className="manage-bar">
              <Link className="btn btn-primary" to={deployCopyUrl}>
                Start a new bot
              </Link>
              {localMatch && (
                <button type="button" className="btn btn-ghost" onClick={removeUnfinished}>
                  Remove unfinished entry
                </button>
              )}
            </div>
          ) : (
            <div className="manage-bar">
              <button
                className="btn btn-primary"
                type="button"
                disabled={actionBusy || (!needsStop && !hasBalance)}
                onClick={() => void runOwnerAction(needsStop ? 'close' : 'withdraw')}
              >
                {actionBusy ? 'Closing…' : needsStop ? 'Close bot & return funds' : hasBalance ? 'Withdraw everything' : 'Nothing to withdraw'}
              </button>
              <Link className="btn btn-ghost" to={deployCopyUrl}>
                Clone settings
              </Link>
              {knownStopped && !hasBalance && localMatch && wallet.address && (
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    removeUserStrategy(localMatch.address, wallet.address ?? undefined);
                    navigate('/portfolio');
                  }}
                >
                  Remove from my bots
                </button>
              )}
            </div>
          )
        ) : (
          <div className="manage-bar">
            <Link className="btn btn-primary" to={deployCopyUrl}>Deploy a bot like this</Link>
          </div>
        )}

        {walletIsOwner && !notArmed && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            {knownStopped
              ? 'The schedule is cancelled. Everything left in the contract goes back to your wallet in one action.'
              : 'Closing cancels the schedule, refunds unused gas escrow, then sends the remaining ASE and unsold tokens to your wallet. Your wallet asks you to approve each prompt — no seed phrase or private key is needed.'}
          </p>
        )}
        {!notArmed && !knownStopped && !strategy.cron && (
          <div className="notice" style={{ borderLeftColor: 'var(--warn)', background: 'var(--warn-soft)', marginTop: 12, maxWidth: 720 }}>
            <strong style={{ color: 'var(--warn)' }}>Schedule ended</strong>
            <span>This bot&apos;s cron gas escrow ran out, so the chain will not call it again. Close it to return what is left, then create a new bot.</span>
          </div>
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
        <div className="kpi-strip">
          <div className="kpi-card">
            <span className="label">Trades</span>
            <strong className="mono">{strategy.trades}</strong>
            <small>Executed fills</small>
          </div>
          <div className="kpi-card">
            <span className="label">ASE in contract</span>
            <strong className="mono">{fmtWei(strategy.balanceAse, 3)}</strong>
            <small>Available contract balance</small>
          </div>
          {!isPerp && strategy.token && strategy.tokenDecimals !== null && (
            <div className="kpi-card">
              <span className="label">Tokens in contract</span>
              <strong className="mono">
                {formatToken(BigInt(strategy.tokenBalance || '0'), strategy.tokenDecimals, strategy.symbol ?? '')}
              </strong>
              <small>Held inventory</small>
            </div>
          )}
          <div className="kpi-card">
            <span className="label">Gross received</span>
            <strong className="mono" style={{ color: 'var(--up)' }}>{fmtWei(strategy.realisedWei, 3)}</strong>
            <small>Total ASE proceeds</small>
          </div>
          <div className="kpi-card">
            <span className="label">Schedule</span>
            <strong className="mono" style={{ fontSize: 18 }}>
              {notArmed
                ? 'Not scheduled'
                : strategy.cron?.runsLeft
                  ? `${strategy.cron.runsLeft} runs left`
                  : knownStopped
                    ? 'Stopped'
                    : 'Ended'}
            </strong>
            <small>Runs every {strategy.intervalSec ? fmtDuration(strategy.intervalSec) : '—'}</small>
          </div>
        </div>

        <div className="seg-tabs" style={{ marginBottom: 24 }} role="tablist" aria-label="Strategy detail sections">
          <button
            type="button"
            role="tab"
            aria-selected={detailTab === 'overview'}
            className={detailTab === 'overview' ? 'seg-tab active' : 'seg-tab'}
            onClick={() => setDetailTab('overview')}
          >
            Overview &amp; Trades
            <span className="seg-tab-count">{fills.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={detailTab === 'decisions'}
            className={detailTab === 'decisions' ? 'seg-tab active' : 'seg-tab'}
            onClick={() => setDetailTab('decisions')}
          >
            Decisions &amp; Audit
            <span className="seg-tab-count">{decisionFeed.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={detailTab === 'technical'}
            className={detailTab === 'technical' ? 'seg-tab active' : 'seg-tab'}
            onClick={() => setDetailTab('technical')}
          >
            Contract &amp; Code
          </button>
        </div>
      </section>

      {detailTab === 'overview' && (
      <>
      <section className="wrap" style={{ paddingBottom: 24 }}>
        {isPerp ? (
          <div className="panel pnl-panel">
            <div className="panel-head">
              <div>
                <span className="label">AsePad Perps Vault &amp; Position</span>
                <p className="muted" style={{ marginTop: 3 }}>
                  Isolated position held by this bot contract on{' '}
                  <a href={PERPS_APP_URL} target="_blank" rel="noreferrer" className="link-arrow">perps.asepad.fun ↗</a>
                </p>
              </div>
              <span className="perp-badge-live">
                Market #{strategy.marketId ?? '—'}{strategy.perpSide ? ` · ${strategy.perpSide}` : ''}{strategy.perpLeverage ? ` ${strategy.perpLeverage}x` : ''}
              </span>
            </div>
            <div className="panel-body">
              {!strategy.perpPosition ? (
                <p className="muted">Perp vault state is loading or unavailable.</p>
              ) : (
                <div className="pnl-metrics">
                  <div>
                    <span className="label">Open Size</span>
                    <strong className={BigInt(strategy.perpPosition.sizeWei) > 0n ? 'up' : BigInt(strategy.perpPosition.sizeWei) < 0n ? 'down' : ''}>
                      {strategy.perpPosition.sizeWei === '0'
                        ? 'Flat (0)'
                        : `${BigInt(strategy.perpPosition.sizeWei) > 0n ? 'LONG' : 'SHORT'} ${weiToAse(strategy.perpPosition.sizeWei.replace(/^-/, ''), 4)} ${strategy.symbol ?? ''}`}
                    </strong>
                  </div>
                  <div>
                    <span className="label">Vault Collateral</span>
                    <strong>{fmtWei(strategy.perpPosition.collateralWei, 4)}</strong>
                  </div>
                  <div>
                    <span className="label">Free Margin</span>
                    <strong>{fmtWei(strategy.perpPosition.freeCollateralWei, 4)}</strong>
                  </div>
                  <div>
                    <span className="label">Entry / Mark</span>
                    <strong className="mono">
                      {strategy.perpPosition.entryPriceWei !== '0'
                        ? `${perpsPriceToNumber(strategy.perpPosition.entryPriceWei, strategy.tokenDecimals ?? 18, 18).toPrecision(5)} / ${perpsPriceToNumber(strategy.perpPosition.markPriceWei, strategy.tokenDecimals ?? 18, 18).toPrecision(5)}`
                        : `Mark ${perpsPriceToNumber(strategy.perpPosition.markPriceWei, strategy.tokenDecimals ?? 18, 18).toPrecision(5)}`}
                    </strong>
                  </div>
                  <div>
                    <span className="label">Unrealised PnL</span>
                    <strong className={BigInt(strategy.perpPosition.unrealisedPnlWei) >= 0n ? 'up' : 'down'}>
                      {fmtWei(strategy.perpPosition.unrealisedPnlWei, 4)}
                    </strong>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          strategy.token && strategy.tokenDecimals !== null && <StrategyPnlPanel strategy={strategy} />
        )}
      </section>

      <section className="wrap" style={{ paddingBottom: 80 }}>
        <div className="panel">
          <div className="panel-head">
            <div>
              <span className="label">Trade history</span>
              <p className="muted" style={{ marginTop: 3 }}>Latest on-chain fills for this bot.</p>
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
      </>
      )}

      {detailTab === 'decisions' && (
      <section className="wrap" style={{ paddingBottom: 80 }}>
        <div className="panels">
          <div className="panel">
            <div className="panel-head">
              <div>
                <span className="label">Cron decision feed</span>
                <p className="muted" style={{ marginTop: 3 }}>
                  Why this contract executed, waited or halted across recent on-chain ticks.
                </p>
              </div>
              <span className="pill pill-live">{decisionFeed.length} events</span>
            </div>
            {decisionFeed.length === 0 ? (
              <div className="panel-body muted">No Cron signals or lifecycle events indexed yet.</div>
            ) : (
              <div className="decision-feed">
                {decisionFeed.map((item) => (
                  <div className="decision-row" key={item.key}>
                    <div className="decision-row-head">
                      <span className={`decision-dot tone-${item.tone}`} aria-hidden="true" />
                      <strong>{item.title}</strong>
                      <span className="dim mono">#{item.block.toLocaleString('en-US')}</span>
                    </div>
                    <div className="decision-row-meta">
                      <span className="muted">{item.detail}</span>
                      <a href={explorerTxUrl(item.txHash)} target="_blank" rel="noreferrer" className="link-arrow mono">
                        {shortHash(item.txHash)} ↗
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="label">Glass Box safety audit</span>
              <span className={strategy.verified ? 'pill pill-live' : 'pill pill-ended'}>
                {strategy.verified ? 'Checks passed' : 'Verify source'}
              </span>
            </div>
            <div className="panel-body">
              <div className="audit-list">
                {safetyChecks.map((item) => (
                  <div className="audit-item" key={item.label}>
                    <div className="audit-item-head">
                      <span className={`audit-badge status-${item.status}`}>
                        {item.status === 'ok' ? 'PASS' : item.status === 'warn' ? 'NOTE' : 'FAIL'}
                      </span>
                      <strong>{item.label}</strong>
                    </div>
                    <p className="muted">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
      )}

      {detailTab === 'technical' && (
      <section className="wrap" style={{ paddingBottom: 80 }}>
        <div className="panels">
          <div style={{ display: 'grid', gap: 16 }}>
            <details className="dev-accordion" open>
              <summary>Technical data · contract source, events and schedule</summary>
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
                <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
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
                      <span className="dim" style={{ display: 'block', fontSize: 13 }}>
                        {Object.entries(event.args)
                          .filter(([key]) => key !== 'poolId')
                          .map(([key, value]) => `${key}=${String(value).slice(0, 28)}`)
                          .join('  ')}
                      </span>
                      <a className="dim" style={{ display: 'block', fontSize: 13 }} href={explorerTxUrl(event.txHash)} target="_blank" rel="noreferrer">
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
                <Link className="btn btn-primary" to={deployCopyUrl} style={{ width: '100%', justifyContent: 'center' }}>
                  Create a bot from this one
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
      )}
    </>
  );
}
