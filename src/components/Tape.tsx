import { tape } from '../data/mock';

export function Tape() {
  return (
    <div className="tape">
      <div className="tape-head">
        <span className="label">Strategy tape</span>
        <span className="tape-live">live</span>
      </div>
      {tape.map((row) => (
        <div className="tape-row" key={row.txHash}>
          <span className="tape-block">#{row.block.toLocaleString('en-US')}</span>
          <span className="tape-name">
            {row.strategy} <span className={`tag tag-${row.action}`}>{row.action}</span>
          </span>
          <span className="tape-amt">
            {row.amount}
            <span className="dim"> · {row.price}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
