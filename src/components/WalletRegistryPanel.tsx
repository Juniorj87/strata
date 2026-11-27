import { useState } from 'react';
import { useWallet } from '@asentum/connect';
import { explorerAddressUrl, toAse1, toHexAddress } from '../lib/rpc';
import {
  clearWalletRegistry,
  readWalletRegistry,
  registerWallet,
  removeRegisteredWallet,
  setWalletRegistryEnabled,
  type WalletRegistryState,
} from '../lib/walletRegistry';

/**
 * Opt-in wallet registry. Nothing is written until the user turns it on and
 * adds an address, and turning it off forgets every entry.
 */
export function WalletRegistryPanel() {
  const wallet = useWallet();
  const [state, setState] = useState<WalletRegistryState>(() => readWalletRegistry());
  const [message, setMessage] = useState('');

  const add = () => {
    if (!wallet.address) return;
    const hex = toHexAddress(wallet.address);
    setState(registerWallet(hex));
    setMessage('Public address saved in this browser.');
  };

  return (
    <div className="panel wallet-registry">
      <div className="panel-head">
        <div>
          <span className="label">Wallet registry · opt-in</span>
          <p className="muted">
            Strata has no server database. This list is optional, local to this browser, and stores public
            addresses only.
          </p>
        </div>
        <span className={state.enabled ? 'status-badge live' : 'status-badge off'}>
          {state.enabled ? 'On' : 'Off'}
        </span>
      </div>

      <div className="panel-body wallet-registry-body">
        <label className="wallet-registry-toggle">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(event) => {
              const next = setWalletRegistryEnabled(event.target.checked);
              setState(next);
              setMessage(event.target.checked
                ? 'Opted in. Add a wallet below when you want it remembered.'
                : 'Opted out. Every stored address was removed.');
            }}
          />
          <span>
            Remember wallet addresses in this browser
            <small>
              Purpose: recognise the wallets whose strategies this browser deployed. No keys, seeds, balances or
              history are stored. Turning this off deletes the list.
            </small>
          </span>
        </label>

        {state.enabled && (
          <>
            <div className="wallet-registry-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!wallet.connected || !wallet.address}
                onClick={add}
              >
                {wallet.connected ? 'Add connected wallet' : 'Connect a wallet first'}
              </button>
              {state.wallets.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setState(clearWalletRegistry()); setMessage('Registry cleared.'); }}
                >
                  Forget all
                </button>
              )}
            </div>

            {state.wallets.length === 0 ? (
              <p className="muted wallet-registry-empty">No address saved. Nothing is collected automatically.</p>
            ) : (
              <ul className="wallet-registry-list">
                {state.wallets.map((item) => (
                  <li key={item.address}>
                    <a
                      className="mono"
                      href={explorerAddressUrl(item.address)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {toAse1(item.address)}
                    </a>
                    <span className="muted mono">
                      {new Date(item.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => setState(removeRegisteredWallet(item.address))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {message && <p className="field-help">{message}</p>}
      </div>
    </div>
  );
}
