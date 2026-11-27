import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAsentum, useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { StrategyPreviewPanel } from './StrategyPreviewPanel';
import { InfoTip } from './InfoTip';
import {
  PERP_BOT_TYPES,
  PERPS_DIRECT_BOT_TYPES,
  templateById,
  type PerpsDirectKind,
} from '../lib/templates';
import {
  PERPS_APP_URL,
  PERPS_CFG,
  calcPerpsLiquidationPrice,
  calcPerpsSizeWei,
  depositPerpsCollateral,
  loadPerpsAccount,
  loadPerpsMarkets,
  numberToPerpsPriceWei,
  placePerpsNativeOrder,
  type PerpsMarket,
  type PlacePerpsOrderPayload,
} from '../lib/perps';
import {
  explorerTxUrl,
  getAccountMeta,
  getBalance,
  getContractSource,
  hashSource,
  rpcCall,
  toAse1,
} from '../lib/rpc';
import { fmtNum, shortAddr, weiToAse } from '../lib/format';
import { saveUserStrategy, saveUserTx } from '../lib/userStrategies';

import perpDcaSource from '../../contracts/perp-dca.js?raw';
import perpTriggerSource from '../../contracts/perp-trigger.js?raw';
import perpGridSource from '../../contracts/perp-grid.js?raw';
import perpRiskSource from '../../contracts/perp-risk.js?raw';
import perpTwapSource from '../../contracts/perp-twap.js?raw';
import perpMomentumSource from '../../contracts/perp-momentum.js?raw';

const PERP_SOURCES: Record<string, string> = {
  'perp-dca': perpDcaSource,
  'perp-trigger': perpTriggerSource,
  'perp-grid': perpGridSource,
  'perp-risk': perpRiskSource,
  'perp-twap': perpTwapSource,
  'perp-momentum': perpMomentumSource,
};

const PERP_CRON_ESCROW = '0.05';
const PERP_MIN_CRON_ESCROW_WEI = 4_500_000n;
const WALLET_PROMPT_TIMEOUT_MS = 180_000;

function toPlainDecimal(value: number, maxFrac = 10): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  const fixed = value.toFixed(maxFrac).replace(/0+$/, '').replace(/\.$/, '');
  return fixed || '';
}

function toUnits(value: string, decimals = 18): bigint {
  const clean = value.trim();
  if (!/^\d+(?:\.\d*)?$/.test(clean)) throw new Error('Enter a valid positive amount.');
  const [whole, fraction = ''] = clean.split('.');
  if (fraction.length > decimals) throw new Error(`Supports at most ${decimals} decimal places.`);
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (units <= 0n) throw new Error('Amount must be greater than zero.');
  return units;
}

function withWalletTimeout<T>(action: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(
        `${label}: the wallet did not answer within ${WALLET_PROMPT_TIMEOUT_MS / 1000} seconds. ` +
        'Open the Asentum wallet, approve or reject the pending request, then try again.',
      ));
    }, WALLET_PROMPT_TIMEOUT_MS);
    action.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

async function assertBroadcast(txHash: string, label: string): Promise<void> {
  if (!txHash) throw new Error(`${label}: the wallet did not return a transaction hash.`);
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const tx = await rpcCall<unknown>('eth_getTransactionByHash', [txHash]).catch(() => undefined);
    if (tx) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `${label}: Asentum still has no record of transaction ${txHash.slice(0, 12)}…. Open the wallet and retry.`,
  );
}

function intervalLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) {
    const hours = Math.round((seconds / 3600) * 10) / 10;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(seconds / 86400);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export function PerpsBotBuilder() {
  const [params, setSearchParams] = useSearchParams();
  const wallet = useWallet();
  const client = useAsentum();

  const initialTemplateParam = params.get('template') ?? '';
  const initialKindParam = (params.get('kind') ?? '').toUpperCase() as PerpsDirectKind;
  const initialModeParam = params.get('mode') === 'direct' || PERPS_DIRECT_BOT_TYPES.some((k) => k.kind === initialKindParam)
    ? 'direct'
    : 'contract';

  const [perpMode, setPerpMode] = useState<'contract' | 'direct'>(initialModeParam);
  const [sideTab, setSideTab] = useState<'summary' | 'chart'>('summary');
  const [contractTemplateId, setContractTemplateId] = useState(
    PERP_SOURCES[initialTemplateParam] ? initialTemplateParam : 'perp-dca',
  );
  const [directKind, setDirectKind] = useState<PerpsDirectKind>(
    PERPS_DIRECT_BOT_TYPES.some((k) => k.kind === initialKindParam) ? initialKindParam : 'DCA',
  );

  const [marketId, setMarketId] = useState(params.get('market') ?? '1');
  const [side, setSide] = useState<'LONG' | 'SHORT'>(
    params.get('side')?.toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG',
  );
  const [leverage, setLeverage] = useState(() => {
    const n = Number(params.get('leverage') ?? '3');
    return Number.isFinite(n) && n >= 1 ? Math.round(n) : 3;
  });

  // Shared margin / sizing fields
  const [totalMargin, setTotalMargin] = useState(params.get('margin') ?? '2');
  const [legMargin, setLegMargin] = useState(params.get('legMargin') ?? '0.5');
  const [interval, setInterval] = useState(Number(params.get('interval') ?? '300'));

  // Contract template specifics
  const [tpPct, setTpPct] = useState(params.get('tpPct') ?? '10');
  const [slPct, setSlPct] = useState(params.get('slPct') ?? '5');
  const [drawdownPct, setDrawdownPct] = useState(params.get('drawdownPct') ?? '8');
  const [triggerDir, setTriggerDir] = useState<'below' | 'above'>(
    params.get('triggerDir') === 'above' ? 'above' : 'below',
  );
  const [triggerMovePct, setTriggerMovePct] = useState(params.get('triggerMovePct') ?? '3');
  const [stepPct, setStepPct] = useState(params.get('stepPct') ?? '2');
  const [levels, setLevels] = useState(params.get('levels') ?? '5');
  const [slices, setSlices] = useState(params.get('slices') ?? '4');
  const [momentumBps, setMomentumBps] = useState(params.get('threshold') ?? '100');

  // Direct `perps.asepad.fun` native order specifics
  const [limitPrice, setLimitPrice] = useState('');
  const [scaleFrom, setScaleFrom] = useState('');
  const [scaleTo, setScaleTo] = useState('');
  const [scaleSteps, setScaleSteps] = useState('4');
  const [trailPct, setTrailPct] = useState('2');
  const [stopKind, setStopKind] = useState<'STOP' | 'TP'>('STOP');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [directTpPrice, setDirectTpPrice] = useState('');
  const [directSlPrice, setDirectSlPrice] = useState('');
  const [postOnly, setPostOnly] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [directExpiryHours, setDirectExpiryHours] = useState(24);

  const [marketModalOpen, setMarketModalOpen] = useState(false);
  const [marketQuery, setMarketQuery] = useState('');

  const [busy, setBusy] = useState(false);
  const [isWalletLocked, setIsWalletLocked] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [resultAddress, setResultAddress] = useState('');
  const [resultWarning, setResultWarning] = useState('');
  const [directTxHash, setDirectTxHash] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepStatus, setStepStatus] = useState<'idle' | 'waiting_signature' | 'confirming' | 'done' | 'error'>('idle');
  const [stepError, setStepError] = useState('');
  const [txHashes, setTxHashes] = useState<{ deploy?: string; init?: string; deposit?: string; order?: string }>({});

  const launchInFlightRef = useRef(false);

  const marketsState = useAsync(() => loadPerpsMarkets(), 20_000);
  const markets = useMemo(() => marketsState.data ?? [], [marketsState.data]);
  const selectedMarket: PerpsMarket | null = useMemo(
    () => markets.find((m) => m.id === marketId) ?? markets[0] ?? null,
    [markets, marketId],
  );

  const accountState = useAsync(
    () => (wallet.connected && wallet.address && selectedMarket
      ? loadPerpsAccount(wallet.address, selectedMarket.id)
      : Promise.resolve(null)),
    15_000,
    Boolean(wallet.connected && wallet.address && selectedMarket),
    `${wallet.address ?? ''}:${selectedMarket?.id ?? ''}`,
  );

  const nativeBalState = useAsync(
    () => (wallet.connected && wallet.address ? getBalance(wallet.address) : Promise.resolve({ balance: '0', nonce: '0' })),
    20_000,
    Boolean(wallet.connected && wallet.address),
    wallet.address ?? '',
  );

  useEffect(() => {
    let active = true;
    const checkLock = async () => {
      const ext = typeof window !== 'undefined' ? (window as unknown as { asentum?: { isUnlocked?: () => Promise<boolean> } }).asentum : undefined;
      if (ext?.isUnlocked && wallet.connected) {
        try {
          const unlocked = await ext.isUnlocked();
          if (active) setIsWalletLocked(!unlocked);
        } catch {
          if (active) setIsWalletLocked(false);
        }
      } else if (active) {
        setIsWalletLocked(false);
      }
    };
    void checkLock();
    window.addEventListener('focus', checkLock);
    const id = window.setInterval(() => void checkLock(), 2000);
    return () => {
      active = false;
      window.removeEventListener('focus', checkLock);
      window.clearInterval(id);
    };
  }, [wallet.connected]);

  // Ensure interval respects market minDcaIntervalMs in Direct DCA mode.
  useEffect(() => {
    if (perpMode === 'direct' && directKind === 'DCA' && selectedMarket) {
      const minSec = Math.max(60, Math.ceil(selectedMarket.minDcaIntervalMs / 1000));
      if (interval < minSec) setInterval(minSec);
    }
  }, [perpMode, directKind, selectedMarket, interval]);

  // Seed default prices from mark price once per market change.
  const priceSeedMarketRef = useRef('');
  useEffect(() => {
    if (!selectedMarket || selectedMarket.markPrice <= 0) return;
    if (priceSeedMarketRef.current === selectedMarket.id) return;
    priceSeedMarketRef.current = selectedMarket.id;
    const m = selectedMarket.markPrice;
    setLimitPrice(toPlainDecimal(side === 'LONG' ? m * 0.98 : m * 1.02));
    setScaleFrom(toPlainDecimal(side === 'LONG' ? m * 0.99 : m * 1.01));
    setScaleTo(toPlainDecimal(side === 'LONG' ? m * 0.92 : m * 1.08));
    setTriggerPrice(toPlainDecimal(side === 'LONG' ? m * 0.95 : m * 1.05));
    setLeverage((prev) => Math.min(Math.max(1, prev), selectedMarket.maxLeverage));
  }, [selectedMarket, side]);

  const selectMarket = (m: PerpsMarket) => {
    setMarketId(m.id);
    setLeverage((prev) => Math.min(Math.max(1, prev), m.maxLeverage));
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('venue', 'perps');
      next.set('market', m.id);
      return next;
    }, { replace: true });
    setMarketModalOpen(false);
  };

  const aseBalanceNum = Number(weiToAse(nativeBalState.data?.balance ?? '0', 6));
  const aseBalanceFmt = weiToAse(nativeBalState.data?.balance ?? '0', 4);
  const freeVaultWei = BigInt(accountState.data?.freeCollateralWei ?? '0');
  const freeVaultFmt = weiToAse(freeVaultWei, 4);
  const openPosSizeWei = BigInt(accountState.data?.position.sizeWei ?? '0');

  const activeContractBot = PERP_BOT_TYPES.find((b) => b.templateId === contractTemplateId) ?? PERP_BOT_TYPES[0];
  const activeContractTemplate = templateById(contractTemplateId);
  const activeDirectBot = PERPS_DIRECT_BOT_TYPES.find((b) => b.kind === directKind) ?? PERPS_DIRECT_BOT_TYPES[0];

  const applyMarginPct = (pct: number) => {
    const safeMax = Math.max(0, aseBalanceNum - 0.15);
    if (safeMax <= 0) return;
    const next = toPlainDecimal(safeMax * pct, 4);
    if (!next) return;
    setTotalMargin(next);
    if (contractTemplateId === 'perp-dca') {
      const perLeg = toPlainDecimal(Math.max(0.1, Number(next) / 4), 4);
      if (perLeg) setLegMargin(perLeg);
    }
  };

  const checkWalletReady = async (): Promise<boolean> => {
    if (!wallet.connected || !wallet.address) {
      wallet.openConnect();
      return false;
    }
    const ext = typeof window !== 'undefined'
      ? (window as unknown as { asentum?: { isUnlocked?: () => Promise<boolean> } }).asentum
      : undefined;
    if (ext?.isUnlocked) {
      try {
        const unlocked = await ext.isUnlocked();
        if (!unlocked) {
          setIsWalletLocked(true);
          setError('Asentum Wallet is locked in your browser. Unlock the extension and try again.');
          return false;
        }
      } catch {
        // ignore
      }
    }
    const maybeClient = client as unknown as { checkSession?: () => Promise<boolean> };
    if (typeof maybeClient.checkSession === 'function') {
      try {
        const ok = await maybeClient.checkSession();
        if (!ok) {
          setError('Your wallet session expired. Please reconnect your wallet.');
          wallet.openConnect();
          return false;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/session|expired|locked|not connected|permission/i.test(msg)) {
          setError('Your wallet session expired or is locked. Please reconnect.');
          wallet.openConnect();
          return false;
        }
      }
    }
    return true;
  };

  const runContractBotDeploy = async () => {
    setError('');
    setResultWarning('');
    setResultAddress('');
    setStepError('');
    if (!(await checkWalletReady()) || !wallet.address) return;
    if (!selectedMarket) {
      setError('No live AsePad Perps market found.');
      return;
    }
    if (selectedMarket.state !== 'ACTIVE') {
      setError(`Market ${selectedMarket.symbol} is currently ${selectedMarket.state}, not ACTIVE.`);
      return;
    }

    const lev = Math.round(leverage);
    if (!Number.isInteger(lev) || lev < 1 || lev > selectedMarket.maxLeverage) {
      setError(`Leverage must be between 1x and ${selectedMarket.maxLeverage}x for ${selectedMarket.symbol}.`);
      return;
    }
    if (!Number.isInteger(interval) || interval < 60 || interval > 86400) {
      setError('Execution interval must be between 60 and 86,400 seconds.');
      return;
    }

    let totalMarginWei = 0n;
    let legMarginWei = 0n;
    let gasEscrow = 0n;
    let initArgs: string[] = [];

    try {
      totalMarginWei = toUnits(totalMargin, 18);
      gasEscrow = toUnits(PERP_CRON_ESCROW, 18);
      if (gasEscrow < PERP_MIN_CRON_ESCROW_WEI) throw new Error('Cron escrow too low.');
      const minNotional = BigInt(selectedMarket.minOrderNotionalWei || '0');

      const tpBpsVal = Math.round((Number(tpPct) || 0) * 100);
      const slBpsVal = Math.round((Number(slPct) || 0) * 100);
      const ddBpsVal = Math.round((Number(drawdownPct) || 0) * 100);
      if (tpBpsVal < 0 || tpBpsVal > 50000) throw new Error('Take-profit must be 0% to 500%.');
      if (slBpsVal < 0 || slBpsVal >= 10000) throw new Error('Stop-loss must be 0% to 99.99%.');

      if (contractTemplateId === 'perp-dca') {
        legMarginWei = toUnits(legMargin, 18);
        if (totalMarginWei < legMarginWei) throw new Error('Total margin must cover at least one leg.');
        if (legMarginWei * BigInt(lev) < minNotional) {
          throw new Error(`Per-leg notional (${weiToAse(legMarginWei * BigInt(lev), 4)} ASE) is below market minimum ${weiToAse(minNotional, 4)} ASE.`);
        }
        initArgs = [
          selectedMarket.id,
          side,
          String(lev),
          legMarginWei.toString(),
          totalMarginWei.toString(),
          String(interval),
          String(tpBpsVal),
          String(slBpsVal),
          PERPS_CFG,
        ];
      } else if (contractTemplateId === 'perp-trigger') {
        const moveBpsVal = Math.round((Number(triggerMovePct) || 0) * 100);
        if (moveBpsVal < 0 || moveBpsVal > 50000) throw new Error('Trigger move must be 0% to 500%.');
        if (triggerDir === 'below' && moveBpsVal >= 10000) throw new Error('Below trigger move must be below 100%.');
        if (totalMarginWei * BigInt(lev) < minNotional) {
          throw new Error(`Position notional is below market minimum ${weiToAse(minNotional, 4)} ASE.`);
        }
        initArgs = [
          selectedMarket.id,
          side,
          String(lev),
          totalMarginWei.toString(),
          String(moveBpsVal),
          triggerDir,
          String(interval),
          String(tpBpsVal),
          String(slBpsVal),
          PERPS_CFG,
        ];
      } else if (contractTemplateId === 'perp-grid') {
        const stepBpsVal = Math.round((Number(stepPct) || 0) * 100);
        const lvls = Math.round(Number(levels) || 0);
        if (stepBpsVal < 10 || stepBpsVal > 5000) throw new Error('Grid step must be between 0.1% and 50%.');
        if (!Number.isInteger(lvls) || lvls < 1 || lvls > 20) throw new Error('Grid levels must be between 1 and 20.');
        if (stepBpsVal * lvls >= 10000) throw new Error('Grid step × levels must remain below 100%.');
        const perLevel = totalMarginWei / BigInt(lvls);
        if (perLevel <= 0n || perLevel * BigInt(lev) < minNotional) {
          throw new Error(`Margin per level × leverage must be at least ${weiToAse(minNotional, 4)} ASE.`);
        }
        initArgs = [
          selectedMarket.id,
          side,
          String(lev),
          String(stepBpsVal),
          String(lvls),
          totalMarginWei.toString(),
          String(interval),
          PERPS_CFG,
        ];
      } else if (contractTemplateId === 'perp-risk') {
        if (ddBpsVal < 0 || ddBpsVal >= 10000) throw new Error('Max drawdown must be 0% to 99.99%.');
        if (slBpsVal === 0 && tpBpsVal === 0 && ddBpsVal === 0) {
          throw new Error('Enable at least one exit guard: Stop-Loss, Take-Profit or Drawdown.');
        }
        if (totalMarginWei * BigInt(lev) < minNotional) {
          throw new Error(`Position notional is below market minimum ${weiToAse(minNotional, 4)} ASE.`);
        }
        initArgs = [
          selectedMarket.id,
          side,
          String(lev),
          totalMarginWei.toString(),
          String(slBpsVal),
          String(tpBpsVal),
          String(ddBpsVal),
          String(interval),
          PERPS_CFG,
        ];
      } else if (contractTemplateId === 'perp-twap') {
        const sliceCount = Math.round(Number(slices) || 0);
        if (!Number.isInteger(sliceCount) || sliceCount < 2 || sliceCount > 100) {
          throw new Error('TWAP slices must be between 2 and 100.');
        }
        const perSlice = totalMarginWei / BigInt(sliceCount);
        if (perSlice <= 0n || perSlice * BigInt(lev) < minNotional) {
          throw new Error(`Margin per slice × leverage must be at least ${weiToAse(minNotional, 4)} ASE.`);
        }
        initArgs = [
          selectedMarket.id,
          side,
          String(lev),
          totalMarginWei.toString(),
          String(sliceCount),
          String(interval),
          PERPS_CFG,
        ];
      } else if (contractTemplateId === 'perp-momentum') {
        const thr = Math.round(Number(momentumBps) || 0);
        if (thr < 1 || thr > 10000) throw new Error('Momentum threshold must be 1..10000 bps.');
        if (totalMarginWei * BigInt(lev) < minNotional) {
          throw new Error(`Position notional is below market minimum ${weiToAse(minNotional, 4)} ASE.`);
        }
        initArgs = [selectedMarket.id, String(lev), totalMarginWei.toString(), String(thr), String(interval), PERPS_CFG];
      }

      const balWei = BigInt(nativeBalState.data?.balance ?? '0');
      if (balWei > 0n && balWei < totalMarginWei + gasEscrow) {
        throw new Error(`Insufficient ASE balance. Needed ${weiToAse(totalMarginWei + gasEscrow, 4)} ASE, available ${aseBalanceFmt} ASE.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    setBusy(true);
    setModalOpen(true);
    setCurrentStep(1);
    setStepStatus('waiting_signature');
    setTxHashes({});

    try {
      const rawSource = PERP_SOURCES[contractTemplateId];
      if (!rawSource) throw new Error('Perp contract source missing from build.');
      const source = rawSource.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      setStage('Wallet approval 1 — deploy perp bot contract');
      const deployed = await withWalletTimeout(client.deploy(source), 'Deploy perp bot contract');
      setTxHashes((prev) => ({ ...prev, deploy: deployed.txHash }));
      setStepStatus('confirming');
      saveUserTx(wallet.address, {
        hash: deployed.txHash,
        type: 'deploy',
        description: `Deploy ${activeContractTemplate.name} (${selectedMarket.symbol} ${side} ${lev}x)`,
        timestamp: Date.now(),
        status: 'pending',
      });

      await assertBroadcast(deployed.txHash, 'Deploy perp bot contract');
      const deployReceipt = await client.waitReceipt(deployed.txHash, 120_000);
      if (!deployReceipt.success) throw new Error('Contract deployment reverted.');
      const address = deployed.contractAddress
        || (deployReceipt as { recipient?: string }).recipient
        || (deployReceipt as { contractAddress?: string }).contractAddress
        || '';
      if (!address) throw new Error('The wallet did not return the deployed contract address.');
      setResultAddress(address);

      saveUserTx(wallet.address, {
        hash: deployed.txHash,
        type: 'deploy',
        description: `Deploy ${activeContractTemplate.name} (${toAse1(address).slice(0, 10)}…)`,
        timestamp: Date.now(),
        status: 'confirmed',
        strategyAddress: address,
      });

      saveUserStrategy({
        address,
        template: contractTemplateId,
        templateName: activeContractTemplate.name,
        poolId: selectedMarket.poolId,
        marketId: selectedMarket.id,
        tokenSymbol: selectedMarket.symbol,
        tokenAddress: selectedMarket.baseToken,
        venue: 'asepad-perps',
        executionMode: 'contract',
        side,
        leverage: lev,
        deployTxHash: deployed.txHash,
        status: 'deployed',
        budget: totalMargin,
        size: contractTemplateId === 'perp-dca' ? legMargin : totalMargin,
        slices,
        levels,
        threshold: contractTemplateId === 'perp-grid'
          ? String(Math.round((Number(stepPct) || 0) * 100))
          : contractTemplateId === 'perp-trigger'
            ? String(Math.round((Number(triggerMovePct) || 0) * 100))
            : momentumBps,
        interval,
        createdAt: Date.now(),
        owner: wallet.address,
      });

      // Quiet source-hash verification
      setStage('Verifying published contract source…');
      const expectedHash = await hashSource(source);
      const expectedTrimmedHash = await hashSource(source.trim());
      let deployedSource = '';
      let deployedMeta: { codeHash?: string } = {};
      for (let attempt = 0; attempt < 3; attempt++) {
        [deployedSource, deployedMeta] = await Promise.all([
          getContractSource(address).catch(() => ''),
          getAccountMeta(address).catch(() => ({} as { codeHash?: string })),
        ]);
        if (deployedSource || deployedMeta?.codeHash) break;
        await new Promise((r) => setTimeout(r, 1200));
      }
      const normRead = deployedSource.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const readHash = normRead ? await hashSource(normRead) : '';
      const storedHash = String(deployedMeta?.codeHash ?? '').replace(/^0x/, '').toLowerCase();
      if (![expectedHash, expectedTrimmedHash].includes(storedHash) && ![expectedHash, expectedTrimmedHash].includes(readHash)) {
        setResultWarning('Contract deployed. Source hash is still indexing on-chain.');
      }

      setCurrentStep(2);
      setStepStatus('waiting_signature');
      setStage(`Wallet approval 2 — deposit ${totalMargin} ASE margin into AsePad Vault & arm Cron`);
      const totalValue = (gasEscrow + totalMarginWei).toString();
      const initHash = await withWalletTimeout(
        client.call(address, 'init', initArgs, totalValue),
        'Initialize perp bot & deposit margin',
      );
      setTxHashes((prev) => ({ ...prev, init: initHash }));
      setStepStatus('confirming');
      saveUserTx(wallet.address, {
        hash: initHash,
        type: 'init',
        description: `Initialize ${activeContractTemplate.name} (${selectedMarket.symbol} ${side} ${lev}x, ${totalMargin} ASE margin)`,
        timestamp: Date.now(),
        status: 'pending',
        strategyAddress: address,
      });

      await assertBroadcast(initHash, 'Initialize perp bot');
      const initReceipt = await client.waitReceipt(initHash, 120_000);
      if (!initReceipt.success) {
        throw new Error('The contract was deployed, but init() reverted. Check leverage, oracle health and ASE margin.');
      }

      saveUserTx(wallet.address, {
        hash: initHash,
        type: 'init',
        description: `Initialize ${activeContractTemplate.name} & fund ${totalMargin} ASE vault margin`,
        timestamp: Date.now(),
        status: 'confirmed',
        strategyAddress: address,
      });

      saveUserStrategy({
        address,
        template: contractTemplateId,
        templateName: activeContractTemplate.name,
        poolId: selectedMarket.poolId,
        marketId: selectedMarket.id,
        tokenSymbol: selectedMarket.symbol,
        tokenAddress: selectedMarket.baseToken,
        venue: 'asepad-perps',
        executionMode: 'contract',
        side,
        leverage: lev,
        deployTxHash: deployed.txHash,
        initTxHash: initHash,
        status: 'active',
        budget: totalMargin,
        size: contractTemplateId === 'perp-dca' ? legMargin : totalMargin,
        slices,
        levels,
        threshold: contractTemplateId === 'perp-grid'
          ? String(Math.round((Number(stepPct) || 0) * 100))
          : contractTemplateId === 'perp-trigger'
            ? String(Math.round((Number(triggerMovePct) || 0) * 100))
            : momentumBps,
        interval,
        createdAt: Date.now(),
        owner: wallet.address,
      });

      setCurrentStep(3);
      setStepStatus('done');
      setStage('Perp bot is live on AsePad Perps');
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      if (/session|expired|locked/i.test(msg)) {
        setIsWalletLocked(true);
        msg = 'Your Asentum Wallet extension is locked. Unlock it in the toolbar and retry.';
      }
      setError(msg);
      setStepError(msg);
      setStepStatus('error');
      setStage('Deployment stopped');
    } finally {
      setBusy(false);
    }
  };

  const directNeedsDepositInfo = useMemo(() => {
    if (!selectedMarket) return { requiredMarginWei: 0n, shortfallWei: 0n, sizeWei: 0n, notionalWei: 0n };
    try {
      const mWei = toUnits(totalMargin, 18);
      const lev = BigInt(Math.max(1, Math.min(selectedMarket.maxLeverage, Math.round(leverage))));
      const notionalWei = mWei * lev;
      let refPriceWei = BigInt(selectedMarket.markPriceWei || '0');
      if (directKind === 'LIMIT') {
        const lWei = BigInt(numberToPerpsPriceWei(limitPrice, selectedMarket.decimals, selectedMarket.quoteDecimals));
        if (lWei > 0n) refPriceWei = lWei;
      } else if (directKind === 'STOP') {
        const tWei = BigInt(numberToPerpsPriceWei(triggerPrice, selectedMarket.decimals, selectedMarket.quoteDecimals));
        if (tWei > 0n) refPriceWei = tWei;
      } else if (directKind === 'SCALE') {
        const fWei = BigInt(numberToPerpsPriceWei(scaleFrom, selectedMarket.decimals, selectedMarket.quoteDecimals));
        const tWei = BigInt(numberToPerpsPriceWei(scaleTo, selectedMarket.decimals, selectedMarket.quoteDecimals));
        if (fWei > 0n && tWei > 0n) refPriceWei = (fWei + tWei) / 2n;
      }
      const sizeWei = calcPerpsSizeWei(notionalWei, refPriceWei);
      const requiredMarginWei = reduceOnly
        ? 0n
        : (notionalWei * BigInt(selectedMarket.initialMarginBps)) / 10_000n;
      const shortfallWei = requiredMarginWei > freeVaultWei ? requiredMarginWei - freeVaultWei : 0n;
      return { requiredMarginWei, shortfallWei, sizeWei, notionalWei };
    } catch {
      return { requiredMarginWei: 0n, shortfallWei: 0n, sizeWei: 0n, notionalWei: 0n };
    }
  }, [selectedMarket, totalMargin, leverage, directKind, limitPrice, triggerPrice, scaleFrom, scaleTo, reduceOnly, freeVaultWei]);

  const runDirectOrder = async () => {
    setError('');
    setStepError('');
    setDirectTxHash('');
    if (!(await checkWalletReady()) || !wallet.address) return;
    if (!selectedMarket) {
      setError('No live AsePad Perps market found.');
      return;
    }
    if (selectedMarket.state !== 'ACTIVE' && !(reduceOnly && selectedMarket.state === 'SUSPENDED')) {
      setError(`Market ${selectedMarket.symbol} is ${selectedMarket.state}.`);
      return;
    }

    let payload: PlacePerpsOrderPayload;
    let shortfallWei = 0n;
    try {
      const lev = Math.round(leverage);
      if (lev < 1 || lev > selectedMarket.maxLeverage) {
        throw new Error(`Leverage must be 1x–${selectedMarket.maxLeverage}x.`);
      }
      const marginWei = toUnits(totalMargin, 18);
      const notionalWei = marginWei * BigInt(lev);
      const minNotional = BigInt(selectedMarket.minOrderNotionalWei || '0');
      if (notionalWei < minNotional) {
        throw new Error(`Order notional (${weiToAse(notionalWei, 4)} ASE) is below market minimum ${weiToAse(minNotional, 4)} ASE.`);
      }

      const maxExpiryMs = Math.max(120_000, selectedMarket.orderExpiryMs - 60_000);
      const requestedMs = Math.min(directExpiryHours * 3_600_000, maxExpiryMs);
      const expiryMs = String(Date.now() + requestedMs);

      if (reduceOnly && openPosSizeWei === 0n) {
        throw new Error('Reduce-only requires an existing open position on this market.');
      }

      let refPriceWei = BigInt(selectedMarket.markPriceWei || '0');
      let limitPxWei = '0';
      let trigPxWei = '0';
      let fromWei = '0';
      let toWei = '0';
      let tpPxWei = '0';
      let slPxWei = '0';

      if (directKind === 'LIMIT') {
        limitPxWei = numberToPerpsPriceWei(limitPrice, selectedMarket.decimals, selectedMarket.quoteDecimals);
        if (limitPxWei === '0') throw new Error('Enter a valid Limit price in ASE.');
        refPriceWei = BigInt(limitPxWei);
        if (directTpPrice.trim()) {
          tpPxWei = numberToPerpsPriceWei(directTpPrice, selectedMarket.decimals, selectedMarket.quoteDecimals);
          if (tpPxWei === '0') throw new Error('Invalid Take-Profit price.');
        }
        if (directSlPrice.trim()) {
          slPxWei = numberToPerpsPriceWei(directSlPrice, selectedMarket.decimals, selectedMarket.quoteDecimals);
          if (slPxWei === '0') throw new Error('Invalid Stop-Loss price.');
        }
      } else if (directKind === 'STOP') {
        trigPxWei = numberToPerpsPriceWei(triggerPrice, selectedMarket.decimals, selectedMarket.quoteDecimals);
        if (trigPxWei === '0') throw new Error('Enter a valid Trigger price in ASE.');
        refPriceWei = BigInt(trigPxWei);
      } else if (directKind === 'SCALE') {
        fromWei = numberToPerpsPriceWei(scaleFrom, selectedMarket.decimals, selectedMarket.quoteDecimals);
        toWei = numberToPerpsPriceWei(scaleTo, selectedMarket.decimals, selectedMarket.quoteDecimals);
        if (fromWei === '0' || toWei === '0' || fromWei === toWei) {
          throw new Error('Enter distinct positive From and To prices for the scale ladder.');
        }
        const stepsNum = Math.round(Number(scaleSteps) || 0);
        if (stepsNum < 2 || stepsNum > selectedMarket.maxScaleSteps) {
          throw new Error(`Scale steps must be 2..${selectedMarket.maxScaleSteps}.`);
        }
        refPriceWei = (BigInt(fromWei) + BigInt(toWei)) / 2n;
      }

      if (refPriceWei <= 0n) throw new Error('Oracle mark price is unavailable right now.');
      const sizeWei = calcPerpsSizeWei(notionalWei, refPriceWei);
      if (sizeWei <= 0n) throw new Error('Calculated position size is zero.');

      if (directKind === 'DCA') {
        const sc = Math.round(Number(slices) || 0);
        if (sc < 2 || sc > selectedMarket.maxDcaSlices) {
          throw new Error(`AsePad Perps DCA supports 2 to ${selectedMarket.maxDcaSlices} slices.`);
        }
        const intervalMs = interval * 1000;
        if (intervalMs < selectedMarket.minDcaIntervalMs) {
          throw new Error(`Minimum DCA interval for ${selectedMarket.symbol} is ${Math.ceil(selectedMarket.minDcaIntervalMs / 60000)} minutes.`);
        }
        const optLimit = limitPrice.trim()
          ? numberToPerpsPriceWei(limitPrice, selectedMarket.decimals, selectedMarket.quoteDecimals)
          : '0';
        payload = {
          marketId: selectedMarket.id,
          kind: 'DCA',
          side,
          sizeWei: sizeWei.toString(),
          ...(optLimit !== '0' ? { limitPx: optLimit } : {}),
          slippageBps: '300',
          expiryMs,
          dcaSlices: String(sc),
          dcaIntervalMs: String(intervalMs),
        };
      } else if (directKind === 'SCALE') {
        payload = {
          marketId: selectedMarket.id,
          kind: 'SCALE',
          side,
          sizeWei: sizeWei.toString(),
          scaleFrom: fromWei,
          scaleTo: toWei,
          scaleSteps: String(Math.round(Number(scaleSteps) || 2)),
          slippageBps: '300',
          expiryMs,
        };
      } else if (directKind === 'LIMIT') {
        payload = {
          marketId: selectedMarket.id,
          kind: 'LIMIT',
          side,
          sizeWei: sizeWei.toString(),
          limitPx: limitPxWei,
          postOnly,
          reduceOnly,
          expiryMs,
          ...(tpPxWei !== '0' ? { tpPx: tpPxWei } : {}),
          ...(slPxWei !== '0' ? { slPx: slPxWei } : {}),
        };
      } else if (directKind === 'TRAIL') {
        const tb = Math.round((Number(trailPct) || 0) * 100);
        if (tb < selectedMarket.minTrailBps || tb > selectedMarket.maxTrailBps) {
          throw new Error(`Trailing distance must be ${selectedMarket.minTrailBps / 100}%–${selectedMarket.maxTrailBps / 100}%.`);
        }
        payload = {
          marketId: selectedMarket.id,
          kind: 'TRAIL',
          side,
          sizeWei: sizeWei.toString(),
          trailBps: String(tb),
          slippageBps: '300',
          reduceOnly,
          expiryMs,
        };
      } else {
        payload = {
          marketId: selectedMarket.id,
          kind: stopKind,
          side,
          sizeWei: sizeWei.toString(),
          triggerPx: trigPxWei,
          slippageBps: '300',
          reduceOnly,
          expiryMs,
        };
      }

      const requiredMargin = reduceOnly
        ? 0n
        : (notionalWei * BigInt(selectedMarket.initialMarginBps)) / 10_000n;
      shortfallWei = requiredMargin > freeVaultWei ? requiredMargin - freeVaultWei : 0n;
      // Add 1% buffer for taker/keeper fees on vault margin reservation.
      if (shortfallWei > 0n) shortfallWei = (shortfallWei * 101n) / 100n;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    setBusy(true);
    setModalOpen(true);
    setCurrentStep(shortfallWei > 0n ? 1 : 2);
    setStepStatus('waiting_signature');
    setTxHashes({});

    try {
      if (shortfallWei > 0n) {
        const depHuman = weiToAse(shortfallWei, 4);
        setStage(`Wallet approval 1 — deposit ${depHuman} ASE collateral into AsePad Vault`);
        const depHash = await withWalletTimeout(
          depositPerpsCollateral(client, selectedMarket.id, shortfallWei, selectedMarket.quoteToken),
          'Deposit AsePad Vault collateral',
        );
        setTxHashes((prev) => ({ ...prev, deposit: depHash }));
        saveUserTx(wallet.address, {
          hash: depHash,
          type: 'perps',
          description: `Deposit ${depHuman} ASE to AsePad Perps Vault (${selectedMarket.symbol})`,
          timestamp: Date.now(),
          status: 'confirmed',
        });
      }

      setCurrentStep(2);
      setStepStatus('waiting_signature');
      setStage(`Wallet approval — submit ${activeDirectBot.title} order on perps.asepad.fun`);
      const orderHash = await withWalletTimeout(
        placePerpsNativeOrder(client, payload, selectedMarket.cronDepositWei),
        'Submit AsePad Perps order',
      );
      setTxHashes((prev) => ({ ...prev, order: orderHash }));
      setDirectTxHash(orderHash);
      saveUserTx(wallet.address, {
        hash: orderHash,
        type: 'perps',
        description: `Place ${activeDirectBot.title} (${selectedMarket.symbol} ${side} ${leverage}x) on perps.asepad.fun`,
        timestamp: Date.now(),
        status: 'confirmed',
      });
      accountState.refresh();
      setCurrentStep(3);
      setStepStatus('done');
      setStage('Order active on perps.asepad.fun');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStepError(msg);
      setStepStatus('error');
      setStage('Order submission stopped');
    } finally {
      setBusy(false);
    }
  };

  const launch = () => {
    if (launchInFlightRef.current) return;
    launchInFlightRef.current = true;
    const job = perpMode === 'contract' ? runContractBotDeploy() : runDirectOrder();
    void job.finally(() => {
      launchInFlightRef.current = false;
    });
  };

  const sym = selectedMarket?.symbol ?? 'MARKET';
  const markNum = selectedMarket?.markPrice ?? 0;
  const maxLev = selectedMarket?.maxLeverage ?? 10;
  const estNotional = (Number(totalMargin) || 0) * leverage;
  const estLiq = selectedMarket && markNum > 0
    ? calcPerpsLiquidationPrice(markNum, side === 'LONG' ? 'long' : 'short', leverage, selectedMarket.maintenanceMarginBps)
    : null;

  const filteredMarkets = useMemo(() => {
    const clean = marketQuery.trim().toLowerCase();
    return markets.filter((m) =>
      !clean || m.symbol.toLowerCase().includes(clean) || m.id === clean || m.baseToken.toLowerCase().includes(clean),
    );
  }, [markets, marketQuery]);

  const intervalChips = [
    { label: '1 min', value: 60 },
    { label: '5 min', value: 300 },
    { label: '15 min', value: 900 },
    { label: '1 hour', value: 3600 },
    { label: '4 hours', value: 14400 },
  ];

  const previewTitle = perpMode === 'contract' ? activeContractBot.title : activeDirectBot.title;
  const totalModalSteps = 2;

  return (
    <>
      <div className="terminal-grid">
        <div className="terminal-card">
          <div className="perp-mode-bar" role="group" aria-label="Perps execution mode">
            <button
              type="button"
              className={perpMode === 'contract' ? 'perp-mode-btn active' : 'perp-mode-btn'}
              onClick={() => { setPerpMode('contract'); setError(''); }}
            >
              <strong>Autonomous Cron Bot (Contract)</strong>
              <small>Isolated bot contract · Cron TP/SL</small>
            </button>
            <button
              type="button"
              className={perpMode === 'direct' ? 'perp-mode-btn active' : 'perp-mode-btn'}
              onClick={() => { setPerpMode('direct'); setError(''); }}
            >
              <strong>Direct perps.asepad.fun Order</strong>
              <small>Native TWAP, Scale, Limit or Trailing on Engine</small>
            </button>
          </div>

          {perpMode === 'contract' ? (
            <div className="builder-type-grid" role="tablist" aria-label="Perp contract bot type">
              {PERP_BOT_TYPES.map((bot) => (
                <button
                  key={bot.templateId}
                  type="button"
                  role="tab"
                  aria-selected={contractTemplateId === bot.templateId}
                  className={contractTemplateId === bot.templateId ? 'builder-type-card active' : 'builder-type-card'}
                  onClick={() => { setContractTemplateId(bot.templateId); setError(''); }}
                >
                  <div className="builder-type-card-top">
                    <strong>{bot.title}</strong>
                    <span className="builder-type-tag">{bot.mark}</span>
                  </div>
                  <small>{bot.short}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="builder-type-grid" role="tablist" aria-label="Direct perps order bot type">
              {PERPS_DIRECT_BOT_TYPES.map((bot) => (
                <button
                  key={bot.kind}
                  type="button"
                  role="tab"
                  aria-selected={directKind === bot.kind}
                  className={directKind === bot.kind ? 'builder-type-card active' : 'builder-type-card'}
                  onClick={() => { setDirectKind(bot.kind); setError(''); }}
                >
                  <div className="builder-type-card-top">
                    <strong>{bot.title}</strong>
                    <span className="builder-type-tag">{bot.mark}</span>
                  </div>
                  <small>{bot.short}</small>
                </button>
              ))}
            </div>
          )}

          <div className="terminal-body">
            <div className="builder-step">
              <div className="builder-step-head">
                <span className="builder-step-title">
                  <span className="builder-step-num">1</span>
                  Market &amp; Margin
                </span>
                <span className="field-help">
                  {perpMode === 'contract' ? activeContractBot.blurb : activeDirectBot.blurb}
                </span>
              </div>

              <div className="token-row">
                <button type="button" className="token-select" onClick={() => setMarketModalOpen(true)} aria-haspopup="dialog">
                  <span className="token-badge" aria-hidden="true">{sym.slice(0, 1)}</span>
                  <span className="token-select-main">
                    <strong>{sym} / ASE Perp</strong>
                    <small>
                      {selectedMarket
                        ? `market #${selectedMarket.id} · max ${selectedMarket.maxLeverage}x · ${selectedMarket.oracleSource} oracle`
                        : marketsState.loading ? 'Loading AsePad Perps markets…' : 'No active perp market'}
                    </small>
                  </span>
                  <span className="token-price">
                    {selectedMarket ? `Mark ${toPlainDecimal(markNum, 8) || '0'} ASE` : '—'}
                  </span>
                  <span className="token-chevron" aria-hidden="true">▾</span>
                </button>
                <a className="btn btn-ghost btn-sm" href={PERPS_APP_URL} target="_blank" rel="noreferrer">
                  perps.asepad.fun ↗
                </a>
              </div>

              {perpMode === 'direct' && wallet.connected && selectedMarket && (
                <div className="perp-vault-strip">
                  <span>
                    <span className="dim">AsePad Vault free margin:</span>{' '}
                    <strong className="mono">{freeVaultFmt} ASE</strong>
                    {openPosSizeWei !== 0n && (
                      <span className="dim" style={{ marginLeft: 10 }}>
                        · Open pos:{' '}
                        <strong className={openPosSizeWei > 0n ? 'up mono' : 'down mono'}>
                          {openPosSizeWei > 0n ? 'LONG' : 'SHORT'} {weiToAse(openPosSizeWei < 0n ? -openPosSizeWei : openPosSizeWei, 2)} {sym}
                        </strong>
                      </span>
                    )}
                  </span>
                  {!reduceOnly && directNeedsDepositInfo.shortfallWei > 0n && (
                    <span className="mono" style={{ color: 'var(--warn)', fontSize: 13 }}>
                      Auto-deposits +{weiToAse(directNeedsDepositInfo.shortfallWei, 4)} ASE before order
                    </span>
                  )}
                </div>
              )}

              <div className="param-grid">
                <div className="field" style={{ marginTop: 0 }}>
                  <label>Direction</label>
                  <div className="perp-side-grid" role="group" aria-label="Position direction">
                    <button
                      type="button"
                      className={side === 'LONG' ? 'perp-side-btn long active' : 'perp-side-btn long'}
                      onClick={() => setSide('LONG')}
                    >
                      Long ↑
                    </button>
                    <button
                      type="button"
                      className={side === 'SHORT' ? 'perp-side-btn short active' : 'perp-side-btn short'}
                      onClick={() => setSide('SHORT')}
                    >
                      Short ↓
                    </button>
                  </div>
                </div>

                <div className="field" style={{ marginTop: 0 }}>
                  <label>Leverage · max {maxLev}x</label>
                  <div className="chip-row">
                    {[1, 2, 3, 5, 10].filter((x) => x <= maxLev).map((x) => (
                      <button
                        key={x}
                        type="button"
                        className={leverage === x ? 'chip-btn active' : 'chip-btn'}
                        onClick={() => setLeverage(x)}
                      >
                        {x}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="amount-field">
                <div className="amount-field-head">
                  <label htmlFor="perpTotalMargin">
                    {perpMode === 'contract'
                      ? (contractTemplateId === 'perp-dca' || contractTemplateId === 'perp-grid' || contractTemplateId === 'perp-twap'
                        ? 'Total ASE margin budget'
                        : 'ASE margin allocation')
                      : (reduceOnly ? 'Position size equivalent (ASE margin)' : 'Margin allocation · ASE')}
                  </label>
                  <span className="field-help">Wallet: {aseBalanceFmt} ASE</span>
                </div>
                <div className="amount-input">
                  <input
                    id="perpTotalMargin"
                    value={totalMargin}
                    onChange={(e) => setTotalMargin(e.target.value)}
                    inputMode="decimal"
                  />
                  <span className="amount-unit">ASE</span>
                </div>
                <div className="pct-row">
                  <button type="button" className="pct-btn" onClick={() => applyMarginPct(0.25)}>25%</button>
                  <button type="button" className="pct-btn" onClick={() => applyMarginPct(0.5)}>50%</button>
                  <button type="button" className="pct-btn" onClick={() => applyMarginPct(0.75)}>75%</button>
                  <button type="button" className="pct-btn" onClick={() => applyMarginPct(1)}>MAX</button>
                </div>
                <p className="field-help mono" style={{ marginTop: 6 }}>
                  Notional exposure: {fmtNum(Number(estNotional.toFixed(4)))} ASE
                  {selectedMarket ? ` · min ${weiToAse(selectedMarket.minOrderNotionalWei, 2)} ASE` : ''}
                </p>
              </div>
            </div>

            <div className="builder-step">
              <div className="builder-step-head">
                <span className="builder-step-title">
                  <span className="builder-step-num">2</span>
                  Strategy Rules
                </span>
              </div>

            {perpMode === 'contract' && contractTemplateId === 'perp-dca' && (
              <>
                <div className="param-grid">
                  <div className="field" style={{ marginTop: 0 }}>
                    <label htmlFor="perpLegMargin">Margin per leg · ASE</label>
                    <input id="perpLegMargin" className="input" value={legMargin} onChange={(e) => setLegMargin(e.target.value)} inputMode="decimal" />
                  </div>
                  <div className="field" style={{ marginTop: 0 }}>
                    <label>Execution frequency</label>
                    <div className="chip-row">
                      {intervalChips.map((chip) => (
                        <button key={chip.value} type="button" className={interval === chip.value ? 'chip-btn active' : 'chip-btn'} onClick={() => setInterval(chip.value)}>
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <details className="soft-details">
                  <summary>Advanced settings · TP / SL &amp; custom interval</summary>
                  <div className="soft-details-body" style={{ display: 'grid', gap: 14 }}>
                    <div className="param-grid">
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="perpDcaTp">Take-Profit % (0 = off)</label>
                        <input id="perpDcaTp" className="input" value={tpPct} onChange={(e) => setTpPct(e.target.value)} inputMode="decimal" />
                      </div>
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="perpDcaSl">Stop-Loss % (0 = off)</label>
                        <input id="perpDcaSl" className="input" value={slPct} onChange={(e) => setSlPct(e.target.value)} inputMode="decimal" />
                      </div>
                    </div>
                    <div className="field" style={{ marginTop: 0 }}>
                      <label htmlFor="perpDcaInterval">Custom interval · seconds</label>
                      <input id="perpDcaInterval" className="input" type="number" min={60} max={86400} value={interval} onChange={(e) => setInterval(Number(e.target.value))} />
                    </div>
                  </div>
                </details>
              </>
            )}

            {perpMode === 'contract' && contractTemplateId === 'perp-trigger' && (
              <>
                <div className="param-grid">
                  <div className="field" style={{ marginTop: 0 }}>
                    <label>Trigger condition</label>
                    <div className="chip-row">
                      <button type="button" className={triggerDir === 'below' ? 'chip-btn active' : 'chip-btn'} onClick={() => setTriggerDir('below')}>
                        Drop below (-%)
                      </button>
                      <button type="button" className={triggerDir === 'above' ? 'chip-btn active' : 'chip-btn'} onClick={() => setTriggerDir('above')}>
                        Break above (+%)
                      </button>
                    </div>
                  </div>
                  <div className="field" style={{ marginTop: 0 }}>
                    <label htmlFor="perpTrigMove">Move from current mark · %</label>
                    <input id="perpTrigMove" className="input" value={triggerMovePct} onChange={(e) => setTriggerMovePct(e.target.value)} inputMode="decimal" />
                  </div>
                </div>
                <details className="soft-details">
                  <summary>Advanced settings · TP / SL &amp; check interval</summary>
                  <div className="soft-details-body" style={{ display: 'grid', gap: 14 }}>
                    <div className="param-grid">
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="perpTrigTp">Take-Profit % (0 = off)</label>
                        <input id="perpTrigTp" className="input" value={tpPct} onChange={(e) => setTpPct(e.target.value)} inputMode="decimal" />
                      </div>
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="perpTrigSl">Stop-Loss % (0 = off)</label>
                        <input id="perpTrigSl" className="input" value={slPct} onChange={(e) => setSlPct(e.target.value)} inputMode="decimal" />
                      </div>
                    </div>
                    <div className="chip-row">
                      {intervalChips.map((chip) => (
                        <button key={chip.value} type="button" className={interval === chip.value ? 'chip-btn active' : 'chip-btn'} onClick={() => setInterval(chip.value)}>
                          Check {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </details>
              </>
            )}

            {perpMode === 'contract' && contractTemplateId === 'perp-grid' && (
              <>
                <div className="param-grid">
                  <div className="field" style={{ marginTop: 0 }}>
                    <label>Grid step</label>
                    <div className="chip-row">
                      {['1', '2', '3', '5'].map((pct) => (
                        <button key={pct} type="button" className={stepPct === pct ? 'chip-btn active' : 'chip-btn'} onClick={() => setStepPct(pct)}>
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field" style={{ marginTop: 0 }}>
                    <label>Grid levels</label>
                    <div className="chip-row">
                      {['3', '5', '8', '10'].map((lv) => (
                        <button key={lv} type="button" className={levels === lv ? 'chip-btn active' : 'chip-btn'} onClick={() => setLevels(lv)}>
                          {lv}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="chip-row">
                  {intervalChips.map((chip) => (
                    <button key={chip.value} type="button" className={interval === chip.value ? 'chip-btn active' : 'chip-btn'} onClick={() => setInterval(chip.value)}>
                      Check {chip.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {perpMode === 'contract' && contractTemplateId === 'perp-risk' && (
              <>
                <div className="param-grid">
                  <div className="field" style={{ marginTop: 0 }}>
                    <label htmlFor="perpRiskSl">Stop-Loss %</label>
                    <input id="perpRiskSl" className="input" value={slPct} onChange={(e) => setSlPct(e.target.value)} inputMode="decimal" />
                  </div>
                  <div className="field" style={{ marginTop: 0 }}>
                    <label htmlFor="perpRiskTp">Take-Profit %</label>
                    <input id="perpRiskTp" className="input" value={tpPct} onChange={(e) => setTpPct(e.target.value)} inputMode="decimal" />
                  </div>
                </div>
                <div className="param-grid">
                  <div className="field" style={{ marginTop: 0 }}>
                    <label htmlFor="perpRiskDd">Trailing Drawdown %</label>
                    <input id="perpRiskDd" className="input" value={drawdownPct} onChange={(e) => setDrawdownPct(e.target.value)} inputMode="decimal" />
                  </div>
                  <div className="field" style={{ marginTop: 0 }}>
                    <label>Guard cadence</label>
                    <div className="chip-row">
                      {intervalChips.slice(0, 3).map((chip) => (
                        <button key={chip.value} type="button" className={interval === chip.value ? 'chip-btn active' : 'chip-btn'} onClick={() => setInterval(chip.value)}>
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {perpMode === 'contract' && contractTemplateId === 'perp-momentum' && (
              <>
                <div className="field" style={{ marginTop: 0 }}>
                  <label>TWAP move threshold</label>
                  <div className="chip-row">
                    {[100, 250, 500, 1000].map((bps) => (
                      <button
                        key={bps}
                        type="button"
                        className={Number(momentumBps) === bps ? 'chip-btn active' : 'chip-btn'}
                        onClick={() => setMomentumBps(String(bps))}
                      >
                        {bps / 100}%
                      </button>
                    ))}
                  </div>
                </div>
                <details className="soft-details">
                  <summary>Advanced settings · custom bps &amp; interval</summary>
                  <div className="soft-details-body">
                    <div className="param-grid">
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="perpMomentumThreshold">TWAP threshold · bps</label>
                        <input
                          id="perpMomentumThreshold"
                          className="input"
                          type="number"
                          min={1}
                          max={10000}
                          value={momentumBps}
                          onChange={(e) => setMomentumBps(e.target.value)}
                        />
                      </div>
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="perpMomentumInterval">Check every · seconds</label>
                        <input
                          id="perpMomentumInterval"
                          className="input"
                          type="number"
                          min={60}
                          max={86400}
                          value={interval}
                          onChange={(e) => setInterval(Number(e.target.value))}
                        />
                      </div>
                    </div>
                  </div>
                </details>
              </>
            )}

            {perpMode === 'contract' && contractTemplateId === 'perp-twap' && (
              <>
                <div className="param-grid">
                  <div className="field" style={{ marginTop: 0 }}>
                    <label>Slices</label>
                    <div className="chip-row">
                      {['3', '5', '10', '20'].map((cnt) => (
                        <button key={cnt} type="button" className={slices === cnt ? 'chip-btn active' : 'chip-btn'} onClick={() => setSlices(cnt)}>
                          {cnt}
                        </button>
                      ))}
                    </div>
                  </div>
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
                </div>
                <details className="soft-details">
                  <summary>Advanced settings · custom slice count</summary>
                  <div className="soft-details-body">
                    <div className="field" style={{ marginTop: 0 }}>
                      <label htmlFor="perpTwapCustomSlices">Custom slice count (2–100)</label>
                      <input id="perpTwapCustomSlices" className="input" type="number" min={2} max={100} value={slices} onChange={(e) => setSlices(e.target.value)} />
                    </div>
                  </div>
                </details>
              </>
            )}

            {perpMode === 'direct' && directKind === 'DCA' && (
              <>
                <div className="param-grid">
                  <div className="field" style={{ marginTop: 0 }}>
                    <label htmlFor="dirDcaSlices">Keeper slices (2–{selectedMarket?.maxDcaSlices ?? 12})</label>
                    <input id="dirDcaSlices" className="input" type="number" min={2} max={selectedMarket?.maxDcaSlices ?? 12} value={slices} onChange={(e) => setSlices(e.target.value)} />
                  </div>
                  <div className="field" style={{ marginTop: 0 }}>
                    <label>Slice interval</label>
                    <div className="chip-row">
                      {[300, 900, 3600].filter((sec) => !selectedMarket || sec * 1000 >= selectedMarket.minDcaIntervalMs).map((sec) => (
                        <button key={sec} type="button" className={interval === sec ? 'chip-btn active' : 'chip-btn'} onClick={() => setInterval(sec)}>
                          {intervalLabel(sec)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="field" style={{ marginTop: 0 }}>
                  <label htmlFor="dirDcaLimit">Optional limit price cap · ASE (blank = market)</label>
                  <input id="dirDcaLimit" className="input" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder="Optional max buy / min short price" inputMode="decimal" />
                </div>
              </>
            )}

            {perpMode === 'direct' && directKind === 'SCALE' && (
              <div className="param-grid">
                <div className="field" style={{ marginTop: 0 }}>
                  <label htmlFor="dirScaleFrom">From price · ASE</label>
                  <input id="dirScaleFrom" className="input" value={scaleFrom} onChange={(e) => setScaleFrom(e.target.value)} inputMode="decimal" />
                </div>
                <div className="field" style={{ marginTop: 0 }}>
                  <label htmlFor="dirScaleTo">To price · ASE</label>
                  <input id="dirScaleTo" className="input" value={scaleTo} onChange={(e) => setScaleTo(e.target.value)} inputMode="decimal" />
                </div>
                <div className="field" style={{ marginTop: 0 }}>
                  <label htmlFor="dirScaleSteps">Ladder steps (2–{selectedMarket?.maxScaleSteps ?? 16})</label>
                  <input id="dirScaleSteps" className="input" type="number" min={2} max={selectedMarket?.maxScaleSteps ?? 16} value={scaleSteps} onChange={(e) => setScaleSteps(e.target.value)} />
                </div>
              </div>
            )}

            {perpMode === 'direct' && directKind === 'LIMIT' && (
              <>
                <div className="param-grid">
                  <div className="field" style={{ marginTop: 0 }}>
                    <label htmlFor="dirLimitPx">Limit price · ASE</label>
                    <input id="dirLimitPx" className="input" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} inputMode="decimal" />
                  </div>
                  <div className="field" style={{ marginTop: 0 }}>
                    <label htmlFor="dirLimitExp">Expiry</label>
                    <select id="dirLimitExp" className="input" value={directExpiryHours} onChange={(e) => setDirectExpiryHours(Number(e.target.value))}>
                      <option value={1}>1 hour</option>
                      <option value={4}>4 hours</option>
                      <option value={12}>12 hours</option>
                      <option value={24}>24 hours</option>
                    </select>
                  </div>
                </div>
                <details className="soft-details">
                  <summary>Advanced settings · attached TP/SL &amp; order flags</summary>
                  <div className="soft-details-body" style={{ display: 'grid', gap: 14 }}>
                    <div className="param-grid">
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="dirLimitTp">Attached Take-Profit · ASE</label>
                        <input id="dirLimitTp" className="input" value={directTpPrice} onChange={(e) => setDirectTpPrice(e.target.value)} placeholder="Optional" inputMode="decimal" />
                      </div>
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="dirLimitSl">Attached Stop-Loss · ASE</label>
                        <input id="dirLimitSl" className="input" value={directSlPrice} onChange={(e) => setDirectSlPrice(e.target.value)} placeholder="Optional" inputMode="decimal" />
                      </div>
                    </div>
                    <div className="chip-row">
                      <button type="button" className={postOnly ? 'chip-btn active' : 'chip-btn'} onClick={() => setPostOnly((v) => !v)}>
                        {postOnly ? '✓ Post-Only' : 'Post-Only'}
                      </button>
                      <button
                        type="button"
                        className={reduceOnly ? 'chip-btn active' : 'chip-btn'}
                        onClick={() => {
                          const next = !reduceOnly;
                          setReduceOnly(next);
                          if (next && openPosSizeWei !== 0n) setSide(openPosSizeWei > 0n ? 'SHORT' : 'LONG');
                        }}
                      >
                        {reduceOnly ? '✓ Reduce-Only' : 'Reduce-Only'}
                      </button>
                    </div>
                  </div>
                </details>
              </>
            )}

            {perpMode === 'direct' && directKind === 'TRAIL' && (
              <div className="param-grid">
                <div className="field" style={{ marginTop: 0 }}>
                  <label htmlFor="dirTrailPct">
                    Trailing distance · % ({(selectedMarket?.minTrailBps ?? 10) / 100}%–{(selectedMarket?.maxTrailBps ?? 2000) / 100}%)
                  </label>
                  <input id="dirTrailPct" className="input" value={trailPct} onChange={(e) => setTrailPct(e.target.value)} inputMode="decimal" />
                </div>
                <div className="field" style={{ marginTop: 0 }}>
                  <label>Execution mode</label>
                  <div className="chip-row">
                    <button
                      type="button"
                      className={reduceOnly ? 'chip-btn active' : 'chip-btn'}
                      onClick={() => {
                        const next = !reduceOnly;
                        setReduceOnly(next);
                        if (next && openPosSizeWei !== 0n) setSide(openPosSizeWei > 0n ? 'SHORT' : 'LONG');
                      }}
                    >
                      {reduceOnly ? '✓ Reduce-Only Exit' : 'Open / Reverse'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {perpMode === 'direct' && directKind === 'STOP' && (
              <>
                <div className="param-grid">
                  <div className="field" style={{ marginTop: 0 }}>
                    <label>Trigger kind</label>
                    <div className="chip-row">
                      <button type="button" className={stopKind === 'STOP' ? 'chip-btn active' : 'chip-btn'} onClick={() => setStopKind('STOP')}>Stop Trigger</button>
                      <button type="button" className={stopKind === 'TP' ? 'chip-btn active' : 'chip-btn'} onClick={() => setStopKind('TP')}>Take-Profit Trigger</button>
                    </div>
                  </div>
                  <div className="field" style={{ marginTop: 0 }}>
                    <label htmlFor="dirTrigPx">Trigger mark price · ASE</label>
                    <input id="dirTrigPx" className="input" value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} inputMode="decimal" />
                  </div>
                </div>
                <div className="chip-row">
                  <button
                    type="button"
                    className={reduceOnly ? 'chip-btn active' : 'chip-btn'}
                    onClick={() => {
                      const next = !reduceOnly;
                      setReduceOnly(next);
                      if (next && openPosSizeWei !== 0n) setSide(openPosSizeWei > 0n ? 'SHORT' : 'LONG');
                    }}
                  >
                    {reduceOnly ? '✓ Reduce-Only' : 'Reduce-Only'}
                  </button>
                </div>
              </>
            )}
            </div>

            {perpMode === 'contract' && (
              <div className="terminal-note">
                <span>Cron gas escrow (unused returned on stop)</span>
                <strong className="mono">~{PERP_CRON_ESCROW} ASE</strong>
              </div>
            )}

            {isWalletLocked && (
              <div className="compact-alert">
                <div>
                  <strong>Asentum Wallet is locked.</strong>{' '}
                  <span>Unlock the browser extension to launch.</span>
                </div>
              </div>
            )}

            <button
              className="btn btn-primary launch-btn"
              type="button"
              onClick={launch}
              disabled={busy || !selectedMarket || isWalletLocked}
            >
              {busy
                ? 'Submitting…'
                : !wallet.connected
                  ? 'Connect wallet to launch'
                  : isWalletLocked
                    ? 'Unlock wallet to launch'
                    : perpMode === 'contract'
                      ? `Launch ${activeContractBot.title} (${sym} ${side} ${leverage}x)`
                      : `Place ${activeDirectBot.title} on perps.asepad.fun`}
            </button>

            {stage && <div className="deploy-stage" role="status">{stage}</div>}
            {error && <div className="notice deploy-error" role="alert">{error}</div>}
            {resultWarning && <div className="notice deploy-warning">{resultWarning}</div>}
            {resultAddress && (
              <div className="deploy-result">
                <div className="live-dot">Perp bot contract deployed</div>
                <Link className="mono" to={`/strategies/${resultAddress}`}>{toAse1(resultAddress)}</Link>
                <div className="muted">Isolated AsePad Perps Vault collateral funded and Cron armed. Manage or close anytime from Portfolio.</div>
              </div>
            )}
            {directTxHash && (
              <div className="deploy-result">
                <div className="live-dot">Order live on perps.asepad.fun</div>
                <a className="mono" href={explorerTxUrl(directTxHash)} target="_blank" rel="noreferrer">{directTxHash}</a>
                <div className="muted">
                  Manage open orders in <Link to={`/advanced?venue=perps&market=${selectedMarket?.id ?? '1'}`}>Strata Perps Terminal</Link> or on{' '}
                  <a href={PERPS_APP_URL} target="_blank" rel="noreferrer">perps.asepad.fun ↗</a>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="terminal-side">
          <div className="seg-tabs" style={{ marginTop: 0, width: '100%' }} role="tablist" aria-label="Perp strategy preview mode">
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'summary'}
              className={sideTab === 'summary' ? 'seg-tab active' : 'seg-tab'}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setSideTab('summary')}
            >
              Execution Plan
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
                <span className="label">Execution plan</span>
                <span className="pill pill-live">{previewTitle}</span>
              </div>
              <div className="panel-body">
                <p className="preview-lead">
                  {perpMode === 'contract'
                    ? `Deploys an isolated contract holding ${totalMargin || '0'} ASE margin on ${sym}/ASE (${side} ${leverage}x) on AsePad Perps.`
                    : `Places a native ${activeDirectBot.title} order (${side} ${leverage}x, ${totalMargin || '0'} ASE margin) directly on your perps.asepad.fun vault account.`}
                </p>
                <div className="preview-fact"><span>Venue</span><strong>AsePad Perps</strong></div>
                <div className="preview-fact"><span>Market</span><strong>{sym} / ASE (#{selectedMarket?.id ?? '—'})</strong></div>
                <div className="preview-fact"><span>Direction &amp; Lev</span><strong className={side === 'LONG' ? 'up' : 'down'}>{side} · {leverage}x</strong></div>
                <div className="preview-fact"><span>Margin / Notional</span><strong>{totalMargin || '0'} ASE → {fmtNum(Number(estNotional.toFixed(3)))} ASE</strong></div>
                <div className="preview-fact">
                  <span>
                    Est. Liq price
                    <InfoTip
                      label="Liquidation estimate"
                      text="Approximate TWAP oracle mark price where maintenance margin is exhausted. Actual liquidation depends on funding accrual and market maintenance margin."
                    />
                  </span>
                  <strong>{estLiq !== null ? `${toPlainDecimal(estLiq, 8)} ASE` : '—'}</strong>
                </div>
                <div className="preview-fact"><span>Taker / Keeper fee</span><strong>{selectedMarket ? `${selectedMarket.takerFeeBps} / ${selectedMarket.keeperFeeBps} bps` : '—'}</strong></div>
                {perpMode === 'contract' && (
                  <div className="preview-fact"><span>Cron escrow</span><strong>{PERP_CRON_ESCROW} ASE</strong></div>
                )}
                <div className="safety-line">
                  <span className="safety-icon" aria-hidden="true">✓</span>
                  <span>
                    {perpMode === 'contract'
                      ? 'Non-custodial contract you own. Stop closes open positions and returns ASE to your wallet.'
                      : 'Direct wallet order on AsePad Perps Engine. Cancel or withdraw free collateral anytime.'}
                  </span>
                </div>
                <details className="soft-details" style={{ marginTop: 6 }}>
                  <summary>Margin, oracle &amp; terminal link</summary>
                  <div className="soft-details-body">
                    <p style={{ margin: 0 }}>
                      AsePad Perps uses an isolated margin vault, TWAP oracle mark prices, funding indices and keeper/cron execution. Review liquidation distance before signing.
                    </p>
                    <Link className="link-arrow" to={`/advanced?venue=perps&market=${selectedMarket?.id ?? '1'}`} style={{ display: 'inline-flex', marginTop: 10 }}>
                      Open Perps Terminal →
                    </Link>
                  </div>
                </details>
              </div>
            </div>
          ) : (
            <StrategyPreviewPanel
              mode="perps"
              market={selectedMarket}
              params={{
                mode: perpMode,
                templateId: contractTemplateId,
                directKind,
                markPrice: markNum,
                side,
                leverage,
                totalMargin: Number(totalMargin) || 0,
                legMargin: Number(legMargin) || 0,
                intervalSec: interval,
                tpPct: Number(tpPct) || 0,
                slPct: Number(slPct) || 0,
                drawdownPct: Number(drawdownPct) || 0,
                stepPct: Number(stepPct) || 0,
                levels: Number(levels) || 5,
                slices: Number(slices) || 4,
                triggerDir,
                triggerMovePct: Number(triggerMovePct) || 0,
                momentumBps: Number(momentumBps) || 0,
                liqPrice: estLiq,
                limitPrice: Number(limitPrice) || undefined,
                scaleFrom: Number(scaleFrom) || undefined,
                scaleTo: Number(scaleTo) || undefined,
                scaleSteps: Number(scaleSteps) || undefined,
                trailPct: Number(trailPct) || undefined,
                triggerPrice: Number(triggerPrice) || undefined,
                takerFeeBps: selectedMarket?.takerFeeBps,
              }}
            />
          )}
        </aside>
      </div>

      {marketModalOpen && (
        <div className="deploy-modal-backdrop" role="dialog" aria-modal="true" aria-label="Select Perp market">
          <div className="deploy-modal token-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Select AsePad Perps Market</h3>
              <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 16 }} onClick={() => setMarketModalOpen(false)}>✕</button>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              Live markets read directly from AsePad Perps Contracts ({shortAddr(PERPS_CFG)}).
            </p>
            <div className="token-search">
              <input
                className="input"
                value={marketQuery}
                onChange={(e) => setMarketQuery(e.target.value)}
                placeholder="Search by symbol, ID or token address"
              />
            </div>
            <div className="token-list">
              {filteredMarkets.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={m.id === selectedMarket?.id ? 'token-row-btn active' : 'token-row-btn'}
                  onClick={() => selectMarket(m)}
                >
                  <span className="token-badge" aria-hidden="true">{m.symbol.slice(0, 1)}</span>
                  <span className="token-select-main">
                    <strong>{m.symbol} / ASE</strong>
                    <small>#{m.id} · max {m.maxLeverage}x · OI {fmtNum(Number(m.openInterest.toFixed(1)))} ASE · {m.state}</small>
                  </span>
                  <span className="token-price">
                    {toPlainDecimal(m.markPrice, 8) || '0'} ASE
                    <br />
                    <small>{m.oracleSource}</small>
                  </span>
                </button>
              ))}
              {filteredMarkets.length === 0 && <p className="muted" style={{ padding: '12px 8px' }}>No perp market matches that search.</p>}
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="deploy-modal-backdrop" role="dialog" aria-modal="true">
          <div className="deploy-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>
                {currentStep > totalModalSteps
                  ? (perpMode === 'contract' ? 'Perp bot is live' : 'Perps order active')
                  : `Launching ${previewTitle}`}
              </h3>
              {(!busy || currentStep > totalModalSteps || stepStatus === 'error') && (
                <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 16 }} onClick={() => setModalOpen(false)}>✕</button>
              )}
            </div>

            <div className="stepper-list">
              {perpMode === 'contract' ? (
                <>
                  <div className={`stepper-item ${currentStep === 1 ? 'active' : currentStep > 1 ? 'done' : ''}`}>
                    <div className={`stepper-icon ${currentStep > 1 ? 'done' : currentStep === 1 ? (stepStatus === 'error' ? 'error' : 'active') : 'pending'}`}>
                      {currentStep > 1 ? '✓' : '1'}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <strong>1. Deploy perp bot contract</strong>
                        {txHashes.deploy && <a href={explorerTxUrl(txHashes.deploy)} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--accent)' }}>Tx ↗</a>}
                      </div>
                      <div className="muted" style={{ fontSize: 13 }}>{resultAddress ? `Deployed at ${shortAddr(resultAddress)}` : 'Confirm deployment in your wallet…'}</div>
                    </div>
                  </div>
                  <div className={`stepper-item ${currentStep === 2 ? 'active' : currentStep > 2 ? 'done' : ''}`}>
                    <div className={`stepper-icon ${currentStep > 2 ? 'done' : currentStep === 2 ? (stepStatus === 'error' ? 'error' : 'active') : 'pending'}`}>
                      {currentStep > 2 ? '✓' : '2'}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <strong>2. Fund Vault margin &amp; arm Cron</strong>
                        {txHashes.init && <a href={explorerTxUrl(txHashes.init)} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--accent)' }}>Tx ↗</a>}
                      </div>
                      <div className="muted" style={{ fontSize: 13 }}>{totalMargin} ASE margin + {PERP_CRON_ESCROW} ASE cron escrow</div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {directNeedsDepositInfo.shortfallWei > 0n && (
                    <div className={`stepper-item ${currentStep === 1 ? 'active' : currentStep > 1 ? 'done' : ''}`}>
                      <div className={`stepper-icon ${currentStep > 1 ? 'done' : currentStep === 1 ? (stepStatus === 'error' ? 'error' : 'active') : 'pending'}`}>
                        {currentStep > 1 ? '✓' : '1'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <strong>Deposit collateral to AsePad Vault</strong>
                          {txHashes.deposit && <a href={explorerTxUrl(txHashes.deposit)} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--accent)' }}>Tx ↗</a>}
                        </div>
                        <div className="muted" style={{ fontSize: 13 }}>Funding margin deficit before submitting order…</div>
                      </div>
                    </div>
                  )}
                  <div className={`stepper-item ${currentStep === 2 ? 'active' : currentStep > 2 ? 'done' : ''}`}>
                    <div className={`stepper-icon ${currentStep > 2 ? 'done' : currentStep === 2 ? (stepStatus === 'error' ? 'error' : 'active') : 'pending'}`}>
                      {currentStep > 2 ? '✓' : '✓'}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <strong>Submit order on perps.asepad.fun</strong>
                        {txHashes.order && <a href={explorerTxUrl(txHashes.order)} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--accent)' }}>Tx ↗</a>}
                      </div>
                      <div className="muted" style={{ fontSize: 13 }}>{sym} {side} {leverage}x · {activeDirectBot.title}</div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {stepError && (
              <div className="notice" style={{ borderColor: 'var(--down)', background: 'var(--down-soft)', marginBottom: 14 }}>
                <strong style={{ color: 'var(--down)' }}>Transaction halted:</strong>
                <p style={{ margin: '4px 0 0', fontSize: 13 }}>{stepError}</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              {currentStep > totalModalSteps ? (
                <>
                  <Link to="/portfolio" className="btn btn-ghost" onClick={() => setModalOpen(false)}>View in Portfolio</Link>
                  {resultAddress ? (
                    <Link to={`/strategies/${resultAddress}`} className="btn btn-primary" onClick={() => setModalOpen(false)}>Manage bot ↗</Link>
                  ) : (
                    <Link to={`/advanced?venue=perps&market=${selectedMarket?.id ?? '1'}`} className="btn btn-primary" onClick={() => setModalOpen(false)}>Open Perps Terminal ↗</Link>
                  )}
                </>
              ) : stepStatus === 'error' ? (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>Close</button>
                  <button type="button" className="btn btn-primary" onClick={launch}>Retry</button>
                </>
              ) : (
                <button type="button" className="btn btn-ghost" disabled>Waiting for wallet / network…</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
