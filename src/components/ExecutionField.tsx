import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LiveStrategy } from '../lib/registry';
import type { ProtocolSnapshot } from '../lib/protocol';
import { fmtAgeFrom, fmtNum, fmtWei, shortHash } from '../lib/format';
import { explorerTxUrl } from '../lib/rpc';
import { botTypeFor } from '../lib/templates';

/** Tooltip state for bot markers. */
interface TooltipState {
  strategy: LiveStrategy | null;
  x: number;
  y: number;
}

/**
 * Strata execution field.
 *
 * A live map of the protocol instead of a statistics card: the core is the
 * execution engine, the satellites are verified contracts, and the hairlines
 * between them carry a pulse only while a strategy is scheduled. Every number
 * comes from the shared protocol snapshot.
 */

const RING_RADIUS = 152;

/** Strategy status for display. */
function strategyStatus(strategy: LiveStrategy): { label: string; className: string } {
  if (strategy.stopped === true) return { label: 'PAUSED', className: 'status-paused' };
  if (strategy.cron !== null) return { label: 'ACTIVE', className: 'status-active' };
  return { label: 'IDLE', className: 'status-idle' };
}

function angleFor(index: number, count: number): number {
  return (-90 + (360 / Math.max(1, count)) * index) * (Math.PI / 180);
}

/** Cron timestamps arrive either in seconds or milliseconds. */
function nextRunMs(cron: LiveStrategy['cron']): number | null {
  const raw = Number(cron?.nextRunAt ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw > 1e12 ? raw : raw * 1000;
}

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}

/** Human wording for a cron timestamp, including an overdue schedule. */
function scheduleText(target: number, now: number): string {
  const diff = target - now;
  const seconds = Math.round(Math.abs(diff) / 1000);
  if (diff < -60_000) return `overdue by ${duration(seconds)}`;
  if (diff <= 0) return 'due now';
  return `in ${duration(seconds)}`;
}

function shortSchedule(target: number, now: number): string {
  const diff = target - now;
  if (diff < -60_000) return 'overdue';
  if (diff <= 0) return 'due';
  return duration(Math.round(diff / 1000));
}

