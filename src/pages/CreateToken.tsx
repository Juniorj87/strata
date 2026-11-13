import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsentum, useWallet } from '@asentum/connect';
import { explorerAddressUrl, explorerTxUrl, toAse1, toHexAddress } from '../lib/rpc';
import { formatUnits, parseUnits, shortHash } from '../lib/format';
import { TokenMark } from '../components/TokenMark';
import {
  clearTokenDraft,
  deployArc20,
  initArc20,
  loadTokenDraft,
  saveTokenDraft,
  tokenFactoryError,
  verifyArc20,
  type Arc20Params,
  type Arc20Verification,
  type TokenDraft,
} from '../lib/tokenFactory';

type StepState = 'idle' | 'active' | 'done' | 'error';

interface Step {
  key: string;
  label: string;
  detail: string;
  state: StepState;
}

const INITIAL_STEPS: Step[] = [
  { key: 'deploy', label: 'Deploy the contract', detail: 'Uploads the ARC-20 source; the wallet signs a deploy.', state: 'idle' },
  { key: 'init', label: 'Initialise supply', detail: 'Calls init once and mints the fixed supply to your wallet.', state: 'idle' },
  { key: 'verify', label: 'Verify on chain', detail: 'Reads name, symbol, decimals and supply back from state.', state: 'idle' },
];

function updateStep(steps: Step[], key: string, state: StepState): Step[] {
  return steps.map((step) => (step.key === key ? { ...step, state } : step));
}

