import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAsentum, useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { IS_TESTNET, NETWORK } from '../lib/network';
import { PERPS_APP_URL } from '../lib/perps';
import { loadPools, loadAseDexPools } from '../lib/registry';
import { BOT_TYPES, isPerpTemplate, templateById } from '../lib/templates';
import { shortAddr, weiToAse } from '../lib/format';
import { PerpsBotBuilder } from '../components/PerpsBotBuilder';
import { StrategyPreviewPanel } from '../components/StrategyPreviewPanel';
import { InfoTip } from '../components/InfoTip';
import {
  ASEDEX_AMM,
  AURAS_AMM,
  explorerAddressUrl,
  explorerTxUrl,
  getAccountMeta,
  getContractSource,
  hashSource,
  rpcCall,
  STRATA_HUB,
  toAse1,
} from '../lib/rpc';
import {
  fetchUserTokenHoldings,
  saveUserStrategy,
  saveUserTx,
  type UserTokenHolding,
} from '../lib/userStrategies';

import momentumSignalSource from '../../contracts/auras-momentum-signal.js?raw';
import momentumTraderSource from '../../contracts/auras-momentum-trader.js?raw';
import gridSource from '../../contracts/grid.js?raw';
import twapSource from '../../contracts/twap.js?raw';
import dcaSource from '../../contracts/dca.js?raw';
import riskManagedSource from '../../contracts/risk-managed.js?raw';
import scaleSource from '../../contracts/scale.js?raw';
import limitExitSource from '../../contracts/limit-exit.js?raw';

const CRON_GAS_LIMIT: Record<string, bigint> = {
  'momentum-signal': 400000n,
  'momentum-trader': 900000n,
  grid: 800000n,
  twap: 700000n,
  dca: 700000n,
  'risk-managed': 900000n,
  scale: 800000n,
  'limit-exit': 750000n,
};

const CONTRACT_SOURCES: Record<string, string> = {
  'momentum-signal': momentumSignalSource,
  'momentum-trader': momentumTraderSource,
  grid: gridSource,
  twap: twapSource,
  dca: dcaSource,
  'risk-managed': riskManagedSource,
  scale: scaleSource,
  'limit-exit': limitExitSource,
};

/** How long the wallet may sit on a prompt before the launch gives up. */
const WALLET_PROMPT_TIMEOUT_MS = 180_000;

/**
 * A wallet that never answers leaves the modal spinning forever. Race the
 * prompt against a deadline so the user gets a message they can act on.
 */
function withWalletTimeout<T>(action: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(
        `${label}: the wallet did not answer within ${WALLET_PROMPT_TIMEOUT_MS / 1000} seconds. Open the Asentum wallet (extension or Telegram), ` +
        'approve or reject the pending request, then try again. If the wallet confirms it later, check Portfolio before retrying.',
      ));
    }, WALLET_PROMPT_TIMEOUT_MS);
    action.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * A wallet can return a transaction hash it never broadcast, and the old flow
 * then waited two minutes for a receipt that could never arrive. Ask the node
 * whether the hash is known before waiting on it.
 */
async function assertBroadcast(txHash: string, label: string): Promise<void> {
  if (!txHash) throw new Error(`${label}: the wallet did not return a transaction hash.`);
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const tx = await rpcCall<unknown>('eth_getTransactionByHash', [txHash]).catch(() => undefined);
    if (tx) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `${label}: Asentum still has no record of transaction ${txHash.slice(0, 12)}…, so it was never broadcast or was dropped ` +
    'before inclusion. Open the Asentum wallet, dismiss the stale request, and retry.',
  );
}

function toUnits(value: string, decimals: number): bigint {
  const clean = value.trim();
  if (!/^\d+(?:\.\d*)?$/.test(clean)) throw new Error('Enter a valid positive amount.');
  const [whole, fraction = ''] = clean.split('.');
  if (fraction.length > decimals) throw new Error(`This token supports at most ${decimals} decimal places.`);
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (units <= 0n) throw new Error('Amount must be greater than zero.');
  return units;
}

function initArgsFor(
  templateId: string,
  poolId: string,
  token: string,
  sizeWei: string,
  threshold: string,
  interval: number,
  slices: number,
  levels: number,
  decimals: number,
  budgetWei: string,
  costBasisAseWei: string,
  dailyLossLimitAseWei: string,
  stopLossBps: string,
  takeProfitBps: string,
  maxDrawdownBps: string,
  targetUpsideBps: string,
  buySizeAseWei: string,
  buyBudgetAseWei: string,
  ammAddress: string,
): string[] {
  switch (templateId) {
    case 'momentum-signal': return [poolId, token, threshold, String(interval), ammAddress];
    case 'momentum-trader': return [poolId, token, threshold, sizeWei, String(interval), ammAddress];
    case 'grid': return [poolId, token, threshold, String(levels), sizeWei, budgetWei, buySizeAseWei, buyBudgetAseWei, String(decimals), ammAddress];
    case 'twap': return [poolId, token, sizeWei, String(slices), ammAddress];
    case 'dca': return [poolId, token, buySizeAseWei, buyBudgetAseWei, String(interval), ammAddress];
    case 'risk-managed': return [poolId, token, sizeWei, budgetWei, String(decimals), costBasisAseWei, dailyLossLimitAseWei, stopLossBps, takeProfitBps, maxDrawdownBps, String(interval), ammAddress];
    case 'scale': return [poolId, token, budgetWei, sizeWei, String(decimals), targetUpsideBps, String(levels), String(interval), ammAddress];
    case 'limit-exit': return [poolId, token, sizeWei, budgetWei, String(decimals), targetUpsideBps, String(interval), ammAddress];
    default: throw new Error('This template is not available in the one-click deploy flow.');
  }
}

const PERPS_ENABLED: boolean = false;

