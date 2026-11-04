export function fmtAse(value: number, digits = 2): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M ASE`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K ASE`;
  return `${value.toFixed(digits)} ASE`;
}

export function fmtPct(value: number, digits = 2): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function fmtNum(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function shortAddr(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function fmtAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

const WEI = 10n ** 18n;

/** wei (decimal string) → ASE with a readable number of decimals. */
export function weiToAse(wei: string | bigint, digits = 4): string {
  const value = typeof wei === 'bigint' ? wei : BigInt(wei || '0');
  const whole = value / WEI;
  const frac = value % WEI;
  const fracStr = frac.toString().padStart(18, '0').slice(0, digits);
  return digits > 0 ? `${whole}.${fracStr}` : `${whole}`;
}

export function fmtWei(wei: string | bigint, digits = 4): string {
  const value = typeof wei === 'bigint' ? wei : BigInt(wei || '0');
  const ase = Number(weiToAse(value, digits));
  if (ase >= 1_000_000) return `${(ase / 1_000_000).toFixed(2)}M ASE`;
  if (ase >= 1000) return `${(ase / 1000).toFixed(2)}K ASE`;
  return `${weiToAse(value, digits)} ASE`;
}

/** Token units (decimal string) → raw integer units. Throws on malformed input. */
export function parseUnits(value: string, decimals: number): bigint {
  const clean = value.trim();
  if (!clean) throw new Error('Enter an amount.');
  if (!/^\d*(?:\.\d*)?$/.test(clean) || clean === '.') throw new Error('Enter a valid amount.');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unsupported token decimals.');
  const [whole = '0', fraction = ''] = clean.split('.');
  if (fraction.length > decimals) {
    throw new Error(`This token supports at most ${decimals} decimal places.`);
  }
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

/** Raw integer units → readable token amount, without rounding error on large values. */
export function formatUnits(raw: string | bigint, decimals: number, maxFraction = 6): string {
  const value = typeof raw === 'bigint' ? raw : BigInt(raw || '0');
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = decimals > 0
    ? (value % scale).toString().padStart(decimals, '0').slice(0, Math.max(0, maxFraction)).replace(/0+$/, '')
    : '';
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Short wall-clock label for indexed events (timestamps arrive in milliseconds). */
export function fmtTimestamp(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '—';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '—';
  const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${time} UTC`;
}

export function fmtAgeFrom(ms: number | null | undefined, now = Date.now()): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '—';
  const seconds = Math.max(0, Math.floor((now - ms) / 1000));
  return fmtAge(seconds);
}