export function CreateToken() {
  const wallet = useWallet();
  const client = useAsentum();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [decimals, setDecimals] = useState('18');
  const [supply, setSupply] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [address, setAddress] = useState('');
  const [deployTx, setDeployTx] = useState('');
  const [initTx, setInitTx] = useState('');
  const [verified, setVerified] = useState<Arc20Verification | null>(null);
  const [draft, setDraft] = useState<TokenDraft | null>(null);
  const [touched, setTouched] = useState(false);
  const submitted = useRef(false);

  useEffect(() => {
    const saved = loadTokenDraft();
    if (!saved) return;
    setDraft(saved);
    setName(saved.params.name);
    setSymbol(saved.params.symbol);
    setDecimals(String(saved.params.decimals));
    setSupply(formatUnits(saved.params.supplyRaw, saved.params.decimals, 18).replace(/,/g, ''));
    setAddress(saved.address);
    setDeployTx(saved.deployTxHash);
    setSteps((current) => updateStep(current, 'deploy', 'done'));
  }, []);

  const parsedSupply = useMemo(() => {
    try {
      const dec = Number(decimals);
      if (!Number.isInteger(dec) || dec < 0 || dec > 18) return null;
      return parseUnits(supply || '0', dec);
    } catch {
      return null;
    }
  }, [supply, decimals]);

  const formError = useMemo(() => {
    if (!name.trim()) return 'Enter a token name.';
    if (name.trim().length > 64) return 'Name must be 64 characters or fewer.';
    if (!/^[A-Za-z0-9]{1,16}$/.test(symbol.trim())) return 'Symbol must be 1–16 letters or digits.';
    if (!parsedSupply || parsedSupply <= 0n) return 'Enter a total supply greater than zero.';
    const dec = Number(decimals);
    if (!Number.isInteger(dec) || dec < 0 || dec > 18) return 'Decimals must be 0–18.';
    return '';
  }, [name, symbol, parsedSupply, decimals]);

  const params: Arc20Params | null = parsedSupply
    ? { name: name.trim(), symbol: symbol.trim().toUpperCase(), decimals: Number(decimals), supplyRaw: parsedSupply.toString() }
    : null;
  const locked = Boolean(draft) || Boolean(verified);

  const run = async () => {
    if (!wallet.connected || !wallet.address) { wallet.openConnect(); return; }
    if (!params || formError || busy || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError('');
    setVerified(null);
    setStage('Starting deployment…');

    let tokenAddress = address;
    let deployHash = deployTx;
    const ownerHex = toHexAddress(wallet.address);
    try {
      if (!tokenAddress) {
        setSteps((current) => updateStep(current, 'deploy', 'active'));
        const deployed = await deployArc20(client, params, setStage);
        tokenAddress = deployed.address;
        deployHash = deployed.txHash;
        setAddress(tokenAddress);
        setDeployTx(deployHash);
        setSteps((current) => updateStep(updateStep(current, 'deploy', 'done'), 'init', 'active'));
        const nextDraft: TokenDraft = {
          address: tokenAddress,
          deployTxHash: deployHash,
          params,
          owner: toHexAddress(wallet.address),
          createdAt: Date.now(),
          status: 'deployed',
        };
        saveTokenDraft(nextDraft);
        setDraft(nextDraft);
      } else {
        setSteps((current) => updateStep(current, 'init', 'active'));
      }

      let initHash = '';
      try {
        initHash = await initArc20(client, tokenAddress, params, setStage);
      } catch (initError) {
        // A retry after a lost receipt finds the contract already initialised.
        // Treat that as success only when chain state actually holds the supply.
        const existing = await verifyArc20(client, tokenAddress, ownerHex).catch(() => null);
        if (!existing || !/^\d+$/.test(existing.totalSupply) || BigInt(existing.totalSupply) <= 0n) {
          throw initError;
        }
      }
      setInitTx(initHash);
      setSteps((current) => updateStep(updateStep(current, 'init', 'done'), 'verify', 'active'));

      setStage('Reading the token back from chain state…');
      const check = await verifyArc20(client, tokenAddress, ownerHex);
      const matches = check.name === params.name
        && check.symbol === params.symbol
        && check.decimals === String(params.decimals)
        && check.totalSupply === params.supplyRaw;
      if (!matches) {
        throw new Error('The deployed contract state does not match the requested token. Inspect it before using it.');
      }
      setVerified(check);
      setSteps((current) => updateStep(current, 'verify', 'done'));
      clearTokenDraft();
      setDraft(null);
      setStage('');
    } catch (err) {
      setError(tokenFactoryError(err));
      setSteps((current) => current.map((step) =>
        step.state === 'active' ? { ...step, state: 'error' } : step));
      setStage('');
      // A deployed contract stays recoverable: initialise the same address
      // instead of deploying a second token.
      if (tokenAddress) {
        const pending: TokenDraft = {
          address: tokenAddress,
          deployTxHash: deployHash,
          params,
          owner: ownerHex,
          createdAt: Date.now(),
          status: 'deployed',
        };
        saveTokenDraft(pending);
        setDraft(pending);
      }
    } finally {
      submitted.current = false;
      setBusy(false);
    }
  };

  const reset = () => {
    if (busy) return;
    clearTokenDraft();
    setDraft(null);
    setName('');
    setSymbol('');
    setDecimals('18');
    setSupply('');
    setAddress('');
    setDeployTx('');
    setInitTx('');
    setVerified(null);
    setError('');
    setStage('');
    setSteps(INITIAL_STEPS);
    setTouched(false);
  };

  const tokenAse1 = address ? toAse1(address) : '';
  const supplyDisplay = parsedSupply && Number.isInteger(Number(decimals))
    ? formatUnits(parsedSupply, Number(decimals), 4)
    : '—';

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Create Token · Asentum testnet</span>
        <h1 className="detail-title">Deploy an ARC-20 token.</h1>
        <p className="section-note" style={{ maxWidth: 680, marginTop: 16 }}>
          Asentum has no protocol-level token factory: a token is a JavaScript contract. Strata deploys the
          published ARC-20 interface with a fixed supply, then verifies the metadata and supply by reading the
          contract back.
        </p>
      </section>

      <section className="wrap create-token-page">
        <div className="create-token-grid">
          <div className="panel create-token-form" onFocusCapture={() => setTouched(true)}>
            <div className="panel-head">
              <div>
                <span className="label">Token parameters</span>
                <p className="muted">Only fields the ARC-20 standard actually defines</p>
              </div>
            </div>

            {draft && (
              <div className="notice" role="status">
                <strong>Unfinished deployment found</strong>
                <span className="mono">{toAse1(draft.address)}</span>
                <span>
                  This contract was deployed but its supply is not initialised. Signing below initialises this
                  same address instead of deploying another token.
                </span>
              </div>
            )}

            <label className="field">
              <span>Token name</span>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Strata Test Token" maxLength={64} disabled={locked} />
            </label>
            <label className="field">
              <span>Symbol</span>
              <input className="input" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="STRT" maxLength={16} disabled={locked} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Total supply</span>
                <input className="input" value={supply} onChange={(event) => setSupply(event.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="1000000" disabled={locked} />
              </label>
              <label className="field">
                <span>Decimals</span>
                <input className="input" value={decimals} onChange={(event) => setDecimals(event.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="18" disabled={locked} />
              </label>
            </div>

            <dl className="create-token-alloc">
              <div><dt>Initial allocation</dt><dd>100% to the deploying wallet</dd></div>
              <div><dt>Mint after deploy</dt><dd>None — fixed supply</dd></div>
              <div><dt>Tax / blacklist / pause</dt><dd>Not present</dd></div>
              <div><dt>Description field</dt><dd>Not part of ARC-20</dd></div>
            </dl>

            <p className="field-help">
              The contract follows the ARC-20 storage layout and events, so Auras pools, AseDex and the explorer can
              read it without special handling. Decimals are limited to 0–18 here to match the pools Strata reads.
            </p>

            {formError && touched && !locked && <p className="swap-note down">{formError}</p>}
            {error && (
              <div className="notice deploy-error" role="alert">
                <strong>Token creation did not finish</strong>
                <span>{error}</span>
                {address && (
                  <a className="link-arrow mono" href={explorerAddressUrl(address)} target="_blank" rel="noreferrer">
                    Inspect the contract before retrying ↗
                  </a>
                )}
              </div>
            )}
            {stage && <p className="swap-note">{stage}</p>}

            {!verified && (
              <button
                type="button"
                className={wallet.connected && !formError && !busy ? 'btn btn-primary swap-action' : 'btn btn-ghost swap-action'}
                disabled={busy || (wallet.connected && Boolean(formError) && !draft)}
                onClick={run}
              >
                {busy ? stage || 'Working…'
                  : !wallet.connected ? 'Connect wallet'
                    : draft ? 'Initialise the pending token'
                      : 'Deploy token'}
              </button>
            )}

            {!wallet.connected && (
              <p className="field-help">The wallet only signs; Strata never receives a private key or seed phrase.</p>
            )}
          </div>

          <aside className="create-token-side">
            <div className="panel create-token-preview">
              <span className="label">Preview</span>
              <div className="create-token-card">
                <TokenMark symbol={(symbol || 'TKN').slice(0, 6)} />
                <div>
                  <strong>{name || 'Token name'}</strong>
                  <span className="mono">${symbol || 'TKN'}</span>
                </div>
              </div>
              <dl className="create-token-facts">
                <div><dt>Network</dt><dd>Asentum testnet · chain 1423</dd></div>
                <div><dt>Standard</dt><dd>ARC-20 (fixed supply)</dd></div>
                <div><dt>Total supply</dt><dd className="mono">{supplyDisplay} {symbol || ''}</dd></div>
                <div><dt>Decimals</dt><dd className="mono">{decimals || '—'}</dd></div>
                <div><dt>Contract</dt><dd className="mono">{address ? shortHash(address) : 'assigned after deploy'}</dd></div>
                <div><dt>Cost</dt><dd>Network gas in ASE, shown by your wallet</dd></div>
                <div><dt>Strata fee</dt><dd>None</dd></div>
              </dl>
              {address && (
                <a className="link-arrow mono" href={explorerAddressUrl(address)} target="_blank" rel="noreferrer">
                  {tokenAse1 || address} ↗
                </a>
              )}
            </div>

            <div className="panel create-token-steps">
              <span className="label">Creation steps</span>
              {steps.map((step) => (
                <div className={`create-step is-${step.state}`} key={step.key}>
                  <span className="create-step-dot" aria-hidden="true" />
                  <div>
                    <strong>{step.label}</strong>
                    <p>{step.detail}</p>
                    {step.key === 'deploy' && deployTx && (
                      <a className="mono link-arrow" href={explorerTxUrl(deployTx)} target="_blank" rel="noreferrer">
                        {shortHash(deployTx)} ↗
                      </a>
                    )}
                    {step.key === 'init' && initTx && (
                      <a className="mono link-arrow" href={explorerTxUrl(initTx)} target="_blank" rel="noreferrer">
                        {shortHash(initTx)} ↗
                      </a>
                    )}
                    {step.key === 'verify' && verified && (
                      <p className="mono create-verify">
                        {verified.name} · {verified.symbol} · {verified.decimals} decimals · supply {formatUnits(verified.totalSupply, Number(verified.decimals) || 0, 4)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {verified && (
                <div className="notice create-token-success" role="status">
                  <strong>Token verified on chain</strong>
                  <span className="mono">{verified.name} (${verified.symbol})</span>
                  <span>Supply held by the deployer: {formatUnits(verified.deployerBalance, Number(verified.decimals) || 0, 4)}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Create another</button>
                </div>
              )}
            </div>

            <div className="panel create-token-safety">
              <span className="label">Safety boundaries</span>
              <ul className="swap-checklist">
                <li>No private keys, seed phrases or secrets are collected or stored.</li>
                <li>Deployment and initialisation are two separate wallet signatures.</li>
                <li>A failed initialisation keeps the deployed address for retry; it never auto-deploys twice.</li>
                <li>Success is only reported after the explorer-visible transaction and a chain read agree.</li>
              </ul>
              <Link className="link-arrow" to="/advanced">Trade a token with an ASE pool →</Link>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}

export default CreateToken;