export function ExecutionField({
  snapshot,
  head,
  pools,
  loading,
  error,
}: {
  snapshot: ProtocolSnapshot | null;
  head: number | null;
  pools: number | null;
  loading: boolean;
  error: string | null;
}) {
  const strategies = snapshot?.strategies ?? [];
  const verified = strategies.filter((strategy) => strategy.verified);
  const nodes = verified; // Show all verified strategies
  const stats = snapshot?.stats;
  const recent = (snapshot?.fills ?? []).slice(0, 10); // Show up to 10 recent executions
  const hasData = Boolean(snapshot);

  // Count strategies by status
  const totalBots = verified.length;
  const activeBots = verified.filter((s) => s.cron !== null && s.stopped !== true).length;
  const pausedBots = verified.filter((s) => s.stopped === true).length;
  // Status buckets are mutually exclusive: active/scheduled, paused, or idle.
  const scheduledBots = activeBots;
  const idleBots = Math.max(0, totalBots - activeBots - pausedBots);

  // Tooltip state
  const [tooltip, setTooltip] = useState<TooltipState>({ strategy: null, x: 0, y: 0 });

  // Keep the compact detail card within the viewport. Coordinates are captured
  // from the marker; CSS uses fixed positioning so the card is not clipped.
  const showTooltip = (strategy: LiveStrategy, rect: DOMRect) => {
    const cardWidth = Math.min(240, window.innerWidth - 24);
    const x = Math.max(cardWidth / 2 + 12, Math.min(window.innerWidth - cardWidth / 2 - 12, rect.left + rect.width / 2));
    const y = Math.max(12, Math.min(window.innerHeight - 190, rect.top - 8));
    setTooltip({ strategy, x, y });
  };

  // One clock for the whole dial: the sweep runs continuously, the needle
  // points at the contract that runs next, and the readout counts down.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  let nextIndex = -1;
  let nextAt: number | null = null;
  nodes.forEach((strategy, index) => {
    if (strategy.stopped === true || strategy.cron === null) return;
    const at = nextRunMs(strategy.cron);
    if (at === null) return;
    if (nextAt === null || at < nextAt) {
      nextAt = at;
      nextIndex = index;
    }
  });
  const needleAngle = nextIndex >= 0
    ? (-90 + (360 / Math.max(1, nodes.length)) * nextIndex)
    : null;
  const scheduled = nodes.filter((strategy) => strategy.cron !== null && strategy.stopped !== true).length;

  const statusLine = error
    ? 'Connection error · showing the last snapshot'
    : loading && !hasData
      ? 'Reading the hub registry and receipts…'
      : stats && stats.verifiedStrategies === 0
        ? 'No verified contract indexed yet'
        : 'Indexed from Asentum receipts';

  // Adaptive class for many nodes
  const isCrowded = nodes.length > 30;

  return (
    <div className={`exec-field ${isCrowded ? 'is-crowded' : ''}`}>
      <div className={error ? 'exec-stage is-stale' : 'exec-stage'}>
        <div className="exec-sweep" aria-hidden="true" />
        <div className="exec-stage-tags">
          <span className="mono">ASENTUM · 1423</span>
          <span className="mono">
            <i className={error ? 'exec-dot is-warn' : 'exec-dot'} aria-hidden="true" />
            {error ? 'stale' : loading ? 'syncing' : 'live'}
          </span>
        </div>

        <svg
          className="exec-rings"
          viewBox="0 0 400 400"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="200" cy="200" r={RING_RADIUS} className="exec-ring-outer" />
          <circle cx="200" cy="200" r="112" className="exec-ring-mid" />
          <circle cx="200" cy="200" r="64" className="exec-ring-inner" />
          <g className="exec-ticks-rotor" style={{ transformOrigin: '200px 200px' }}>
            {Array.from({ length: 36 }).map((_, index) => {
              const angle = (index * 10 * Math.PI) / 180;
              const inner = index % 3 === 0 ? RING_RADIUS - 10 : RING_RADIUS - 5;
              const outer = RING_RADIUS + 6;
              return (
                <line
                  key={index}
                  x1={200 + Math.cos(angle) * inner}
                  y1={200 + Math.sin(angle) * inner}
                  x2={200 + Math.cos(angle) * outer}
                  y2={200 + Math.sin(angle) * outer}
                  className={index % 9 === 0 ? 'exec-tick is-major' : 'exec-tick'}
                />
              );
            })}
          </g>
          {nodes.map((strategy, index) => {
            const angle = angleFor(index, nodes.length);
            const x = 200 + Math.cos(angle) * RING_RADIUS;
            const y = 200 + Math.sin(angle) * RING_RADIUS;
            const active = strategy.cron !== null && strategy.stopped !== true;
            return (
              <line
                key={strategy.address}
                x1="200"
                y1="200"
                x2={x}
                y2={y}
                className={active ? 'exec-link is-active' : 'exec-link'}
              />
            );
          })}
        </svg>

        <div
          className={needleAngle === null ? 'exec-needle is-scanning' : 'exec-needle'}
          style={needleAngle === null ? undefined : { transform: `rotate(${needleAngle}deg)` }}
          aria-hidden="true"
        />

        <div className={error ? 'exec-core is-stale' : 'exec-core'}>
          <div className="exec-core-inner">
            <span className="exec-core-label">TOTAL BOTS</span>
            <strong>{totalBots}</strong>
            <div className="exec-core-stats">
              <span className="exec-core-stat">
                <span className="exec-core-stat-label">ACTIVE</span>
                <span className="exec-core-stat-value">{activeBots}</span>
              </span>
              <span className="exec-core-stat">
                <span className="exec-core-stat-label">PAUSED</span>
                <span className="exec-core-stat-value">{pausedBots}</span>
              </span>
              <span className="exec-core-stat">
                <span className="exec-core-stat-label">SCHEDULED</span>
                <span className="exec-core-stat-value">{scheduledBots}</span>
              </span>
            </div>
            <span className="exec-core-next mono">
              {!hasData
                ? 'syncing'
                : nextAt !== null
                  ? `next ${shortSchedule(nextAt, now)}`
                  : 'idle'}
            </span>
          </div>
        </div>

        {nodes.map((strategy, index) => {
          const angle = angleFor(index, nodes.length);
          const left = 50 + Math.cos(angle) * 38;
          const top = 50 + Math.sin(angle) * 38;
          const active = strategy.cron !== null && strategy.stopped !== true;
          const status = strategyStatus(strategy);
          const botType = botTypeFor(strategy.template);
          return (
            <Link
              key={strategy.address}
              to={`/strategies/${strategy.address}`}
              className={active ? 'exec-node is-active' : 'exec-node'}
              style={{ left: `${left}%`, top: `${top}%` }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                showTooltip(strategy, rect);
              }}
              onMouseLeave={() => setTooltip({ strategy: null, x: 0, y: 0 })}
              onTouchStart={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                showTooltip(strategy, rect);
              }}
              onClick={(e) => {
                // First tap reveals details; a second tap follows the strategy link.
                if (tooltip.strategy?.address !== strategy.address) {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  showTooltip(strategy, rect);
                } else {
                  setTooltip({ strategy: null, x: 0, y: 0 });
                }
              }}
            >
              <span className="exec-node-dot" aria-hidden="true" />
              <span className="exec-node-name">
                {strategy.name.length > 22 ? `${strategy.name.slice(0, 22)}…` : strategy.name}
              </span>
              <span className="exec-node-meta mono">
                {botType?.mark ?? 'BOT'} · {strategy.symbol ? `${strategy.symbol}/ASE` : 'pair —'} · {fmtNum(strategy.trades)}
              </span>
              <span className={`exec-node-status ${status.className}`}>{status.label}</span>
            </Link>
          );
        })}

        {hasData && nodes.length === 0 && (
          <p className="exec-empty">The core is idle until a contract is verified and registered.</p>
        )}

        {hasData && nodes.length > 0 && (
          <Link className="exec-view-all" to="/strategies">
            View all {totalBots} bots →
          </Link>
        )}

        {tooltip.strategy && (
          <div
            className="exec-tooltip"
            style={{
              left: `${tooltip.x}px`,
              top: `${tooltip.y}px`,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="exec-tooltip-head">
              <strong>{tooltip.strategy.name}</strong>
              <span className={`exec-tooltip-status ${strategyStatus(tooltip.strategy).className}`}>
                {strategyStatus(tooltip.strategy).label}
              </span>
            </div>
            <div className="exec-tooltip-body">
              <div className="exec-tooltip-row">
                <span className="exec-tooltip-label">Type</span>
                <span className="mono">{botTypeFor(tooltip.strategy.template)?.title ?? tooltip.strategy.template}</span>
              </div>
              <div className="exec-tooltip-row">
                <span className="exec-tooltip-label">Pair</span>
                <span className="mono">{tooltip.strategy.symbol ? `${tooltip.strategy.symbol}/ASE` : '—'}</span>
              </div>
              <div className="exec-tooltip-row">
                <span className="exec-tooltip-label">Executions</span>
                <span className="mono">{fmtNum(tooltip.strategy.trades)}</span>
              </div>
              <div className="exec-tooltip-row">
                <span className="exec-tooltip-label">Last execution</span>
                <span className="mono">
                  {tooltip.strategy.fillEvents.length > 0
                    ? fmtAgeFrom(tooltip.strategy.fillEvents[tooltip.strategy.fillEvents.length - 1].timestamp ?? 0)
                    : '—'}
                </span>
              </div>
              {tooltip.strategy.cron && (() => {
                const nextRun = nextRunMs(tooltip.strategy.cron);
                return (
                  <div className="exec-tooltip-row">
                    <span className="exec-tooltip-label">Next run</span>
                    <span className="mono">
                      {nextRun ? scheduleText(nextRun, now) : '—'}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        <span className="exec-coord exec-coord-a mono" aria-hidden="true">{head ? `#${head.toLocaleString('en-US')}` : '#—'}</span>
        <span className="exec-coord exec-coord-b mono" aria-hidden="true">{pools !== null ? `${pools} pools` : '— pools'}</span>
      </div>

      <p className="exec-caption" role="status">
        {!hasData
          ? 'Reading the hub registry and contract receipts…'
          : nextAt !== null
            ? `Next run ${scheduleText(nextAt, now)} · ${scheduled} active ${scheduled === 1 ? 'contract' : 'contracts'}`
            : 'No schedule armed · every indexed contract is idle'}
      </p>

      <dl className="exec-readout" style={{ marginTop: 0 }}>
        <div>
          <dt>Total Bots</dt>
          <dd>{totalBots}<small>{hasData ? `${activeBots} active · ${pausedBots} paused · ${idleBots} idle` : statusLine}</small></dd>
        </div>
        <div>
          <dt>Total Executions</dt>
          <dd>{stats ? fmtNum(stats.executedFills) : '—'}<small>verified contract fills</small></dd>
        </div>
        <div>
          <dt>Gross ASE received</dt>
          <dd>{stats ? fmtWei(stats.grossAseWei, 2) : '—'}<small>token → ASE fills only</small></dd>
        </div>
        <div>
          <dt>Open inventory</dt>
          <dd>{stats ? fmtWei(stats.inventoryAseWei, 2) : '—'}<small>live AMM quote</small></dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd className="mono">{stats?.lastFillAt ? fmtAgeFrom(stats.lastFillAt) : '—'}<small>{stats ? `${fmtNum(stats.tokenSymbols.length)} token pairs` : '—'}</small></dd>
        </div>
      </dl>

      <div className="exec-ledger">
        <div className="exec-ledger-head">
          <span className="label">Latest executions</span>
          <Link className="link-arrow" to="/activity">Ledger →</Link>
        </div>
        {recent.length === 0 && (
          <p className="exec-ledger-empty">
            {error
              ? 'Chain reads are failing right now. This panel keeps the last loaded values rather than inventing rows.'
              : loading
                ? 'Indexing executions…'
                : 'No swap has been indexed for a verified contract yet. The first fill will appear here automatically.'}
          </p>
        )}
        {recent.map((fill) => (
          <a
            key={fill.key}
            className="exec-ledger-row"
            href={explorerTxUrl(fill.txHash)}
            target="_blank"
            rel="noreferrer"
          >
            <span className={fill.side === 'buy' ? 'exec-side is-buy' : 'exec-side is-sell'}>
              {fill.side === 'buy' ? 'BUY' : 'SELL'}
            </span>
            <span className="exec-ledger-name">
              {fill.strategyName.length > 24 ? `${fill.strategyName.slice(0, 24)}…` : fill.strategyName}
              <span className="mono">{fill.symbol ? `${fill.symbol}/ASE` : 'pair —'}</span>
            </span>
            <span className="mono exec-ledger-amt">{fmtWei(fill.aseAmount, 3)}</span>
            <span className="mono exec-ledger-hash dim">{shortHash(fill.txHash).slice(0, 10)}</span>
          </a>
        ))}
      </div>
      <p className="exec-footnote">{statusLine} · gross ASE is quote volume, not profit.</p>
    </div>
  );
}
