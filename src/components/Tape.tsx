import type { TapeRow } from '../lib/registry';
import { weiToAse } from '../lib/format';

const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export function Tape({ rows }: { rows: TapeRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="tape">
        <div className="tape-head">
          <span className="label">Auras tape</span>
          <span className="tape-live">live</span>
        </div>
        <div className="tape-row">
          <span className="tape-block">-</span>
          <span className="tape-name muted">no swaps in the last 600 blocks</span>
          <span />
        </div>
      </div>
    );
  }

  return (
    <div className="tape">
      <div className="tape-head">
        <span className="label">Auras tape · real swaps</span>
        <span className="tape-live">live</span>
      </div>
      {rows.map((row) => {
        const nativeIn = row.tokenIn.toLowerCase() === NATIVE;
        return (
          <div className="tape-row" key={`${row.txHash}-${row.block}`}>
            <span className="tape-block">#{row.block.toLocaleString('en-US')}</span>
            <span className="tape-name">
              {row.symbol}/ASE <span className={`tag ${nativeIn ? 'tag-sell' : 'tag-buy'}`}>{nativeIn ? 'buy' : 'sell'}</span>
            </span>
            <span className="tape-amt">
              {nativeIn ? weiToAse(row.amountIn, 3) : weiToAse(row.amountIn, 2)} {nativeIn ? 'ASE' : row.symbol}
              <span className="dim"> · {weiToAse(row.amountOut, nativeIn ? 2 : 4)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
