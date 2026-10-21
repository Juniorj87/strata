interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function Sparkline({ data, width = 120, height = 28, color = 'var(--accent)' }: SparklineProps) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const points = data
    .map((value, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function EquityChart({ data, height = 260 }: { data: number[]; height?: number }) {
  const width = 720;
  const pad = 34;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const innerH = height - pad * 2;
  const innerW = width - pad * 2;

  const x = (i: number) => pad + (i / (data.length - 1)) * innerW;
  const y = (v: number) => pad + innerH - ((v - min) / span) * innerH;

  const line = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${pad},${pad + innerH} ${line} ${pad + innerW},${pad + innerH}`;

  const gridValues = [min, min + span / 2, max];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Equity curve">
      <defs>
        <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.24" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {gridValues.map((v) => (
        <g key={v}>
          <line x1={pad} x2={pad + innerW} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" strokeWidth="1" />
          <text x={4} y={y(v) + 4} fill="var(--dim)" fontSize="10" fontFamily="var(--font-mono)">
            {v.toFixed(0)}
          </text>
        </g>
      ))}

      <polygon points={area} fill="url(#equityFill)" />
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round" />

      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="3.5" fill="var(--accent)" />
      <text x={pad} y={height - 8} fill="var(--dim)" fontSize="10" fontFamily="var(--font-mono)">
        deployed
      </text>
      <text x={pad + innerW} y={height - 8} fill="var(--dim)" fontSize="10" fontFamily="var(--font-mono)" textAnchor="end">
        now
      </text>
    </svg>
  );
}