export function Deploy() {
  const [params, setSearchParams] = useSearchParams();
  const initialTokenHandledRef = useRef(false);
  const requestedTemplateParam = params.get('template');
  const initialPerpsMode =
    PERPS_ENABLED && (
      params.get('venue') === 'perps' ||
      isPerpTemplate(requestedTemplateParam) ||
      params.get('mode') === 'direct' ||
      Boolean(params.get('market')) ||
      Boolean(params.get('kind'))
    );
  const [builderVenue, setBuilderVenue] = useState<'spot' | 'perps'>(initialPerpsMode ? 'perps' : 'spot');
  // There is one builder now. Old links that still say ?mode=pro land on the
  // simple flow, and a pro-only template falls back to DCA instead of opening
  // a half-configured screen.
  const requestedTemplate = templateById(requestedTemplateParam || 'dca');
  const initialTemplate = BOT_TYPES.some((bot) => bot.templateId === requestedTemplate.id)
    ? requestedTemplate
    : templateById('dca');
  const [templateId, setTemplateId] = useState(initialTemplate.id);
  const [poolId, setPoolId] = useState(params.get('pool') ?? '1');
  const [threshold, setThreshold] = useState(params.get('threshold') ?? '120');
  const [size, setSize] = useState(params.get('size') ?? '250');
  const [budget, setBudget] = useState(params.get('budget') ?? '5000');
  const [buySizeAse, setBuySizeAse] = useState(params.get('buySizeAse') ?? '10');
  const [buyBudgetAse, setBuyBudgetAse] = useState(params.get('buyBudgetAse') ?? '100');
  const [interval, setInterval] = useState(Number(params.get('interval') ?? initialTemplate.intervalSec));
  const [escrow] = useState('0.05');
  const [slices, setSlices] = useState(params.get('slices') ?? '5');
  const [levels, setLevels] = useState(params.get('levels') ?? '5');
  const [costBasis, setCostBasis] = useState(params.get('costBasis') ?? '');
  const [dailyLossLimit, setDailyLossLimit] = useState(params.get('dailyLoss') ?? '5');
  const [stopLossBps, setStopLossBps] = useState(params.get('stopLoss') ?? '500');
  const [takeProfitBps, setTakeProfitBps] = useState(params.get('takeProfit') ?? '1000');
  const [maxDrawdownBps] = useState(params.get('maxDrawdown') ?? '800');
  const [targetUpsideBps, setTargetUpsideBps] = useState(params.get('targetUpside') ?? '1000');
  const [sourceType, setSourceType] = useState<'strata' | 'asepad'>(params.get('venue') === 'asepad' ? 'asepad' : 'strata');
  const [sideTab, setSideTab] = useState<'summary' | 'chart'>('summary');
  const [deploying, setDeploying] = useState(false);
  // A synchronous guard: React state updates arrive too late to stop the second
  // click of a double-click, which used to start two launches at once. Their
  // wallet timers then overwrote each other's progress.
  const launchInFlightRef = useRef(false);
  const [stage, setStage] = useState('');
  const [resultAddress, setResultAddress] = useState('');
  const [resultWarning, setResultWarning] = useState('');
  const [error, setError] = useState('');
  const [registrationOk, setRegistrationOk] = useState(false);
  // Publishing to the public leaderboard is an extra wallet approval with no
  // effect on the bot itself, so the simple flow leaves it off by default.
  const [publishToHub, setPublishToHub] = useState(params.get('hub') === '1');
  const fromMarketplace = params.get('fromMarketplace') === '1';
  const fromClone = params.get('cloned') === '1';
  const marketplaceBudgetHint = params.get('budgetHint') === 'suggested';
  const pools = useAsync(() => loadPools(), 20000);
  const asedexPools = useAsync(() => loadAseDexPools(), 20000);
  const wallet = useWallet();
  const client = useAsentum();

  // User holdings state
  const [userHoldings, setUserHoldings] = useState<UserTokenHolding[]>([]);

  // Token selector modal state
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenQuery, setTokenQuery] = useState('');

  // Stepper modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [stepStatus, setStepStatus] = useState<'idle' | 'waiting_signature' | 'confirming' | 'done' | 'error'>('idle');
  const [stepError, setStepError] = useState<string>('');
  const [txHashes, setTxHashes] = useState<{
    deploy?: string;
    init?: string;
    fund?: string;
    register?: string;
  }>({});

  const template = templateById(templateId);
  const supportsCustomInterval = ['momentum-signal', 'momentum-trader', 'risk-managed', 'scale', 'limit-exit', 'dca'].includes(template.id);
  const livePools = useMemo(
    () => (sourceType === 'strata' ? (pools.data ?? []) : (asedexPools.data ?? [])),
    [sourceType, pools.data, asedexPools.data],
  );
  const selectedPool = useMemo(
    () => livePools.find((pool) => pool.id === poolId) ?? livePools[0] ?? null,
    [livePools, poolId],
  );

  useEffect(() => {
    const allPools = [...(pools.data ?? []), ...(asedexPools.data ?? [])];
    if (!wallet.connected || !wallet.address || allPools.length === 0) return;
    fetchUserTokenHoldings(wallet.address, allPools, wallet.ase1Address)
      .then((items) => setUserHoldings(items))
      .catch((err) => console.warn('Failed to load user holdings:', err));
  }, [wallet.connected, wallet.address, wallet.ase1Address, pools.data, asedexPools.data]);

  const currentTokenHolding = useMemo(() => {
    if (!selectedPool) return null;
    return userHoldings.find((h) => h.token.toLowerCase() === selectedPool.token.toLowerCase()) ?? null;
  }, [userHoldings, selectedPool]);

  const nativeHolding = useMemo(() => {
    return userHoldings.find((h) => h.isNative) ?? null;
  }, [userHoldings]);

  const tokensWithBalance = useMemo(() => {
    return userHoldings.filter((h) => !h.isNative && h.balanceNum > 0);
  }, [userHoldings]);

  const handleSelectPool = (targetPool: { id: string; venue?: string }) => {
    initialTokenHandledRef.current = true;
    if (targetPool.venue === 'asedex') {
      setSourceType('asepad');
    } else if (targetPool.venue === 'auras') {
      setSourceType('strata');
    }
    setPoolId(targetPool.id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('token');
      next.set('pool', targetPool.id);
      if (targetPool.venue === 'asedex') next.set('venue', 'asepad');
      else next.delete('venue');
      return next;
    }, { replace: true });
    setTokenModalOpen(false);
  };

  const selectTokenPool = (holding: UserTokenHolding) => {
    handleSelectPool({ id: holding.poolId, venue: holding.venue });
    const dec = holding.decimals ?? 18;
    const raw = BigInt(holding.balanceRaw);
    const half = raw / 2n;
    const scale = 10n ** BigInt(dec);
    const whole = half / scale;
    const frac = (half % scale).toString().padStart(dec, '0').slice(0, 4).replace(/0+$/, '');
    const str = `${whole}${frac ? `.${frac}` : ''}`;
    setBudget(str);
    setSize(Math.max(1, Math.floor(Number(str) / 5)).toString());
  };

  const switchVenue = (newVenue: 'strata' | 'asepad') => {
    if (newVenue === sourceType) return;
    initialTokenHandledRef.current = true;
    setSourceType(newVenue);
    const targetPools = newVenue === 'strata' ? (pools.data ?? []) : (asedexPools.data ?? []);
    if (targetPools.length > 0) {
      setPoolId(targetPools[0].id);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('token');
        next.set('pool', targetPools[0].id);
        if (newVenue === 'asepad') next.set('venue', 'asepad');
        else next.delete('venue');
        return next;
      }, { replace: true });
    } else {
      setPoolId('');
    }
  };

  useEffect(() => {
    const tokenParam = params.get('token');
    const poolParam = params.get('pool');

    // Only apply URL params once on initial load
    if (!initialTokenHandledRef.current && livePools.length > 0) {
      if (tokenParam) {
        const match = livePools.find(
          (p) => p.token.toLowerCase() === tokenParam.toLowerCase() || p.symbol.toLowerCase() === tokenParam.toLowerCase(),
        );
        if (match) {
          initialTokenHandledRef.current = true;
          setPoolId(match.id);
          return;
        }
      } else if (poolParam) {
        const match = livePools.find((p) => p.id === poolParam);
        if (match) {
          initialTokenHandledRef.current = true;
          setPoolId(match.id);
          return;
        }
      }
      initialTokenHandledRef.current = true;
    }

    // Safety fallback: if current poolId is not present in the currently selected venue's pools
    if (livePools.length > 0 && !livePools.some((p) => p.id === poolId)) {
      setPoolId(livePools[0].id);
    }
  }, [livePools, poolId, params]);

  const decimals = selectedPool?.decimals ?? 18;
  const sizeWei = useMemo(() => {
    if (decimals === undefined) return '';
    try { return toUnits(size, decimals).toString(); } catch { return ''; }
  }, [size, decimals]);
  const buySizeAseWei = useMemo(() => { try { return toUnits(buySizeAse, 18).toString(); } catch { return ''; } }, [buySizeAse]);
  const buyBudgetAseWei = useMemo(() => { try { return toUnits(buyBudgetAse, 18).toString(); } catch { return ''; } }, [buyBudgetAse]);
  const budgetWei = useMemo(() => {
    if (decimals === undefined) return '';
    try { return toUnits(budget, decimals).toString(); } catch { return ''; }
  }, [budget, decimals]);

  const [isWalletLocked, setIsWalletLocked] = useState(false);

  useEffect(() => {
    let active = true;
    const checkLock = async () => {
      if (typeof window !== 'undefined' && (window as any).asentum?.isUnlocked && wallet.connected) {
        try {
          const unlocked = await (window as any).asentum.isUnlocked();
          if (active) setIsWalletLocked(!unlocked);
        } catch {
          if (active) setIsWalletLocked(false);
        }
      } else {
        if (active) setIsWalletLocked(false);
      }
    };
    void checkLock();
    window.addEventListener('focus', checkLock);
    const interval = window.setInterval(() => {
      void checkLock();
    }, 2000);
    return () => {
      active = false;
      window.removeEventListener('focus', checkLock);
      window.clearInterval(interval);
    };
  }, [wallet.connected]);

  async function runDeployLite() {
    setError('');
    setResultWarning('');
    setResultAddress('');
    setRegistrationOk(false);
    setStepError('');

    if (!wallet.connected || !wallet.address) {
      wallet.openConnect();
      return;
    }

    // Direct extension unlock check: if using browser extension, verify it is unlocked with password
    if (typeof window !== 'undefined' && (window as any).asentum?.isUnlocked) {
      try {
        const unlocked = await (window as any).asentum.isUnlocked();
        if (!unlocked) {
          setIsWalletLocked(true);
          setError('🔒 Asentum Wallet is locked in your browser. Click the Asentum icon in your browser toolbar (top right), enter your password to unlock it, and click Launch again.');
          return;
        }
      } catch {
        // non-blocking
      }
    }

    // Pre-flight session check: ensure the wallet session is active and not locked/expired
    if (typeof (client as any)?.checkSession === 'function') {
      try {
        const isLive = await (client as any).checkSession();
        if (!isLive) {
          setError('Your wallet session has expired or is locked. Please reconnect your wallet.');
          wallet.openConnect();
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/session|expired|locked|not connected|permission/i.test(msg)) {
          setError('Your wallet session has expired or is locked. Please reconnect your wallet.');
          wallet.openConnect();
          return;
        }
      }
    }
    if (!selectedPool) {
      setError('Live Auras/AseDex pools are not available right now. Refresh the page and try again.');
      return;
    }
    if (decimals === undefined) {
      setError('The token decimals could not be read from chain. Deployment is blocked to avoid sending the wrong token amount.');
      return;
    }
    if (!/^[1-9]\d*$/.test(threshold) || Number(threshold) > (template.id === 'grid' ? 5000 : 10000)) {
      setError('Threshold must be an integer from 1 to 10,000 bps.');
      return;
    }
    if (supportsCustomInterval && (!Number.isInteger(interval) || interval < 60 || interval > 86400)) {
      setError('Interval must be between 60 and 86,400 seconds.');
      return;
    }

    if (template.id === 'grid' && (!Number.isInteger(Number(levels)) || Number(levels) < 1 || Number(levels) > 20)) {
      setError('Grid levels must be an integer from 1 to 20.');
      return;
    }
    if (template.id === 'twap' && (!Number.isInteger(Number(slices)) || Number(slices) < 1 || Number(slices) > 100)) {
      setError('TWAP slices must be an integer from 1 to 100.');
      return;
    }

    let tokenSize = '0';
    let tokenBudget = 0n;
    let gasEscrow = 0n;
    let args: string[];
    try {
      tokenSize = template.trades && template.id !== 'dca' ? toUnits(size, decimals).toString() : '0';
      tokenBudget = template.trades && template.id !== 'dca' ? toUnits(budget, decimals) : 0n;
      if (template.id === 'dca' && BigInt(buyBudgetAseWei || '0') < BigInt(buySizeAseWei || '0')) throw new Error('DCA total ASE budget must cover at least one buy.');
      if (template.id === 'grid' && BigInt(threshold) * BigInt(levels) >= 10000n) throw new Error('Grid step multiplied by levels must stay below 10000 bps.');
      if (template.id === 'grid' && BigInt(buyBudgetAseWei || '0') < BigInt(buySizeAseWei || '0') * BigInt(levels)) throw new Error('Grid ASE buy reserve must cover every configured buy level.');
      if (template.id === 'grid' && tokenBudget < BigInt(tokenSize) * BigInt(levels)) throw new Error('Grid token budget must cover every configured sell level.');
      if (template.trades && tokenBudget < BigInt(tokenSize)) {
        throw new Error('The token budget must be at least one execution size.');
      }
      gasEscrow = toUnits(escrow, 18);
      const minimumCronEscrow = CRON_GAS_LIMIT[template.id] ?? 0n;
      if (gasEscrow < minimumCronEscrow) {
        throw new Error(`Cron escrow must be at least ${minimumCronEscrow.toString()} wei ASE for one scheduled run.`);
      }
      if (template.id === 'scale' && (!Number.isInteger(Number(levels)) || Number(levels) < 1 || Number(levels) > 20)) throw new Error('Scale levels must be an integer from 1 to 20.');
      if (template.id === 'scale' && BigInt(tokenSize) * BigInt(levels) > tokenBudget) throw new Error('The token budget must cover every scale level.');
      if ((template.id === 'scale' || template.id === 'limit-exit') && (!/^[0-9]+$/.test(targetUpsideBps) || Number(targetUpsideBps) < 1 || Number(targetUpsideBps) > 50000)) throw new Error('Target price move must be between 1 and 50,000 bps.');
      if (template.id === 'risk-managed') {
        if (!costBasis.trim()) throw new Error('Enter the average acquisition cost in ASE per whole token.');
        if (!/^[0-9]+$/.test(stopLossBps) || Number(stopLossBps) < 0 || Number(stopLossBps) >= 10000) throw new Error('Stop-loss must be 0–9,999 bps.');
        if (!/^[0-9]+$/.test(takeProfitBps) || Number(takeProfitBps) < 0 || Number(takeProfitBps) > 50000) throw new Error('Take-profit must be 0–50,000 bps.');
        if (!/^[0-9]+$/.test(maxDrawdownBps) || Number(maxDrawdownBps) < 0 || Number(maxDrawdownBps) >= 10000) throw new Error('Max drawdown must be 0–9,999 bps.');
        if (Number(stopLossBps) === 0 && Number(takeProfitBps) === 0 && Number(maxDrawdownBps) === 0 && (dailyLossLimit.trim() === '' || Number(dailyLossLimit) === 0)) throw new Error('Enable at least one risk guard: stop-loss, take-profit, drawdown or daily loss limit.');
      }
      const costBasisWei = template.id === 'risk-managed' ? toUnits(costBasis, 18).toString() : '0';
      const dailyLossWei = template.id === 'risk-managed' ? (dailyLossLimit.trim() === '0' || dailyLossLimit.trim() === '' ? '0' : toUnits(dailyLossLimit, 18).toString()) : '0';
      const ammAddress = sourceType === 'asepad' ? ASEDEX_AMM : AURAS_AMM;
      args = initArgsFor(template.id, selectedPool.id, selectedPool.token, tokenSize, threshold, interval, Number(slices), Number(levels), decimals, tokenBudget.toString(), costBasisWei, dailyLossWei, stopLossBps, takeProfitBps, maxDrawdownBps, targetUpsideBps, buySizeAseWei, buyBudgetAseWei, ammAddress);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    // Check token balance beforehand
    if (template.trades && template.id !== 'dca') {
      try {
        const rawBalance = await client.view<string>(selectedPool.token, 'balanceOf', [wallet.address]);
        const avail = BigInt(String(rawBalance).replace(/"/g, '') || '0');
        if (avail < tokenBudget) {
          const availFmt = currentTokenHolding?.balanceFmt ?? '0';
          setError(`Your wallet does not have enough ${selectedPool.symbol}. Requested: ${budget} ${selectedPool.symbol}. Available in wallet: ${availFmt} ${selectedPool.symbol}.`);
          return;
        }
      } catch {
        // non-blocking view failure fallback
      }
    }

    setDeploying(true);
    setModalOpen(true);
    setCurrentStep(1);
    setStepStatus('waiting_signature');
    setTxHashes({});

    let address = '';

    try {
      const rawSource = CONTRACT_SOURCES[template.id];
      if (!rawSource) throw new Error('Template source is missing from this build.');
      const source = rawSource.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // STEP 1: Deploy contract
      setStage('Wallet approval 1 — create the bot contract');
      const deployed = await withWalletTimeout(client.deploy(source), 'Create the bot contract');
      setTxHashes((prev) => ({ ...prev, deploy: deployed.txHash }));
      setStepStatus('confirming');
      saveUserTx(wallet.address, {
        hash: deployed.txHash,
        type: 'deploy',
        description: `Deploy ${template.name} contract`,
        timestamp: Date.now(),
        status: 'pending',
      });

      await assertBroadcast(deployed.txHash, 'Create the bot contract');
      const deployReceipt = await client.waitReceipt(deployed.txHash, 120000);
      if (!deployReceipt.success) throw new Error('Contract deployment transaction reverted. Check the transaction in the explorer.');
      address = deployed.contractAddress || (deployReceipt as any)?.recipient || (deployReceipt as any)?.contractAddress || '';
      if (!address) throw new Error('The wallet did not return a deployed contract address.');
      setResultAddress(address);

      saveUserTx(wallet.address, {
        hash: deployed.txHash,
        type: 'deploy',
        description: `Deploy ${template.name} contract (${toAse1(address).slice(0, 10)}…)`,
        timestamp: Date.now(),
        status: 'confirmed',
        strategyAddress: address,
      });

      saveUserStrategy({
        address,
        template: template.id,
        templateName: template.name,
        poolId: selectedPool.id,
        tokenSymbol: selectedPool.symbol,
        tokenAddress: selectedPool.token,
        venue: sourceType === 'asepad' ? 'asedex' : 'auras',
        deployTxHash: deployed.txHash,
        status: 'deployed',
        budget: template.id === 'dca' ? buyBudgetAse : budget,
        size: template.id === 'dca' ? buySizeAse : size,
        buyBudgetAse,
        buySizeAse,
        slices,
        levels,
        threshold,
        interval,
        createdAt: Date.now(),
        owner: wallet.address,
      });

      // Verify deployed source hash quietly; it needs no wallet approval.
      setStage('Checking the published code…');
      let deployedSource = '';
      let deployedMeta: any = {};
      const normExpected = source.trim();
      const expectedHash = await hashSource(source);
      const expectedTrimmedHash = await hashSource(normExpected);
      const expectedTrimmedNlHash = await hashSource(`${normExpected}\n`);

      // Poll up to 4 attempts (1.5s delay) to let RPC/indexer catch up with the mined block
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          [deployedSource, deployedMeta] = await Promise.all([
            getContractSource(address),
            getAccountMeta(address),
          ]);
          if (deployedSource || (deployedMeta?.codeHash && deployedMeta.codeHash !== '0x0000000000000000000000000000000000000000000000000000000000000000')) {
            break;
          }
        } catch {
          // ignore transient indexer or RPC error
        }
        await new Promise((r) => setTimeout(r, 1500));
      }

      const normReadBack = deployedSource ? deployedSource.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : '';
      const readBackHash = normReadBack ? await hashSource(normReadBack) : '';
      const readBackTrimmedHash = normReadBack ? await hashSource(normReadBack.trim()) : '';
      const storedHash = String(deployedMeta?.codeHash ?? '').replace(/^0x/, '').toLowerCase();

      const validHashes = [expectedHash, expectedTrimmedHash, expectedTrimmedNlHash];
      const isVerified =
        (storedHash && validHashes.includes(storedHash)) ||
        (readBackHash && validHashes.includes(readBackHash)) ||
        (readBackTrimmedHash && validHashes.includes(readBackTrimmedHash));

      if (isVerified) {
        // Source matches; nothing for the user to do here.
      } else {
        console.warn('Source verification notice: hash indexing or format difference', {
          expectedHash,
          storedHash,
          readBackHash,
        });
        setResultWarning('Contract deployed. Source hash is being indexed by the network.');
      }

      // STEP 2: Initializing strategy and funding cron schedule
      setCurrentStep(2);
      setStepStatus('waiting_signature');
      setStage('Wallet approval 2 — turn the bot on');
      const nativeStrategyBudget = template.id === 'dca' || template.id === 'grid' ? BigInt(buyBudgetAseWei || '0') : 0n;
      const initHash = await withWalletTimeout(
        client.call(address, 'init', args, gasEscrow + nativeStrategyBudget),
        'Start the schedule',
      );
      setTxHashes((prev) => ({ ...prev, init: initHash }));
      setStepStatus('confirming');
      saveUserTx(wallet.address, {
        hash: initHash,
        type: 'init',
        description: `Initialize ${template.name} schedule & cron escrow`,
        timestamp: Date.now(),
        status: 'pending',
        strategyAddress: address,
      });

      await assertBroadcast(initHash, 'Start the schedule');
      const initReceipt = await client.waitReceipt(initHash, 120000);
      if (!initReceipt.success) throw new Error('The contract was deployed, but init() reverted. The strategy is not armed.');
      saveUserTx(wallet.address, {
        hash: initHash,
        type: 'init',
        description: `Initialize ${template.name} schedule & cron escrow`,
        timestamp: Date.now(),
        status: 'confirmed',
        strategyAddress: address,
      });

      saveUserStrategy({
        address,
        template: template.id,
        templateName: template.name,
        poolId: selectedPool.id,
        tokenSymbol: selectedPool.symbol,
        tokenAddress: selectedPool.token,
        venue: sourceType === 'asepad' ? 'asedex' : 'auras',
        deployTxHash: deployed.txHash,
        initTxHash: initHash,
        status: 'initialized',
        budget: template.id === 'dca' ? buyBudgetAse : budget,
        size: template.id === 'dca' ? buySizeAse : size,
        buyBudgetAse,
        buySizeAse,
        slices,
        levels,
        threshold,
        interval,
        createdAt: Date.now(),
        owner: wallet.address,
      });

      // STEP 4: Fund strategy token allocation
      if (template.trades && template.id !== 'dca') {
        setCurrentStep(3);
        setStepStatus('waiting_signature');
        setStage(`Wallet approval 3 — deposit ${budget} ${selectedPool.symbol}`);
        const transferHash = await withWalletTimeout(
          client.call(selectedPool.token, 'transfer', [address, tokenBudget.toString()]),
          'Deposit the tokens',
        );
        setTxHashes((prev) => ({ ...prev, fund: transferHash }));
        setStepStatus('confirming');
        saveUserTx(wallet.address, {
          hash: transferHash,
          type: 'fund',
          description: `Deposit ${budget} ${selectedPool.symbol} into strategy contract`,
          timestamp: Date.now(),
          status: 'pending',
          strategyAddress: address,
        });

        await assertBroadcast(transferHash, 'Deposit the tokens');
        const transferReceipt = await client.waitReceipt(transferHash, 120000);
        if (!transferReceipt.success) throw new Error(`Strategy is initialized, but token funding failed. Contract: ${address}.`);
        saveUserTx(wallet.address, {
          hash: transferHash,
          type: 'fund',
          description: `Deposit ${budget} ${selectedPool.symbol} into strategy contract`,
          timestamp: Date.now(),
          status: 'confirmed',
          strategyAddress: address,
        });

        saveUserStrategy({
          address,
          template: template.id,
          templateName: template.name,
          poolId: selectedPool.id,
          tokenSymbol: selectedPool.symbol,
          tokenAddress: selectedPool.token,
          venue: sourceType === 'asepad' ? 'asedex' : 'auras',
          deployTxHash: deployed.txHash,
          initTxHash: initHash,
          transferTxHash: transferHash,
          status: 'funded',
          budget: template.id === 'dca' ? buyBudgetAse : budget,
          size: template.id === 'dca' ? buySizeAse : size,
          buyBudgetAse,
          buySizeAse,
          slices,
          levels,
          threshold,
          interval,
          createdAt: Date.now(),
          owner: wallet.address,
        });
      }

      // STEP 3/4: Optional leaderboard publication.
      let registrationHash = '';
      if (publishToHub) {
        setCurrentStep(needsFund ? 4 : 3);
        setStepStatus('waiting_signature');
        setStage(`Wallet approval ${needsFund ? 4 : 3} — publish to the leaderboard`);
        try {
        registrationHash = await withWalletTimeout(
          client.call(STRATA_HUB, 'registerStrategy', [address, template.id, selectedPool.id]),
          'Publish to the Strata Hub',
        );
        setTxHashes((prev) => ({ ...prev, register: registrationHash }));
        setStepStatus('confirming');
        saveUserTx(wallet.address, {
          hash: registrationHash,
          type: 'register',
          description: `Register strategy in Strata Hub`,
          timestamp: Date.now(),
          status: 'pending',
          strategyAddress: address,
        });

        await assertBroadcast(registrationHash, 'Publish to the Strata Hub');
        const registrationReceipt = await client.waitReceipt(registrationHash, 120000);
        setRegistrationOk(Boolean(registrationReceipt.success));
        saveUserTx(wallet.address, {
          hash: registrationHash,
          type: 'register',
          description: `Register strategy in Strata Hub`,
          timestamp: Date.now(),
          status: registrationReceipt.success ? 'confirmed' : 'failed',
          strategyAddress: address,
        });

        if (!registrationReceipt.success) setResultWarning('Strategy is live and funded, but Strata Hub registration reverted.');
        } catch (registrationError) {
          setResultWarning(`The bot is live and funded, but leaderboard publishing failed: ${registrationError instanceof Error ? registrationError.message : String(registrationError)}`);
        }
      }

      saveUserStrategy({
        address,
        template: template.id,
        templateName: template.name,
        poolId: selectedPool.id,
        tokenSymbol: selectedPool.symbol,
        tokenAddress: selectedPool.token,
        venue: sourceType === 'asepad' ? 'asedex' : 'auras',
        deployTxHash: deployed.txHash,
        initTxHash: initHash,
        hubTxHash: registrationHash,
        status: 'active',
        budget: template.id === 'dca' ? buyBudgetAse : budget,
        size: template.id === 'dca' ? buySizeAse : size,
        buyBudgetAse,
        buySizeAse,
        slices,
        levels,
        threshold,
        interval,
        createdAt: Date.now(),
        owner: wallet.address,
      });

      setCurrentStep(totalSteps + 1);
      setStepStatus('done');
      setStage('Bot is live');
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      if (/session|expired|locked/i.test(msg)) {
        setIsWalletLocked(true);
        msg = 'Your Asentum Wallet extension is locked. Click the Asentum icon in your browser toolbar (top right), enter your password, and click "I unlocked it — Retry" below.';
      }
      setError(msg);
      setStepError(msg);
      setStepStatus('error');
      setStage('Deployment stopped');
    } finally {
      setDeploying(false);
    }
  }

  const deployLite = async () => {
    if (launchInFlightRef.current) return;
    launchInFlightRef.current = true;
    try {
      await runDeployLite();
    } finally {
      launchInFlightRef.current = false;
    }
  };

  const sym = selectedPool?.symbol ?? 'TOKEN';
  const spotAse = selectedPool ? Number(weiToAse(selectedPool.spot, 8)) : 0;
  const activeBot = BOT_TYPES.find((bot) => bot.templateId === template.id) ?? BOT_TYPES[0];
  const levelCount = Math.max(1, Number(levels) || 1);
  const sliceCount = Math.max(1, Number(slices) || 1);
  const numBudget = Number(budget) || 0;
  const numSize = Number(size) || 0;
  const numBuyBudget = Number(buyBudgetAse) || 0;
  const numBuySize = Number(buySizeAse) || 0;
  const buyOrders = numBuySize > 0 ? Math.max(0, Math.floor(numBuyBudget / numBuySize + 1e-9)) : 0;
  const stopLossPct = (Number(stopLossBps) || 0) / 100;
  const takeProfitPct = (Number(takeProfitBps) || 0) / 100;
  const targetUpsidePct = (Number(targetUpsideBps) || 0) / 100;
  const targetPrice = spotAse * (1 + targetUpsidePct / 100);
  const estAseOut = numSize * targetPrice;
  const amt = (value: number, digits = 2) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
  const tokenBalance = currentTokenHolding?.balanceFmt ?? '0';
  const aseBalance = nativeHolding?.balanceFmt ?? '0';

  const botDecimals = Math.min(8, decimals);
  const divAmount = (value: string, parts: number): string => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0 || parts <= 0) return value;
    const fixed = (num / parts).toFixed(botDecimals).replace(/0+$/, '').replace(/\.$/, '');
    return fixed === '' || Number(fixed) <= 0 ? value : fixed;
  };

  const setBudgetDerived = (value: string) => {
    setBudget(value);
    if (template.id === 'grid') setSize(divAmount(value, levelCount));
    else if (template.id === 'twap') setSize(divAmount(value, sliceCount));
    else if (template.id === 'limit-exit') setSize(value);
    else if (numSize > (Number(value) || 0)) setSize(value);
  };

  const applyTokenPct = (pct: number) => {
    if (!currentTokenHolding || currentTokenHolding.balanceNum <= 0) return;
    const totalRaw = BigInt(currentTokenHolding.balanceRaw);
    const partRaw = (totalRaw * BigInt(Math.round(pct * 100))) / 100n;
    const scale = 10n ** BigInt(decimals);
    const whole = partRaw / scale;
    const frac = (partRaw % scale).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '');
    setBudgetDerived(`${whole}${frac ? `.${frac}` : ''}`);
  };

  const applyAsePct = (pct: number) => {
    if (!nativeHolding || nativeHolding.balanceNum <= 0) return;
    const safeMax = Math.max(0, nativeHolding.balanceNum - 0.2);
    const amount = (safeMax * pct).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    if (!amount) return;
    setBuyBudgetAse(amount);
    if (template.id === 'grid') setBuySizeAse(divAmount(amount, levelCount));
    else if (numBuySize > (Number(amount) || 0)) setBuySizeAse(divAmount(amount, 4));
  };

  // Friendly defaults: the shipped starting amounts can exceed a small testnet
  // balance, which used to dead-end the launch on a balance check. Size them to
  // what the wallet actually holds once, then leave every field editable.
  const autoSizedRef = useRef('');
  useEffect(() => {
    if (!wallet.connected || !selectedPool) return;
    const key = `${selectedPool.id}:${template.id}`;
    if (autoSizedRef.current === key) return;

    const trim = (value: number, digits: number) =>
      value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '') || '0';

    if (template.id === 'risk-managed' && !costBasis.trim()) {
      setCostBasis(weiToAse(selectedPool.spot, 6));
    }
    if (fromClone || fromMarketplace) {
      autoSizedRef.current = key;
      return;
    }
    if (
      template.trades && template.id !== 'dca' &&
      currentTokenHolding && currentTokenHolding.balanceNum > 0 &&
      Number(budget) > currentTokenHolding.balanceNum
    ) {
      const nextBudget = trim(currentTokenHolding.balanceNum * 0.5, botDecimals);
      setBudget(nextBudget);
      const parts = template.id === 'twap' ? sliceCount : template.id === 'grid' ? levelCount : 1;
      setSize(divAmount(nextBudget, parts));
    }
    if (
      (template.id === 'dca' || template.id === 'grid') &&
      nativeHolding && nativeHolding.balanceNum > 0.2 &&
      Number(buyBudgetAse) > nativeHolding.balanceNum - 0.2
    ) {
      const nextBudget = trim(Math.max(0, nativeHolding.balanceNum - 0.2) * 0.5, 4);
      setBuyBudgetAse(nextBudget);
      setBuySizeAse(divAmount(nextBudget, template.id === 'grid' ? levelCount : 1));
    }
    autoSizedRef.current = key;
  }, [wallet.connected, selectedPool, template.id, currentTokenHolding, nativeHolding, budget, buyBudgetAse, costBasis, botDecimals, sliceCount, levelCount]);

  const selectBotType = (id: string) => {
    const next = templateById(id);
    setTemplateId(id);
    setInterval(next.intervalSec);
    setError('');
    setResultWarning('');
    if (id === 'grid') {
      setThreshold('200');
      setSize(divAmount(budget, levelCount));
      setBuySizeAse(divAmount(buyBudgetAse, levelCount));
    } else if (id === 'twap') {
      setSlices('5');
      setSize(divAmount(budget, 5));
    } else if (id === 'limit-exit') {
      setSize(budget);
    }
  };

  const changeLevels = (next: string) => {
    setLevels(next);
    const parts = Math.max(1, Number(next) || 1);
    if (template.id === 'grid') {
      setSize(divAmount(budget, parts));
      setBuySizeAse(divAmount(buyBudgetAse, parts));
    } else if (template.id === 'scale') {
      setSize(divAmount(budget, parts));
    }
  };

  const changeSlices = (next: number) => {
    setSlices(String(next));
    setSize(divAmount(budget, Math.max(1, next)));
  };

  const changeBuyBudget = (value: string) => {
    setBuyBudgetAse(value);
    if (template.id === 'grid') setBuySizeAse(divAmount(value, levelCount));
  };

  const previewFacts: { label: string; value: string }[] = [];
  let previewLead = 'Choose a bot type to see the plan in plain language.';
  if (template.id === 'dca') {
    previewLead = `Buys ${sym} for ${buySizeAse} ASE every ${intervalLabel(interval)} until the budget is spent.`;
    previewFacts.push(
      { label: 'Purchases', value: `${buyOrders} runs` },
      { label: 'Total spend', value: `${buyBudgetAse} ASE` },
      { label: 'Working time', value: buyOrders > 0 ? intervalLabel(buyOrders * interval) : '—' },
      { label: 'Price now', value: `${weiToAse(selectedPool?.spot ?? '0', 6)} ASE / ${sym}` },
    );
  } else if (template.id === 'limit-exit') {
    previewLead = `Sells ${size || '0'} ${sym} once the price reaches ${amt(targetPrice, 6)} ASE (+${targetUpsidePct}%).`;
    previewFacts.push(
      { label: 'Amount to sell', value: `${size || '0'} ${sym}` },
      { label: 'Target price', value: `+${targetUpsidePct}% · ${amt(targetPrice, 6)} ASE` },
      { label: 'You receive about', value: `${amt(estAseOut, 4)} ASE` },
      { label: 'Price now', value: `${weiToAse(selectedPool?.spot ?? '0', 6)} ASE` },
    );
  } else if (template.id === 'grid') {
    previewLead = `Buys ${sym} below and sells it above ${amt(spotAse, 6)} ASE across ${levelCount} levels.`;
    previewFacts.push(
      { label: 'Grid step', value: `${(Number(threshold) / 100).toFixed(2)}%` },
      { label: 'Sell inventory', value: `${budget || '0'} ${sym}` },
      { label: 'Buy reserve', value: `${buyBudgetAse || '0'} ASE` },
      { label: 'Per level', value: `${size || '0'} ${sym} / ${buySizeAse || '0'} ASE` },
    );
  } else if (template.id === 'risk-managed') {
    previewLead = `Sells up to ${size || '0'} ${sym} per run if the price drops ${stopLossPct}% or rises ${takeProfitPct}%.`;
    previewFacts.push(
      { label: 'Total allocation', value: `${budget || '0'} ${sym}` },
      { label: 'Stop-loss', value: stopLossPct > 0 ? `-${stopLossPct}%` : 'off' },
      { label: 'Take-profit', value: takeProfitPct > 0 ? `+${takeProfitPct}%` : 'off' },
      { label: 'Daily loss cap', value: `${dailyLossLimit || '0'} ASE` },
      { label: 'Average buy price', value: costBasis ? `${costBasis} ASE` : 'not set' },
      { label: 'Checks every', value: intervalLabel(interval) },
    );
  } else if (template.id === 'twap') {
    previewLead = `Sells ${budget || '0'} ${sym} in ${sliceCount} equal orders of ${size || '0'} ${sym}.`;
    previewFacts.push(
      { label: 'Orders', value: `${sliceCount}` },
      { label: 'Per order', value: `${size || '0'} ${sym}` },
      { label: 'Total at current price', value: `${amt(numBudget * spotAse, 2)} ASE` },
      { label: 'Working time', value: intervalLabel(sliceCount * interval) },
    );
  } else {
    previewLead = `${template.name}: ${template.liteDesc}`;
  }

  const needsFund = template.trades && template.id !== 'dca';
  const totalSteps = 2 + (needsFund ? 1 : 0) + (publishToHub ? 1 : 0);

  const launchDisabled =
    deploying ||
    !selectedPool ||
    (template.trades && template.id !== 'dca' && (!sizeWei || !budgetWei)) ||
    ((template.id === 'dca' || template.id === 'grid') && (!buySizeAseWei || !buyBudgetAseWei));

  const intervalChips = [
    { label: '5 min', value: 300 },
    { label: '15 min', value: 900 },
    { label: '1 hour', value: 3600 },
    { label: '4 hours', value: 14400 },
    { label: '1 day', value: 86400 },
  ];
  const riskIntervalChips = [
    { label: '5 min', value: 300 },
    { label: '15 min', value: 900 },
    { label: '1 hour', value: 3600 },
  ];

  const allKnownPools = useMemo(() => [
    ...(pools.data ?? []).map((p) => ({ ...p, venue: 'auras' as const })),
    ...(asedexPools.data ?? []).map((p) => ({ ...p, venue: 'asedex' as const })),
  ], [pools.data, asedexPools.data]);

  const filteredModalPools = useMemo(() => {
    const clean = tokenQuery.trim().toLowerCase();
    const list = allKnownPools.filter((pool) => (
      !clean ||
      pool.symbol.toLowerCase().includes(clean) ||
      pool.token.toLowerCase().includes(clean) ||
      pool.venue.toLowerCase().includes(clean) ||
      pool.id === clean
    ));
    return list.sort((a, b) => {
      const aHold = userHoldings.some((h) => h.token.toLowerCase() === a.token.toLowerCase() && h.balanceNum > 0);
      const bHold = userHoldings.some((h) => h.token.toLowerCase() === b.token.toLowerCase() && h.balanceNum > 0);
      if (aHold && !bHold) return -1;
      if (!aHold && bHold) return 1;
      return 0;
    });
  }, [allKnownPools, tokenQuery, userHoldings]);

  return (
    <>
      <section className="wrap detail-head" style={{ paddingTop: 28, paddingBottom: 16 }}>
        <span className="label">Create a bot · {NETWORK.shortLabel}</span>
        <h1 className="detail-title">Launch a trading bot.</h1>
        <p className="section-note" style={{ maxWidth: 720, marginTop: 10 }}>
          Choose Spot AMMs (Auras / AseDex) or leveraged Perpetuals on{' '}
          <span style={{ whiteSpace: 'nowrap' }}>
            <a href={PERPS_APP_URL} target="_blank" rel="noreferrer" className="link-arrow">perps.asepad.fun ↗</a>.
            <InfoTip
              label="Self-custody and withdrawals"
              text="Every bot deploys as an isolated contract you own—no server custody. You only confirm wallet prompts and can stop or withdraw at any time."
            />
          </span>
        </p>

        <div className="deploy-venue-switch" role="tablist" aria-label="Trading venue category" style={{ marginTop: 18, marginBottom: 0 }}>
          <button
            type="button"
            role="tab"
            aria-selected={builderVenue === 'spot'}
            className={builderVenue === 'spot' ? 'deploy-venue-card active' : 'deploy-venue-card'}
            onClick={() => {
              setBuilderVenue('spot');
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (next.get('venue') === 'perps') next.delete('venue');
                next.delete('mode');
                next.delete('market');
                next.delete('kind');
                if (isPerpTemplate(next.get('template'))) next.set('template', 'dca');
                return next;
              }, { replace: true });
            }}
          >
            <div className="deploy-venue-top">
              <strong>Spot AMM Bots</strong>
              <span className="badge">Auras · AseDex</span>
            </div>
            <small>DCA, Take-Profit, Grid, Stop-Loss &amp; TWAP · no leverage</small>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={builderVenue === 'perps'}
            aria-disabled={!PERPS_ENABLED}
            disabled={!PERPS_ENABLED}
            className={`${builderVenue === 'perps' ? 'deploy-venue-card active' : 'deploy-venue-card'}${!PERPS_ENABLED ? ' is-disabled' : ''}`}
            onClick={() => {
              if (!PERPS_ENABLED) return;
              setBuilderVenue('perps');
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set('venue', 'perps');
                return next;
              }, { replace: true });
            }}
          >
            <div className="deploy-venue-top">
              <strong>AsePad Perps Bots</strong>
              <span className={PERPS_ENABLED ? 'perp-badge-live' : 'badge-soon'}>
                {PERPS_ENABLED ? 'LIVE · perps.asepad.fun' : 'Coming soon'}
              </span>
            </div>
            <small>Long / Short Cron contracts or native TWAP, Scale &amp; Trailing orders</small>
          </button>
        </div>

        {fromMarketplace && (
          <div className="notice marketplace-copy-notice" style={{ marginTop: 18, maxWidth: 760 }}>
            <strong>Community settings loaded</strong>
            <span>These values were shared by another wallet. Review the pool, size, token budget and every risk rule before deploying. {marketplaceBudgetHint ? 'The original contract did not store its full funding budget, so the suggested amount is only a starting point.' : 'The strategy configuration is a starting point, not a performance guarantee.'}</span>
          </div>
        )}
        {fromClone && !fromMarketplace && (
          <div className="notice marketplace-copy-notice" style={{ marginTop: 18, maxWidth: 760 }}>
            <strong>Cloned from an on-chain bot</strong>
            <span>Parameters were loaded from the deployed contract&apos;s live configuration. Review the pool, allocation sizes and risk guards before launching.</span>
          </div>
        )}
      </section>

      <section className="wrap" style={{ paddingBottom: 90 }}>
        {builderVenue === 'perps' ? (
          <PerpsBotBuilder />
        ) : (
        <div className="terminal-grid">
          {(
            <div className="terminal-card">
              <div className="builder-type-grid" role="tablist" aria-label="Bot type">
                {BOT_TYPES.map((bot) => (
                  <button
                    key={bot.templateId}
                    type="button"
                    role="tab"
                    aria-selected={template.id === bot.templateId}
                    className={template.id === bot.templateId ? 'builder-type-card active' : 'builder-type-card'}
                    onClick={() => selectBotType(bot.templateId)}
                  >
                    <div className="builder-type-card-top">
                      <strong>{bot.title}</strong>
                      <span className="builder-type-tag">{bot.mark}</span>
                    </div>
                    <small>{bot.short}</small>
                  </button>
                ))}
              </div>

              <div className="terminal-body">
                <div className="builder-step">
                  <div className="builder-step-head">
                    <span className="builder-step-title">
                      <span className="builder-step-num">1</span>
                      Market &amp; Allocation
                    </span>
                    <span className="field-help">{activeBot.blurb}</span>
                  </div>

                  <div className="token-row">
                    <div className="venue-pill-group" role="group" aria-label="Trading venue">
                      <button type="button" className={sourceType === 'strata' ? 'venue-pill active' : 'venue-pill'} onClick={() => switchVenue('strata')}>Auras</button>
                      <button type="button" className={sourceType === 'asepad' ? 'venue-pill active' : 'venue-pill'} onClick={() => switchVenue('asepad')}>AseDex</button>
                    </div>
                    <button type="button" className="token-select" onClick={() => setTokenModalOpen(true)} aria-haspopup="dialog">
                      <span className="token-badge" aria-hidden="true">{sym.slice(0, 1)}</span>
                      <span className="token-select-main">
                        <strong>{sym}</strong>
                        <small>{selectedPool ? `pool #${selectedPool.id} · ${sourceType === 'asepad' ? 'AseDex' : 'Auras'}` : 'no live pool'}</small>
                      </span>
                      <span className="token-price">{selectedPool ? `1 ${sym} = ${weiToAse(selectedPool.spot, 6)} ASE` : '—'}</span>
                      <span className="token-chevron" aria-hidden="true">▾</span>
                    </button>
                  </div>

                  {wallet.connected && template.trades && template.id !== 'dca' && (!currentTokenHolding || currentTokenHolding.balanceNum === 0) && (
                    <div className="compact-alert">
                      <div>
                        <strong>0 {sym} in wallet.</strong>{' '}
                        <span>Pick a token you hold or switch to DCA with ASE.</span>
                      </div>
                      <div className="chip-row" style={{ margin: 0 }}>
                        {tokensWithBalance.slice(0, 3).map((holding) => (
                          <button key={holding.token} type="button" className="chip-btn" onClick={() => selectTokenPool(holding)}>
                            {holding.symbol}
                          </button>
                        ))}
                        <button type="button" className="chip-btn" onClick={() => selectBotType('dca')}>
                          Switch to DCA
                        </button>
                      </div>
                    </div>
                  )}

                  {template.id === 'dca' && (
                    <div className="amount-field">
                      <div className="amount-field-head">
                        <label htmlFor="dcaBudget">Total budget</label>
                        <span className="field-help">Available: {aseBalance} ASE</span>
                      </div>
                      <div className="amount-input">
                        <input id="dcaBudget" value={buyBudgetAse} onChange={(event) => setBuyBudgetAse(event.target.value)} inputMode="decimal" aria-label="Total ASE budget" />
                        <span className="amount-unit">ASE</span>
                      </div>
                      <div className="pct-row">
                        <button type="button" className="pct-btn" onClick={() => applyAsePct(0.25)}>25%</button>
                        <button type="button" className="pct-btn" onClick={() => applyAsePct(0.5)}>50%</button>
                        <button type="button" className="pct-btn" onClick={() => applyAsePct(0.75)}>75%</button>
                        <button type="button" className="pct-btn" onClick={() => applyAsePct(1)}>MAX</button>
                      </div>
                    </div>
                  )}

                  {template.id === 'limit-exit' && (
                    <div className="amount-field">
                      <div className="amount-field-head">
                        <label htmlFor="limitSize">Amount to sell</label>
                        <span className="field-help">Available: {tokenBalance} {sym}</span>
                      </div>
                      <div className="amount-input">
                        <input id="limitSize" value={size} onChange={(event) => { setBudget(event.target.value); setSize(event.target.value); }} inputMode="decimal" aria-label={`Amount of ${sym} to sell`} />
                        <span className="amount-unit">{sym}</span>
                      </div>
                      <div className="pct-row">
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.25)}>25%</button>
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.5)}>50%</button>
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.75)}>75%</button>
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(1)}>MAX</button>
                      </div>
                    </div>
                  )}

                  {template.id === 'grid' && (
                    <div className="param-grid">
                      <div className="amount-field">
                        <div className="amount-field-head">
                          <label htmlFor="gridBudget">Tokens to sell</label>
                          <span className="field-help">Avail: {tokenBalance} {sym}</span>
                        </div>
                        <div className="amount-input">
                          <input id="gridBudget" value={budget} onChange={(event) => setBudgetDerived(event.target.value)} inputMode="decimal" aria-label={`Amount of ${sym} for sell levels`} />
                          <span className="amount-unit">{sym}</span>
                        </div>
                        <div className="pct-row">
                          <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.25)}>25%</button>
                          <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.5)}>50%</button>
                          <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.75)}>75%</button>
                          <button type="button" className="pct-btn" onClick={() => applyTokenPct(1)}>MAX</button>
                        </div>
                      </div>

                      <div className="amount-field">
                        <div className="amount-field-head">
                          <label htmlFor="gridAse">ASE to buy with</label>
                          <span className="field-help">Avail: {aseBalance} ASE</span>
                        </div>
                        <div className="amount-input">
                          <input id="gridAse" value={buyBudgetAse} onChange={(event) => changeBuyBudget(event.target.value)} inputMode="decimal" aria-label="ASE reserve for buy levels" />
                          <span className="amount-unit">ASE</span>
                        </div>
                        <div className="pct-row">
                          <button type="button" className="pct-btn" onClick={() => applyAsePct(0.25)}>25%</button>
                          <button type="button" className="pct-btn" onClick={() => applyAsePct(0.5)}>50%</button>
                          <button type="button" className="pct-btn" onClick={() => applyAsePct(0.75)}>75%</button>
                          <button type="button" className="pct-btn" onClick={() => applyAsePct(1)}>MAX</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {template.id === 'risk-managed' && (
                    <div className="amount-field">
                      <div className="amount-field-head">
                        <label htmlFor="riskAllocation">Total token allocation</label>
                        <span className="field-help">Available: {tokenBalance} {sym}</span>
                      </div>
                      <div className="amount-input">
                        <input id="riskAllocation" value={budget} onChange={(event) => setBudgetDerived(event.target.value)} inputMode="decimal" aria-label={`Total allocation of ${sym}`} />
                        <span className="amount-unit">{sym}</span>
                      </div>
                      <div className="pct-row">
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.25)}>25%</button>
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.5)}>50%</button>
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.75)}>75%</button>
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(1)}>MAX</button>
                      </div>
                    </div>
                  )}

                  {template.id === 'twap' && (
                    <div className="amount-field">
                      <div className="amount-field-head">
                        <label htmlFor="twapBudget">Amount to sell</label>
                        <span className="field-help">Available: {tokenBalance} {sym}</span>
                      </div>
                      <div className="amount-input">
                        <input id="twapBudget" value={budget} onChange={(event) => setBudgetDerived(event.target.value)} inputMode="decimal" aria-label={`Amount of ${sym} to sell`} />
                        <span className="amount-unit">{sym}</span>
                      </div>
                      <div className="pct-row">
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.25)}>25%</button>
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.5)}>50%</button>
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.75)}>75%</button>
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(1)}>MAX</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="builder-step">
                  <div className="builder-step-head">
                    <span className="builder-step-title">
                      <span className="builder-step-num">2</span>
                      Strategy Rules
                    </span>
                  </div>

                  {template.id === 'dca' && (
                    <>
                      <div className="param-grid">
                        <div className="field" style={{ marginTop: 0 }}>
                          <label htmlFor="dcaBuySize">Spend per purchase · ASE</label>
                          <input id="dcaBuySize" className="input" value={buySizeAse} onChange={(event) => setBuySizeAse(event.target.value)} inputMode="decimal" />
                        </div>
                        <div className="field" style={{ marginTop: 0 }}>
                          <label>Buy frequency</label>
                          <div className="chip-row">
                            {intervalChips.map((chip) => (
                              <button key={chip.value} type="button" className={interval === chip.value ? 'chip-btn active' : 'chip-btn'} onClick={() => setInterval(chip.value)}>
                                {chip.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {template.id === 'limit-exit' && (
                    <div className="param-grid">
                      <div className="field" style={{ marginTop: 0 }}>
                        <label>Target rise</label>
                        <div className="chip-row">
                          {[2, 5, 10, 20].map((pct) => (
                            <button
                              key={pct}
                              type="button"
                              className={targetUpsidePct === pct ? 'chip-btn active' : 'chip-btn'}
                              onClick={() => setTargetUpsideBps(String(pct * 100))}
                            >
                              +{pct}%
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="field" style={{ marginTop: 0 }}>
                        <label>Target price &amp; payout</label>
                        <div className="mono" style={{ fontSize: 16, paddingTop: 4 }}>{amt(targetPrice, 6)} ASE</div>
                        <small className="muted mono" style={{ fontSize: 13.5, display: 'block', marginTop: 4 }}>
                          Est. payout: <strong style={{ color: 'var(--accent)' }}>~{amt(estAseOut, 4)} ASE</strong>
                        </small>
                      </div>
                    </div>
                  )}

                  {template.id === 'grid' && (
                    <>
                      <div className="param-grid">
                        <div className="field" style={{ marginTop: 0 }}>
                          <label>Step between levels</label>
                          <div className="chip-row">
                            {[100, 200, 500].map((bps) => (
                              <button key={bps} type="button" className={Number(threshold) === bps ? 'chip-btn active' : 'chip-btn'} onClick={() => setThreshold(String(bps))}>
                                {bps / 100}%
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="field" style={{ marginTop: 0 }}>
                          <label>Number of levels</label>
                          <div className="chip-row">
                            {[3, 5, 10].map((count) => (
                              <button key={count} type="button" className={levelCount === count ? 'chip-btn active' : 'chip-btn'} onClick={() => changeLevels(String(count))}>
                                {count}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <p className="field-help">
                        Per level: sell {size || '0'} {sym} / buy with {buySizeAse || '0'} ASE.
                      </p>
                    </>
                  )}

                  {template.id === 'risk-managed' && (
                    <div className="param-grid">
                      <div className="field" style={{ marginTop: 0 }}>
                        <label>Stop-loss</label>
                        <div className="chip-row">
                          {[5, 10, 15].map((pct) => (
                            <button key={pct} type="button" className={stopLossPct === pct ? 'chip-btn active' : 'chip-btn'} onClick={() => setStopLossBps(String(pct * 100))}>
                              -{pct}%
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="field" style={{ marginTop: 0 }}>
                        <label>Take-profit</label>
                        <div className="chip-row">
                          {[5, 10, 20].map((pct) => (
                            <button key={pct} type="button" className={takeProfitPct === pct ? 'chip-btn active' : 'chip-btn'} onClick={() => setTakeProfitBps(String(pct * 100))}>
                              +{pct}%
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {template.id === 'twap' && (
                    <>
                      <div className="param-grid">
                        <div className="field" style={{ marginTop: 0 }}>
                          <label>Number of orders</label>
                          <div className="chip-row">
                            {[5, 10, 20].map((count) => (
                              <button key={count} type="button" className={sliceCount === count ? 'chip-btn active' : 'chip-btn'} onClick={() => changeSlices(count)}>
                                {count}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="field" style={{ marginTop: 0 }}>
                          <label>Each order</label>
                          <div className="mono" style={{ fontSize: 17, paddingTop: 8 }}>{size || '0'} {sym}</div>
                        </div>
                      </div>
                      <p className="field-help">Executes 1 order every {intervalLabel(interval)} (~{intervalLabel(sliceCount * interval)} total).</p>
                    </>
                  )}
                </div>

                <details className="soft-details">
                  <summary>Advanced settings &amp; schedule options</summary>
                  <div className="soft-details-body" style={{ display: 'grid', gap: 16 }}>
                    {template.id === 'dca' && (
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="dcaInterval">Custom interval · seconds (min 60)</label>
                        <input id="dcaInterval" className="input" type="number" min={60} max={86400} value={interval} onChange={(event) => setInterval(Number(event.target.value))} />
                      </div>
                    )}

                    {template.id === 'limit-exit' && (
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="limitTarget">Custom target rise · %</label>
                        <input
                          id="limitTarget"
                          className="input"
                          value={targetUpsidePct}
                          onChange={(event) => setTargetUpsideBps(String(Math.round((Number(event.target.value) || 0) * 100)))}
                          inputMode="decimal"
                        />
                      </div>
                    )}

                    {template.id === 'risk-managed' && (
                      <>
                        <div className="param-grid">
                          <div className="field" style={{ marginTop: 0 }}>
                            <label htmlFor="riskSize">Sell per run · {sym}</label>
                            <input id="riskSize" className="input" value={size} onChange={(event) => setSize(event.target.value)} inputMode="decimal" />
                          </div>
                          <div className="field" style={{ marginTop: 0 }}>
                            <label htmlFor="riskCostBasis">Average buy price · ASE</label>
                            <input id="riskCostBasis" className="input" value={costBasis} onChange={(event) => setCostBasis(event.target.value)} placeholder="e.g. 0.302" inputMode="decimal" />
                          </div>
                        </div>
                        <div className="param-grid">
                          <div className="field" style={{ marginTop: 0 }}>
                            <label htmlFor="riskDailyLoss">Daily loss cap · ASE</label>
                            <input id="riskDailyLoss" className="input" value={dailyLossLimit} onChange={(event) => setDailyLossLimit(event.target.value)} inputMode="decimal" />
                          </div>
                          <div className="field" style={{ marginTop: 0 }}>
                            <label>Check frequency</label>
                            <div className="chip-row">
                              {riskIntervalChips.map((chip) => (
                                <button key={chip.value} type="button" className={interval === chip.value ? 'chip-btn active' : 'chip-btn'} onClick={() => setInterval(chip.value)}>
                                  {chip.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {template.id === 'twap' && (
                      <div className="field" style={{ marginTop: 0 }}>
                        <label>Slice interval</label>
                        <div className="chip-row">
                          {intervalChips.map((chip) => (
                            <button key={chip.value} type="button" className={interval === chip.value ? 'chip-btn active' : 'chip-btn'} onClick={() => setInterval(chip.value)}>
                              {chip.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <label className="hub-toggle" style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5, color: 'var(--text-2)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={publishToHub}
                        onChange={(event) => setPublishToHub(event.target.checked)}
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      <span>
                        Show this bot on the public leaderboard <span className="muted">(adds one wallet approval)</span>
                      </span>
                    </label>
                  </div>
                </details>

                <div className="terminal-note">
                  <span>Cron gas escrow (unused ASE returned on stop)</span>
                  <strong className="mono">~{escrow} ASE</strong>
                </div>

                {isWalletLocked && (
                  <div className="compact-alert">
                    <div>
                      <strong>Asentum Wallet is locked.</strong>{' '}
                      <span>Unlock the browser extension to launch.</span>
                    </div>
                  </div>
                )}

                <button className="btn btn-primary launch-btn" type="button" onClick={deployLite} disabled={launchDisabled || isWalletLocked}>
                  {deploying ? 'Deploying & Initializing…' : !wallet.connected ? 'Connect wallet to launch' : isWalletLocked ? 'Unlock wallet to launch' : `Launch ${activeBot.title} bot`}
                </button>
                {stage && <div className="deploy-stage" role="status">{stage}</div>}
                {error && <div className="notice deploy-error" role="alert">{error}</div>}
                {resultWarning && <div className="notice deploy-warning">{resultWarning}</div>}
                {resultAddress && (
                  <div className="deploy-result">
                    <div className="live-dot">Contract deployed</div>
                    <a className="mono" href={explorerAddressUrl(resultAddress)} target="_blank" rel="noreferrer">{displayAseAddress(resultAddress)}</a>
                    <div className="muted">{registrationOk ? 'Published to the leaderboard.' : publishToHub ? 'Check the leaderboard warning above.' : 'Saved in your Portfolio.'}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          <aside className="terminal-side">
            <div className="seg-tabs" style={{ marginTop: 0, width: '100%' }} role="tablist" aria-label="Strategy preview mode">
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === 'summary'}
                className={sideTab === 'summary' ? 'seg-tab active' : 'seg-tab'}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setSideTab('summary')}
              >
                Order Summary
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === 'chart'}
                className={sideTab === 'chart' ? 'seg-tab active' : 'seg-tab'}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setSideTab('chart')}
              >
                7D Chart &amp; Replay
              </button>
            </div>

            {sideTab === 'summary' ? (
              <div className="panel preview-card">
                <div className="panel-head">
                  <span className="label">What the bot will do</span>
                  <span className="pill pill-live">{activeBot.title}</span>
                </div>
                <div className="panel-body">
                  <p className="preview-lead">{previewLead}</p>
                  {previewFacts.map((fact) => (
                    <div className="preview-fact" key={fact.label}>
                      <span>{fact.label}</span>
                      <strong>{fact.value}</strong>
                    </div>
                  ))}
                  <div className="preview-fact">
                    <span>
                      Network fee
                      <InfoTip
                        label="Cron gas escrow"
                        text="Held in on-chain Cron escrow to pay scheduled executions. Unused ASE returns to your contract when you stop the bot and can be withdrawn."
                      />
                    </span>
                    <strong>{escrow} ASE</strong>
                  </div>
                  <div className="safety-line">
                    <span className="safety-icon" aria-hidden="true">✓</span>
                    <span>100% on-chain contract you own. Stop or withdraw anytime.</span>
                  </div>
                  <details className="soft-details" style={{ marginTop: 6 }}>
                    <summary>Execution &amp; safety notes</summary>
                    <div className="soft-details-body">
                      <p style={{ margin: 0 }}>
                        {IS_TESTNET ? 'Experimental testnet software' : 'Non-custodial on-chain software'}, not investment advice. Stopping the cron job returns unused escrow to the contract so ASE and tokens can be withdrawn.
                      </p>
                      <Link className="link-arrow" to="/how" style={{ display: 'inline-flex', marginTop: 10 }}>How it works →</Link>
                    </div>
                  </details>
                </div>
              </div>
            ) : (
              <StrategyPreviewPanel
                mode="spot"
                pool={selectedPool}
                params={{
                  templateId: template.id,
                  spotPrice: spotAse,
                  thresholdBps: Number(threshold) || 0,
                  levels: levelCount,
                  slices: sliceCount,
                  intervalSec: interval,
                  stopLossBps: Number(stopLossBps) || 0,
                  takeProfitBps: Number(takeProfitBps) || 0,
                  targetUpsideBps: Number(targetUpsideBps) || 0,
                  costBasis: Number(costBasis) || 0,
                  feeBps: Number(selectedPool?.feeBps ?? 30) || 30,
                }}
              />
            )}
          </aside>
        </div>
        )}
      </section>

      {tokenModalOpen && (
        <div className="deploy-modal-backdrop" role="dialog" aria-modal="true" aria-label="Select token">
          <div className="deploy-modal token-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Select a token</h3>
              <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 16 }} onClick={() => setTokenModalOpen(false)} aria-label="Close token selector">✕</button>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              All live pools on {sourceType === 'asepad' ? 'AseDex' : 'Auras'} and AseDex. Balances come from your connected wallet.
            </p>
            <div className="token-search">
              <input
                className="input"
                value={tokenQuery}
                onChange={(event) => setTokenQuery(event.target.value)}
                placeholder="Search by symbol or address"
                aria-label="Search token"
              />
            </div>
            <div className="token-list">
              {filteredModalPools.slice(0, 80).map((pool) => {
                const holding = userHoldings.find((item) => item.token.toLowerCase() === pool.token.toLowerCase());
                const active = pool.id === poolId && (pool.venue === 'asedex' ? sourceType === 'asepad' : sourceType === 'strata');
                return (
                  <button
                    key={`${pool.venue ?? 'auras'}-${pool.id}`}
                    type="button"
                    className={active ? 'token-row-btn active' : 'token-row-btn'}
                    onClick={() => handleSelectPool(pool)}
                  >
                    <span className="token-badge" aria-hidden="true">{pool.symbol.slice(0, 1)}</span>
                    <span className="token-select-main">
                      <strong>{pool.symbol}</strong>
                      <small>{pool.venue === 'asedex' ? 'AseDex' : 'Auras'} · pool #{pool.id}</small>
                    </span>
                    <span className="token-price">
                      {holding ? `${holding.balanceFmt} ${pool.symbol}` : '—'}
                      <br />
                      {weiToAse(pool.spot, 6)} ASE
                    </span>
                  </button>
                );
              })}
              {filteredModalPools.length === 0 && <p className="muted" style={{ padding: '12px 8px' }}>No pool matches that search.</p>}
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="deploy-modal-backdrop" role="dialog" aria-modal="true">
          <div className="deploy-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>
                {currentStep > totalSteps ? 'Bot is live' : `Launching ${activeBot.title} bot`}
              </h3>
              {(!deploying || currentStep > totalSteps || stepStatus === 'error') && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '2px 8px', fontSize: 16 }}
                  onClick={() => setModalOpen(false)}
                >
                  ✕
                </button>
              )}
            </div>

            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              {currentStep > totalSteps
                ? 'Your bot is live on Asentum. You can close it and get your funds back from Portfolio at any time.'
                : 'Approve each wallet prompt as it appears — that is all. Keep this tab open while the network confirms.'}
            </p>

            <div className="deploy-stepper-progress">
              <div
                className="deploy-stepper-bar"
                style={{
                  width: currentStep > totalSteps ? '100%' : `${Math.max(10, ((currentStep - 1) / totalSteps) * 100)}%`,
                  background: stepStatus === 'error' ? 'var(--down)' : undefined,
                }}
              />
            </div>

            <div className="stepper-list">
              <div className={`stepper-item ${currentStep === 1 ? 'active' : currentStep > 1 ? 'done' : ''}`}>
                <div className={`stepper-icon ${currentStep > 1 ? 'done' : currentStep === 1 ? (stepStatus === 'error' ? 'error' : 'active') : 'pending'}`}>
                  {currentStep > 1 ? '✓' : '1'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>1. Create the bot contract</strong>
                    {txHashes.deploy && (
                      <a href={explorerTxUrl(txHashes.deploy)} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 13.5, color: 'var(--accent)' }}>
                        Tx ↗
                      </a>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 13.5 }}>
                    {currentStep === 1 && stepStatus === 'waiting_signature' && 'Please sign the contract deployment in your wallet…'}
                    {currentStep === 1 && stepStatus === 'confirming' && 'Waiting for block confirmation…'}
                    {currentStep > 1 && (resultAddress ? `Deployed at ${toAse1(resultAddress).slice(0, 10)}…` : 'Contract created')}
                  </div>
                </div>
              </div>

              <div className={`stepper-item ${currentStep === 2 ? 'active' : currentStep > 2 ? 'done' : ''}`}>
                <div className={`stepper-icon ${currentStep > 2 ? 'done' : currentStep === 2 ? (stepStatus === 'error' ? 'error' : 'active') : 'pending'}`}>
                  {currentStep > 2 ? '✓' : '2'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>2. Turn the bot on</strong>
                    {txHashes.init && (
                      <a href={explorerTxUrl(txHashes.init)} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 13.5, color: 'var(--accent)' }}>
                        Tx ↗
                      </a>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 13.5 }}>
                    {currentStep === 2 && stepStatus === 'waiting_signature' && 'Confirm the start in your wallet…'}
                    {currentStep === 2 && stepStatus === 'confirming' && 'Arming the schedule on Asentum…'}
                    {currentStep > 2 && 'Schedule armed — the bot is running'}
                  </div>
                </div>
              </div>

              {needsFund && (
                <div className={`stepper-item ${currentStep === 3 ? 'active' : currentStep > 3 ? 'done' : ''}`}>
                  <div className={`stepper-icon ${currentStep > 3 ? 'done' : currentStep === 3 ? (stepStatus === 'error' ? 'error' : 'active') : 'pending'}`}>
                    {currentStep > 3 ? '✓' : '3'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>3. Deposit the tokens</strong>
                      {txHashes.fund && (
                        <a href={explorerTxUrl(txHashes.fund)} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 13.5, color: 'var(--accent)' }}>
                          Tx ↗
                        </a>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: 13.5 }}>
                      {currentStep === 3 && stepStatus === 'waiting_signature' && `Confirm the transfer of ${budget} ${selectedPool?.symbol} in your wallet…`}
                      {currentStep === 3 && stepStatus === 'confirming' && 'Confirming token transfer…'}
                      {currentStep > 3 && `${budget} ${selectedPool?.symbol} deposited`}
                    </div>
                  </div>
                </div>
              )}

              {publishToHub && (
              <div className={`stepper-item ${currentStep === 4 ? 'active' : currentStep > 4 ? 'done' : ''}`}>
                <div className={`stepper-icon ${currentStep > 4 ? 'done' : currentStep === 4 ? (stepStatus === 'error' ? 'error' : 'active') : 'pending'}`}>
                  {currentStep > 4 ? '✓' : '4'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>4. Publish to the leaderboard</strong>
                    {txHashes.register && (
                      <a href={explorerTxUrl(txHashes.register)} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 13.5, color: 'var(--accent)' }}>
                        Tx ↗
                      </a>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 13.5 }}>
                    {currentStep === 4 && stepStatus === 'waiting_signature' && 'Confirm the leaderboard listing in your wallet…'}
                    {currentStep === 4 && stepStatus === 'confirming' && 'Publishing to the leaderboard…'}
                    {currentStep > 4 && 'Published to the leaderboard'}
                  </div>
                </div>
              </div>
              )}
            </div>

            {stepError && (
              <div className="notice" style={{ borderColor: 'var(--down)', background: 'var(--down-soft)', marginBottom: 16 }}>
                <strong style={{ color: 'var(--down)' }}>Transaction halted:</strong>
                <p style={{ margin: '4px 0 0', fontSize: 13 }}>{stepError}</p>
                {resultAddress && currentStep > 1 && (
                  <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.55 }}>
                    The contract <span className="mono">{shortAddr(resultAddress, 10, 6)}</span> is already on chain and saved in your Portfolio.
                    {currentStep === 3
                      ? ' Finish its token deposit there instead of creating a duplicate.'
                      : ' Remove it there before starting over — a retry here creates a second contract.'}
                  </p>
                )}
                {/session|expired|locked/i.test(stepError) && (
                  <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--warn-soft)', border: '1px solid var(--warn)', borderRadius: 6 }}>
                    <strong style={{ color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      🔒 Wallet is locked in browser extension
                    </strong>
                    <p style={{ margin: '4px 0 0', fontSize: 13.5, lineHeight: 1.5 }}>
                      The Asentum browser extension requires your password before signing transactions.
                    </p>
                    <ol style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13.5, lineHeight: 1.5 }}>
                      <li>Click the <strong>Asentum extension icon</strong> in your browser toolbar (top right).</li>
                      <li>Enter your <strong>password</strong> to unlock the wallet.</li>
                      <li>Click <strong>«🔓 I unlocked it — Retry»</strong> below.</li>
                    </ol>
                  </div>
                )}
                {resultAddress && (
                  <p className="muted" style={{ margin: '8px 0 0', fontSize: 13.5 }}>
                    The contract was deployed at {shortAddr(resultAddress)} and is saved in your Portfolio.
                  </p>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              {currentStep > totalSteps ? (
                <>
                  <Link to="/portfolio" className="btn btn-ghost" onClick={() => setModalOpen(false)}>
                    View in Portfolio
                  </Link>
                  {resultAddress && (
                    <Link to={`/strategies/${resultAddress}`} className="btn btn-primary" onClick={() => setModalOpen(false)}>
                      Manage bot ↗
                    </Link>
                  )}
                </>
              ) : stepStatus === 'error' ? (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>
                    Close
                  </button>
                  {resultAddress && currentStep === 3 ? (
                    <Link to="/portfolio" className="btn btn-primary" onClick={() => setModalOpen(false)}>
                      Finish deposit in Portfolio ↗
                    </Link>
                  ) : /session|expired|locked|reconnect/i.test(stepError) ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          setModalOpen(false);
                          wallet.openConnect();
                        }}
                      >
                        🔗 Reconnect wallet
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={async () => {
                          if (typeof window !== 'undefined' && (window as any).asentum?.isUnlocked) {
                            try {
                              const unlocked = await (window as any).asentum.isUnlocked();
                              if (!unlocked) {
                                setStepError('The Asentum extension is still locked. Please click the extension icon in your browser toolbar and enter your password.');
                                return;
                              }
                            } catch {
                              // non-blocking
                            }
                          }
                          setStepError('');
                          setError('');
                          deployLite();
                        }}
                      >
                        🔓 I unlocked it — Retry
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={deployLite}>
                      {resultAddress && currentStep > 1 ? 'Start over from scratch' : 'Retry deployment'}
                    </button>
                  )}
                </>
              ) : (
                <button type="button" className="btn btn-ghost" disabled>
                  {stepStatus === 'waiting_signature' ? 'Waiting for wallet approval…' : 'Processing on Asentum…'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}


function displayAseAddress(address: string): string {
  return address.toLowerCase().startsWith('ase1') ? address : toAse1(address);
}

function intervalLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} min`;
  }
  if (seconds < 86400) {
    const hours = seconds / 3600;
    const rounded = Math.round(hours * 10) / 10;
    return `${rounded} ${rounded === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(seconds / 86400);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
