import { useMemo, useState } from 'react';
import { useAsync } from '../lib/hooks';
import { getCandles, getMarketPairs, timeframeById, type Candle } from '../lib/marketData';
import { loadPerpsMarketCandles, type PerpsMarket } from '../lib/perps';
import type { LivePool } from '../lib/registry';
import {
  simulatePerpsStrategy,
  simulateSpotStrategy,
  type PerpsSimParams,
  type SpotSimParams,
} from '../lib/strategySim';
import { CandleChart } from './CandleChart';

type StrategyPreviewProps =
  | {
      mode: 'spot';
      pool: LivePool | null;
      params: SpotSimParams;
    }
  | {
      mode: 'perps';
      market: PerpsMarket | null;
      params: PerpsSimParams;
    };

export function StrategyPreviewPanel(props: StrategyPreviewProps) {
  const [showReplayMarkers, setShowReplayMarkers] = useState(true);
  const tf = timeframeById('1h');

  const pairsState = useAsync(
    () => (props.mode === 'spot' ? getMarketPairs() : Promise.resolve([])),
    60_000,
    props.mode === 'spot',
  );

  const matchedPair = useMemo(() => {
    if (props.mode !== 'spot' || !props.pool) return null;
    const pairs = pairsState.data ?? [];
    const targetVenue = props.pool.venue === 'asedex' ? 'asedex' : 'auras';
    return (
      pairs.find((p) => p.chainPoolId === props.pool!.id && p.dex === targetVenue)
      ?? pairs.find((p) => p.chainPoolId === props.pool!.id)
      ?? null
    );
  }, [props, pairsState.data]);

  const spotCandlesState = useAsync<Candle[]>(
    () => (props.mode === 'spot' && matchedPair ? getCandles(matchedPair, tf) : Promise.resolve([])),
    30_000,
    props.mode === 'spot' && Boolean(matchedPair),
    matchedPair?.poolKey ?? 'none',
  );

  const perpsCandlesState = useAsync<Candle[]>(
    () => (props.mode === 'perps' && props.market ? loadPerpsMarketCandles(props.market, tf.seconds) : Promise.resolve([])),
    30_000,
    props.mode === 'perps' && Boolean(props.market),
    props.mode === 'perps' ? (props.market?.id ?? 'none') : 'spot',
  );

  const candles = props.mode === 'spot' ? (spotCandlesState.data ?? []) : (perpsCandlesState.data ?? []);
  const loading = props.mode === 'spot' ? (pairsState.loading || spotCandlesState.loading) : perpsCandlesState.loading;
  const error = props.mode === 'spot' ? spotCandlesState.error : perpsCandlesState.error;
  const symbol = props.mode === 'spot' ? (props.pool?.symbol ?? 'TOKEN') : (props.market?.symbol ?? 'MARKET');

  const sim = useMemo(() => {
    if (props.mode === 'spot') {
      return simulateSpotStrategy(candles, props.params);
    }
    return simulatePerpsStrategy(candles, props.params);
  }, [candles, props]);

  return (
    <div className="panel sim-panel">
      <div className="panel-head">
        <div>
          <span className="label">Visual levels &amp; 7D replay</span>
          <p className="muted" style={{ marginTop: 2, fontSize: 12.5 }}>
            Live rules plotted on real indexed {tf.label} candles
          </p>
        </div>
        <button
          type="button"
          className={showReplayMarkers ? 'chip active' : 'chip'}
          onClick={() => setShowReplayMarkers((v) => !v)}
          title="Toggle simulated replay fills on the chart"
        >
          {showReplayMarkers ? 'Replay pins: On' : 'Replay pins: Off'}
        </button>
      </div>

      <CandleChart
        candles={candles}
        intervalSec={tf.seconds}
        height={230}
        symbol={symbol}
        loading={loading}
        error={error}
        overlays={sim.overlays}
        markers={showReplayMarkers ? sim.markers : []}
        compact
      />

      <div className="sim-metrics">
        <div>
          <span>Sim fills</span>
          <strong className="mono">{sim.candleCount >= 2 ? sim.fillsCount : '—'}</strong>
        </div>
        <div>
          <span>Sim return</span>
          <strong className={`mono ${sim.estReturnPct === null ? '' : sim.estReturnPct >= 0 ? 'up' : 'down'}`}>
            {sim.estReturnPct === null ? '—' : `${sim.estReturnPct >= 0 ? '+' : ''}${sim.estReturnPct}%`}
          </strong>
        </div>
        <div>
          <span>Spot Hold</span>
          <strong className={`mono ${sim.holdReturnPct === null ? '' : sim.holdReturnPct >= 0 ? 'up' : 'down'}`}>
            {sim.holdReturnPct === null ? '—' : `${sim.holdReturnPct >= 0 ? '+' : ''}${sim.holdReturnPct}%`}
          </strong>
        </div>
        <div>
          <span>Max DD</span>
          <strong className="mono">{sim.candleCount >= 2 ? `-${sim.maxDrawdownPct}%` : '—'}</strong>
        </div>
      </div>

      <div className="sim-footnote">
        <span>{sim.summary}</span>
        {sim.estGasAse > 0 && <span className="mono">Est. gas ~{sim.estGasAse} ASE</span>}
      </div>
    </div>
  );
}
