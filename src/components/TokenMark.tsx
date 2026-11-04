/** Small token monogram used by the swap picker and pair labels. */
export function TokenMark({
  symbol,
  isNative = false,
  size = 26,
}: {
  symbol: string;
  isNative?: boolean;
  size?: number;
}) {
  const mark = isNative ? 'Ξ' : symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
  return (
    <span
      className={isNative ? 'token-mark is-native' : 'token-mark'}
      style={{ width: size, height: size, fontSize: isNative ? size * 0.55 : size * 0.38 }}
      aria-hidden="true"
    >
      {mark}
    </span>
  );
}
