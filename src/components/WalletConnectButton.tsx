import { useWallet } from '@asentum/connect';
import { explorerAddressUrl } from '../lib/rpc';

/** One clearly visible wallet control: connect prompt in the hero, address chip when live. */
export function WalletConnectButton() {
  const wallet = useWallet();

  if (wallet.connected && wallet.ase1Address) {
    return (
      <a className="btn btn-ghost" href={explorerAddressUrl(wallet.ase1Address)} target="_blank" rel="noreferrer">
        {`${wallet.ase1Address.slice(0, 12)}…${wallet.ase1Address.slice(-4)}`}
      </a>
    );
  }

  return (
    <button className="btn btn-ghost" type="button" onClick={() => wallet.openConnect()} disabled={wallet.connecting}>
      {wallet.connecting ? 'Connecting…' : 'Connect Asentum wallet'}
    </button>
  );
}
