import { useWallet, useBalance } from '@asentum/connect';
import { explorerAddressUrl } from '../lib/rpc';
import { weiToAse } from '../lib/format';

/**
 * Wallet status panel. Connection goes through the Asentum connect kit, which
 * handles both the Chrome extension (window.asentum) and the Telegram bot
 * wallet. The browser never sees a key.
 */
export function WalletPanel({ compact = false }: { compact?: boolean }) {
  const wallet = useWallet();
  const { balance } = useBalance(wallet.ase1Address ?? undefined, 15000);

  if (wallet.connected && wallet.ase1Address) {
    return (
      <div className="wallet">
        <div className="wallet-row">
          <span className="label">Wallet</span>
          <span className="live-dot">connected</span>
        </div>
        <div className="wallet-addr mono">
          <a href={explorerAddressUrl(wallet.ase1Address)} target="_blank" rel="noreferrer">
            {compact ? `${wallet.ase1Address.slice(0, 10)}…${wallet.ase1Address.slice(-6)}` : wallet.ase1Address}
          </a>
        </div>
        {balance !== null && <div className="card-sub">{weiToAse(balance, 4)} ASE</div>}
        <button className="btn btn-ghost" type="button" onClick={() => wallet.disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="wallet">
      <div className="wallet-row">
        <span className="label">Wallet</span>
        {wallet.hasWallet && <span className="live-dot">detected</span>}
      </div>
      <p className="card-sub" style={{ margin: '6px 0 12px' }}>
        Chrome extension or Telegram wallet. The browser never holds a key; the wallet only signs.
      </p>
      <button
        className="btn btn-primary"
        type="button"
        onClick={() => wallet.openConnect()}
        disabled={wallet.connecting}
      >
        {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
      </button>
      {wallet.error && <p className="card-sub" style={{ color: 'var(--down)', marginTop: 10 }}>{wallet.error}</p>}
    </div>
  );
}
