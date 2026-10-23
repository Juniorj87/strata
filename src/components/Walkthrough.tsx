import { useCallback, useEffect, useState } from 'react';

/**
 * Browser-side simulation of the MomentumSignal tick from the contract above.
 * The spot price random-walks; drift is the deviation of spot from its start
 * price in bps - the same compare the contract runs against thresholdBps.
 */

const REF = 1.0; // starting spot price the TWAP reverts toward

interface Line {
  n: number;
  drift: number;
  signal: 'buy' | 'sell' | 'hold';
}

function step(prev: number): { spot: number; drift: number } {
  // ±150 bps of noise per tick
  const spot = Math.max(0.1, prev * (1 + (Math.random() * 2 - 1) * 0.015));
  return { spot, drift: Math.round(((spot - REF) / REF) * 10_000) };
}

export function Walkthrough() {
  const [threshold, setThreshold] = useState(120);
  const [spot, setSpot] = useState(REF);
  const [lines, setLines] = useState<Line[]>([]);
  const [auto, setAuto] = useState(false);

  const tick = useCallback(() => {
    setSpot((prev) => {
      const { spot: next, drift } = step(prev);
      const signal: Line['signal'] = drift > threshold ? 'sell' : drift < -threshold ? 'buy' : 'hold';
      setLines((ks) => [...ks, { n: ks.length + 1, drift, signal }].slice(-12));
      return next;
    });
  }, [threshold]);

  useEffect(() => {
    if (!auto) return;
    // tick pipelines both state updates through functions, so a stable bind is safe
    const id = window.setInterval(tick, 900);
    return () => window.clearInterval(id);
  }, [auto, tick]);

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="label">
          tick #{lines.length} · spot {spot.toFixed(4)} · threshold {threshold} bps
        </span>
        <span className="mono dim" style={{ fontSize: 12 }}>
          browser-simulated, not chain-connected
        </span>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
        {/* The contract's whole logic, reduced to what you can touch here */}
        <div className="row-2">
          <div className="field">
            <label htmlFor="wk-threshold">thresholdBps</label>
            <input
              id="wk-threshold"
              className="input"
              type="range"
              min={20}
              max={300}
              step={10}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </div>
          <div className="field" style={{ justifySelf: 'end', alignSelf: 'end', display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="button" onClick={tick}>
              Run a tick
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setAuto((a) => !a)}>
              {auto ? 'Pause' : 'Auto'}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                setAuto(false);
                setLines([]);
                setSpot(REF);
              }}
            >
              Reset
            </button>
          </div>
        </div>

        <pre className="code" style={{ minHeight: 220 }}>
          {lines.length === 0 && (
            <div>
              {'// press "Run a tick" - the chain calls this on schedule'}
              {'  '}
            </div>
          )}
          {lines.map((l) => (
            <div key={l.n}>
              <span className="dim">{'emit("Signal", '}</span>
              {'{ signal: '}
              <span className="s">'{l.signal}'</span>
              {', driftBps: '}
              <span className="n">{l.drift}</span>
              {', ticks: '}
              <span className="n">{l.n}</span>
              {' })'}
              <span className={`tag tag-${l.signal}`} style={{ marginLeft: 12 }}>
                {l.signal}
              </span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
