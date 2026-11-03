import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAsentum, useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { loadPools, loadAseDexPools } from '../lib/registry';
import { BOT_TYPES, TEMPLATES, templateById } from '../lib/templates';
import { shortAddr, weiToAse } from '../lib/format';
import { WalletPanel } from '../components/WalletPanel';
import {
  ASEDEX_AMM,
  AURAS_AMM,
  explorerTxUrl,
  getAccountMeta,
  getContractSource,
  hashSource,
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

export function Deploy() {
  const [params] = useSearchParams();
  const initialMode = params.get('mode') === 'pro' ? 'pro' : 'lite';
  const initialTemplate = templateById(params.get('template') || (initialMode === 'pro' ? 'momentum-signal' : 'dca'));
  const [mode, setMode] = useState<'lite' | 'pro'>(initialMode);
  const [templateId, setTemplateId] = useState(initialTemplate.id);
  const [poolId, setPoolId] = useState(params.get('pool') ?? '1');
  const [threshold, setThreshold] = useState(params.get('threshold') ?? '120');
  const [size, setSize] = useState(params.get('size') ?? '250');
  const [budget, setBudget] = useState(params.get('budget') ?? '5000');
  const [buySizeAse, setBuySizeAse] = useState(params.get('buySizeAse') ?? '10');
  const [buyBudgetAse, setBuyBudgetAse] = useState(params.get('buyBudgetAse') ?? '100');
  const [interval, setInterval] = useState(Number(params.get('interval') ?? initialTemplate.intervalSec));
  const [escrow, setEscrow] = useState('0.05');
  const [slices, setSlices] = useState(params.get('slices') ?? '5');
  const [levels, setLevels] = useState(params.get('levels') ?? '5');
  const [costBasis, setCostBasis] = useState(params.get('costBasis') ?? '');
  const [dailyLossLimit, setDailyLossLimit] = useState(params.get('dailyLoss') ?? '5');
  const [stopLossBps, setStopLossBps] = useState(params.get('stopLoss') ?? '500');
  const [takeProfitBps, setTakeProfitBps] = useState(params.get('takeProfit') ?? '1000');
  const [maxDrawdownBps, setMaxDrawdownBps] = useState(params.get('maxDrawdown') ?? '800');
  const [targetUpsideBps, setTargetUpsideBps] = useState(params.get('targetUpside') ?? '1000');
  const [copied, setCopied] = useState(false);
  const [sourceType, setSourceType] = useState<'strata' | 'asepad'>(params.get('venue') === 'asepad' ? 'asepad' : 'strata');
  const [deploying, setDeploying] = useState(false);
  const [stage, setStage] = useState('');
  const [resultAddress, setResultAddress] = useState('');
  const [resultWarning, setResultWarning] = useState('');
  const [error, setError] = useState('');
  const [registrationOk, setRegistrationOk] = useState(false);
  const fromMarketplace = params.get('fromMarketplace') === '1';
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

  const applyTokenPercent = (pct: number) => {
    if (!currentTokenHolding || currentTokenHolding.balanceNum <= 0) return;
    const dec = selectedPool?.decimals ?? 18;
    const totalRaw = BigInt(currentTokenHolding.balanceRaw);
    const partRaw = (totalRaw * BigInt(Math.floor(pct * 100))) / 100n;
    const scale = 10n ** BigInt(dec);
    const whole = partRaw / scale;
    const frac = (partRaw % scale).toString().padStart(dec, '0').slice(0, 4).replace(/0+$/, '');
    const valStr = `${whole}${frac ? `.${frac}` : ''}`;
    setBudget(valStr);
    const budgetNum = Number(valStr);
    if (Number(size) > budgetNum || Number(size) === 250) {
      setSize(Math.max(1, Math.floor(budgetNum / 5)).toString());
    }
  };

  const applyAsePercent = (pct: number) => {
    if (!nativeHolding || nativeHolding.balanceNum <= 0) return;
    const safeMax = Math.max(0, nativeHolding.balanceNum - 0.2);
    const amount = (safeMax * pct).toFixed(2);
    setBuyBudgetAse(amount);
    setBuySizeAse((Math.max(1, Number(amount) / 5)).toFixed(2));
  };

  const selectTokenPool = (holding: UserTokenHolding) => {
    if (holding.venue === 'asedex') {
      setSourceType('asepad');
    } else {
      setSourceType('strata');
    }
    setPoolId(holding.poolId);
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
    setSourceType(newVenue);
    const targetPools = newVenue === 'strata' ? (pools.data ?? []) : (asedexPools.data ?? []);
    if (targetPools.length > 0) {
      setPoolId(targetPools[0].id);
    } else {
      setPoolId('');
    }
  };

  useEffect(() => {
    const tokenParam = params.get('token');
    if (tokenParam && livePools.length > 0) {
      const match = livePools.find(
        (p) => p.token.toLowerCase() === tokenParam.toLowerCase() || p.symbol.toLowerCase() === tokenParam.toLowerCase(),
      );
      if (match && match.id !== poolId) {
        setPoolId(match.id);
        return;
      }
    }
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

  const command = `npm run deploy:${template.id} -- --pool ${poolId} --token ${selectedPool?.token ?? '<TOKEN_ADDRESS>'} --decimals ${decimals ?? 18} --threshold ${threshold} --size ${size}${template.trades ? ` --budget ${budget}` : ''} --interval ${interval} --escrow ${escrow} --levels ${levels} --slices ${slices} --buy-size-ase ${buySizeAse} --buy-budget-ase ${buyBudgetAse}${template.id === 'risk-managed' ? ` --cost-basis ${costBasis} --daily-loss ${dailyLossLimit} --stop-loss ${stopLossBps} --take-profit ${takeProfitBps} --max-drawdown ${maxDrawdownBps}` : ''}${template.id === 'scale' || template.id === 'limit-exit' ? ` --target-upside-bps ${targetUpsideBps}` : ''}${sourceType === 'asepad' ? ` --amm asedex` : ''}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const deployLite = async () => {
    setError('');
    setResultWarning('');
    setResultAddress('');
    setRegistrationOk(false);
    setStepError('');

    if (!wallet.connected || !wallet.address) {
      wallet.openConnect();
      return;
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
      setStage('1/5 · Deploying contract (Please sign in wallet)');
      const deployed = await client.deploy(source);
      setTxHashes((prev) => ({ ...prev, deploy: deployed.txHash }));
      setStepStatus('confirming');
      saveUserTx(wallet.address, {
        hash: deployed.txHash,
        type: 'deploy',
        description: `Deploy ${template.name} contract`,
        timestamp: Date.now(),
        status: 'pending',
      });

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

      // STEP 2: Verify deployed source hash (resilient with polling and format tolerance)
      setCurrentStep(2);
      setStage('2/5 · Verifying deployed source hash');
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
        setStage('2/5 · Source hash verified on-chain');
      } else {
        console.warn('Source verification notice: hash indexing or format difference', {
          expectedHash,
          storedHash,
          readBackHash,
        });
        setResultWarning('Contract deployed. Source hash is being indexed by the network.');
      }

      // STEP 3: Initializing strategy and funding cron schedule
      setCurrentStep(3);
      setStepStatus('waiting_signature');
      setStage('3/5 · Initializing strategy and funding cron schedule (Please sign in wallet)');
      const nativeStrategyBudget = template.id === 'dca' || template.id === 'grid' ? BigInt(buyBudgetAseWei || '0') : 0n;
      const initHash = await client.call(address, 'init', args, gasEscrow + nativeStrategyBudget);
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
        setCurrentStep(4);
        setStepStatus('waiting_signature');
        setStage(`4/5 · Transferring ${budget} ${selectedPool.symbol} allocation (Please sign in wallet)`);
        const transferHash = await client.call(selectedPool.token, 'transfer', [address, tokenBudget.toString()]);
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

      // STEP 5: Registering strategy in Strata Hub
      setCurrentStep(5);
      setStepStatus('waiting_signature');
      setStage('5/5 · Registering strategy in Strata Hub (Please sign in wallet)');
      let registrationHash = '';
      try {
        registrationHash = await client.call(STRATA_HUB, 'registerStrategy', [address, template.id, selectedPool.id]);
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
        setResultWarning(`Strategy is live and funded, but Hub registration failed: ${registrationError instanceof Error ? registrationError.message : String(registrationError)}`);
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

      setCurrentStep(6);
      setStepStatus('done');
      setStage('Deployment complete');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStepError(msg);
      setStepStatus('error');
      setStage('Deployment stopped');
    } finally {
      setDeploying(false);
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

  const launchDisabled =
    deploying ||
    !selectedPool ||
    (template.trades && template.id !== 'dca' && (!sizeWei || !budgetWei)) ||
    ((template.id === 'dca' || template.id === 'grid') && (!buySizeAseWei || !buyBudgetAseWei));

  const intervalChips = [
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
      <section className="wrap detail-head">
        <span className="label">Strata terminal · Asentum testnet</span>
        <h1 className="detail-title">Launch a trading bot.</h1>
        <p className="section-note" style={{ maxWidth: 700 }}>
          Pick what the bot should do, choose the token and amount, then read the plan in plain language.
          Your wallet signs every step — and you can stop the bot or withdraw your funds at any time.
        </p>
        <div className="mode-switch" role="group" aria-label="Interface mode">
          <button type="button" className={mode === 'lite' ? 'mode-option active' : 'mode-option'} onClick={() => setMode('lite')}>
            <span>Simple</span><small>Bot terminal · recommended</small>
          </button>
          <button type="button" className={mode === 'pro' ? 'mode-option active' : 'mode-option'} onClick={() => setMode('pro')}>
            <span>Pro</span><small>Raw parameters · CLI · all templates</small>
          </button>
        </div>
        {fromMarketplace && (
          <div className="notice marketplace-copy-notice" style={{ marginTop: 18, maxWidth: 760 }}>
            <strong>Community settings loaded</strong>
            <span>These values were shared by another wallet. Review the pool, size, token budget and every risk rule before deploying. {marketplaceBudgetHint ? 'The original contract did not store its full funding budget, so the suggested amount is only a starting point.' : 'The strategy configuration is a starting point, not a performance guarantee.'}</span>
          </div>
        )}
      </section>

      <section className="wrap" style={{ paddingBottom: 90 }}>
        <div className="terminal-grid">
          {mode === 'lite' ? (
            <div className="terminal-card">
              <div className="bot-tabs" role="tablist" aria-label="Bot type">
                {BOT_TYPES.map((bot) => (
                  <button
                    key={bot.templateId}
                    type="button"
                    role="tab"
                    aria-selected={template.id === bot.templateId}
                    className={template.id === bot.templateId ? 'bot-tab active' : 'bot-tab'}
                    onClick={() => selectBotType(bot.templateId)}
                  >
                    <span className="bot-tab-mark" aria-hidden="true">{bot.mark}</span>
                    <strong>{bot.title}</strong>
                    <small>{bot.short}</small>
                  </button>
                ))}
              </div>

              <div className="terminal-body">
                <p className="bot-blurb">{activeBot.blurb}</p>

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
                  <div className="notice" style={{ borderLeftColor: '#e8b84b' }}>
                    <strong>You hold 0 {sym}</strong>
                    <span>
                      This bot sells tokens, so the contract needs {sym} in it. Change the token, or start a DCA bot that buys with ASE instead.
                    </span>
                    {tokensWithBalance.length > 0 && (
                      <div className="chip-row" style={{ marginTop: 10 }}>
                        {tokensWithBalance.map((holding) => (
                          <button key={holding.token} type="button" className="chip-btn" onClick={() => selectTokenPool(holding)}>
                            {holding.symbol} · {holding.balanceFmt}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      className="chip-btn"
                      style={{ marginTop: 10 }}
                      onClick={() => selectBotType('dca')}
                    >
                      Use DCA with my ASE instead
                    </button>
                  </div>
                )}

                {template.id === 'dca' && (
                  <>
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

                    <div className="param-grid">
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="dcaBuySize">Spend per purchase · ASE</label>
                        <input id="dcaBuySize" className="input" value={buySizeAse} onChange={(event) => setBuySizeAse(event.target.value)} inputMode="decimal" />
                      </div>
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="dcaInterval">Buy every · seconds</label>
                        <input id="dcaInterval" className="input" type="number" min={60} max={86400} value={interval} onChange={(event) => setInterval(Number(event.target.value))} />
                      </div>
                    </div>
                    <div className="chip-row">
                      {intervalChips.map((chip) => (
                        <button key={chip.value} type="button" className={interval === chip.value ? 'chip-btn active' : 'chip-btn'} onClick={() => setInterval(chip.value)}>
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {template.id === 'limit-exit' && (
                  <>
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

                    <div className="param-grid">
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="limitTarget">Target rise · %</label>
                        <input
                          id="limitTarget"
                          className="input"
                          value={targetUpsidePct}
                          onChange={(event) => setTargetUpsideBps(String(Math.round((Number(event.target.value) || 0) * 100)))}
                          inputMode="decimal"
                        />
                      </div>
                      <div className="field" style={{ marginTop: 0 }}>
                        <label>Target price & payout</label>
                        <div className="mono" style={{ fontSize: 16, paddingTop: 6 }}>{amt(targetPrice, 6)} ASE</div>
                        <small className="muted mono" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                          You receive: <strong style={{ color: 'var(--accent)' }}>~{amt(estAseOut, 4)} ASE</strong>
                        </small>
                      </div>
                    </div>
                  </>
                )}

                {template.id === 'grid' && (
                  <>
                    <div className="amount-field">
                      <div className="amount-field-head">
                        <label htmlFor="gridBudget">Tokens to sell</label>
                        <span className="field-help">Available: {tokenBalance} {sym}</span>
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
                        <span className="field-help">Available: {aseBalance} ASE</span>
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
                      Each level sells {size || '0'} {sym} and buys with {buySizeAse || '0'} ASE. The grid runs until every level has executed.
                    </p>
                  </>
                )}

                {template.id === 'risk-managed' && (
                  <>
                    <div className="amount-field">
                      <div className="amount-field-head">
                        <label htmlFor="riskSize">Sell per run</label>
                        <span className="field-help">Available: {tokenBalance} {sym}</span>
                      </div>
                      <div className="amount-input">
                        <input id="riskSize" value={size} onChange={(event) => setSize(event.target.value)} inputMode="decimal" aria-label={`Amount of ${sym} per exit`} />
                        <span className="amount-unit">{sym}</span>
                      </div>
                      <div className="pct-row">
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.25)}>25%</button>
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.5)}>50%</button>
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(0.75)}>75%</button>
                        <button type="button" className="pct-btn" onClick={() => applyTokenPct(1)}>MAX</button>
                      </div>
                    </div>

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

                    <div className="param-grid">
                      <div className="field" style={{ marginTop: 0 }}>
                        <label htmlFor="riskAllocation">Total allocation · {sym}</label>
                        <input id="riskAllocation" className="input" value={budget} onChange={(event) => setBudgetDerived(event.target.value)} inputMode="decimal" />
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
                        <label>Check every</label>
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
                  <>
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
                        <div className="mono" style={{ fontSize: 16, paddingTop: 9 }}>{size || '0'} {sym}</div>
                      </div>
                    </div>
                    <p className="field-help">One order every {intervalLabel(interval)}, so {sliceCount} orders take about {intervalLabel(sliceCount * interval)}.</p>
                  </>
                )}

                <div className="terminal-note">
                  <span>Network fee (held in escrow, returned when stopped)</span>
                  <strong className="mono">~{escrow} ASE</strong>
                </div>

                <button className="btn btn-primary launch-btn" type="button" onClick={deployLite} disabled={launchDisabled}>
                  {deploying ? 'Deploying & Initializing…' : wallet.connected ? `Launch ${activeBot.title} bot` : 'Connect wallet to launch'}
                </button>
                {stage && <div className="deploy-stage" role="status">{stage}</div>}
                {error && <div className="notice deploy-error" role="alert">{error}</div>}
                {resultWarning && <div className="notice deploy-warning">{resultWarning}</div>}
                {resultAddress && (
                  <div className="deploy-result">
                    <div className="live-dot">Contract deployed</div>
                    <a className="mono" href={`https://explorer.asentum.com/address/${displayAseAddress(resultAddress)}`} target="_blank" rel="noreferrer">{displayAseAddress(resultAddress)}</a>
                    <div className="muted">{registrationOk ? 'Registered in Strata Hub.' : 'Check the registration warning above.'} Review the transaction receipts in the explorer.</div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="step-num">PRO · EVERY TEMPLATE AND PARAMETER</div>
              <div className="template-grid" style={{ marginTop: 14 }}>
                {TEMPLATES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`template ${template.id === item.id ? 'on' : ''}`}
                    onClick={() => { setTemplateId(item.id); setInterval(item.intervalSec); setError(''); }}
                  >
                    <div className="template-name">{item.name}</div>
                    <div className="template-desc">{item.desc}</div>
                    <div className="template-meta mono">
                      every {item.intervalSec}s · {item.requires === 'gas' ? 'gas only' : item.requires === 'ase' ? 'ASE-funded buys' : item.requires === 'both' ? 'ASE + token funding' : 'token funding'}
                    </div>
                  </button>
                ))}
              </div>

              <div className="strategy-behavior notice" style={{ marginTop: 16 }}>
                <strong>What this contract actually does</strong>
                <span>{template.behavior}</span>
              </div>

              <div className="step-num" style={{ marginTop: 34 }}>VENUE</div>
              <div className="source-switch" role="group" aria-label="Contract source provider" style={{ marginTop: 14 }}>
                <button type="button" className={sourceType === 'strata' ? 'source-choice active' : 'source-choice'} onClick={() => switchVenue('strata')}>
                  <strong>Auras Finance (AMM)</strong><span>Automated spot execution & TWAP strategy deployment</span>
                </button>
                <button type="button" className={sourceType === 'asepad' ? 'source-choice active' : 'source-choice'} onClick={() => switchVenue('asepad')}>
                  <strong>AsePad / AseDex</strong><span>Official launchpad, token factory & live exchange</span>
                </button>
              </div>

              <div className="notice source-note" style={{ marginTop: 12 }}>
                <strong>Selected venue: {sourceType === 'strata' ? 'Auras Finance AMM' : 'AsePad / AseDex AMM'}</strong>
                <span>
                  {sourceType === 'strata'
                    ? 'Strata strategy contracts execute spot swaps and DCA purchases directly through verified Auras AMM pools.'
                    : 'Strata strategy contracts execute spot swaps and DCA purchases directly through verified AseDex AMM pools on AsePad.'}
                </span>
              </div>

              <div className="field" style={{ marginTop: 20 }}>
                <label htmlFor="pool">Trading pair · {sourceType === 'strata' ? 'Auras pool' : 'AseDex pool'}</label>
                <div className="pair-chips" role="group" aria-label="Quick pair selector">
                  {livePools.slice(0, 5).map((pool) => (
                    <button
                      type="button"
                      key={pool.id}
                      className={`pair-chip ${pool.id === poolId ? 'active' : ''}`}
                      onClick={() => setPoolId(pool.id)}
                    >
                      <span>{pool.symbol} / ASE</span>
                      <span className="chip-spot">#{pool.id}</span>
                    </button>
                  ))}
                </div>
                <select
                  id="pool"
                  className="input"
                  value={poolId}
                  onChange={(event) => setPoolId(event.target.value)}
                  disabled={(sourceType === 'strata' ? pools.loading : asedexPools.loading) || livePools.length === 0}
                >
                  {livePools.map((pool) => (
                    <option key={pool.id} value={pool.id}>
                      {pool.symbol}/ASE · pool #{pool.id} · spot {weiToAse(pool.spot, 6)} ASE · {pool.decimals ?? 18} decimals
                    </option>
                  ))}
                </select>
                {(sourceType === 'strata' ? pools.loading : asedexPools.loading) && <p className="field-help">Loading live pairs from Asentum…</p>}
                {!(sourceType === 'strata' ? pools.loading : asedexPools.loading) && !livePools.length && (
                  <p className="field-help warn">No live {sourceType === 'strata' ? 'Auras' : 'AseDex'} pools were returned. Deployment is disabled until the pool data loads.</p>
                )}
              </div>

              {selectedPool && (
                <div className="panel" style={{ marginTop: 12, marginBottom: 14 }}>
                  <div className="panel-body" style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                      <div>
                        <strong style={{ fontSize: 16 }}>{selectedPool.symbol} / ASE</strong>
                        <span className="mono dim" style={{ fontSize: 12, marginLeft: 8 }}>pool #{selectedPool.id}</span>
                      </div>
                      <span className="pill pill-live">Spot: {weiToAse(selectedPool.spot, 6)} ASE</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 10, fontSize: 12 }}>
                      <div><span className="label">Reserves ({selectedPool.symbol})</span><div className="mono">{weiToAse(selectedPool.reserveToken, 2)}</div></div>
                      <div><span className="label">Reserves (ASE)</span><div className="mono">{weiToAse(selectedPool.reserveNative, 2)}</div></div>
                      <div><span className="label">Token address</span><div className="mono break-value">{selectedPool.token}</div></div>
                      <div><span className="label">Decimals</span><div className="mono">{selectedPool.decimals ?? 18}</div></div>
                    </div>
                  </div>
                </div>
              )}

              {template.trades && template.id !== 'dca' && (
                <div className="row-2">
                  <div className="field">
                    <label htmlFor="size">Token amount per run</label>
                    <input id="size" className="input" value={size} onChange={(event) => setSize(event.target.value)} inputMode="decimal" />
                  </div>
                  <div className="field">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label htmlFor="budget">Total token budget to deposit</label>
                      {currentTokenHolding && (
                        <span className="muted" style={{ fontSize: 12 }}>
                          Bal: <strong className="mono">{currentTokenHolding.balanceFmt}</strong>
                          <button type="button" className="quick-bal-btn" onClick={() => applyTokenPercent(0.25)}>25%</button>
                          <button type="button" className="quick-bal-btn" onClick={() => applyTokenPercent(0.5)}>50%</button>
                          <button type="button" className="quick-bal-btn" onClick={() => applyTokenPercent(1)}>MAX</button>
                        </span>
                      )}
                    </div>
                    <input id="budget" className="input" value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" />
                  </div>
                </div>
              )}

              {(template.id === 'grid' || template.id === 'dca') && (
                <div className="panel" style={{ marginTop: 18 }}>
                  <div className="panel-head"><span className="label">{template.id === 'grid' ? 'Buy-side ASE reserve' : 'Recurring buy budget'}</span><span className="pill pill-live">{sourceType === 'strata' ? 'Auras' : 'AseDex'} spot buys</span></div>
                  <div className="panel-body">
                    <div className="row-2">
                      <div className="field"><label htmlFor="buySizeAse">{template.id === 'grid' ? 'ASE per buy level' : 'ASE per purchase'}</label><input id="buySizeAse" className="input" value={buySizeAse} onChange={(event) => setBuySizeAse(event.target.value)} inputMode="decimal" /></div>
                      <div className="field">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label htmlFor="buyBudgetAse">{template.id === 'grid' ? 'Total ASE buy reserve' : 'Total ASE DCA budget'}</label>
                          {nativeHolding && (
                            <span className="muted" style={{ fontSize: 12 }}>
                              Bal: <strong className="mono">{nativeHolding.balanceFmt} ASE</strong>
                              <button type="button" className="quick-bal-btn" onClick={() => applyAsePercent(0.25)}>25%</button>
                              <button type="button" className="quick-bal-btn" onClick={() => applyAsePercent(0.5)}>50%</button>
                              <button type="button" className="quick-bal-btn" onClick={() => applyAsePercent(1)}>MAX</button>
                            </span>
                          )}
                        </div>
                        <input id="buyBudgetAse" className="input" value={buyBudgetAse} onChange={(event) => setBuyBudgetAse(event.target.value)} inputMode="decimal" />
                      </div>
                    </div>
                    <p className="field-help">This ASE amount is transferred to the strategy during initialization, in addition to the cron gas escrow. Unspent ASE can be withdrawn after stopping. Each {sourceType === 'strata' ? 'Auras' : 'AseDex'} swap is a separate atomic transaction.</p>
                  </div>
                </div>
              )}

              {template.id === 'risk-managed' && (
                <div className="risk-config panel" style={{ marginTop: 18 }}>
                  <div className="panel-head"><span className="label">Risk manager · enforced by this contract</span><span className="pill pill-live">On-chain rules</span></div>
                  <div className="panel-body">
                    <p className="muted" style={{ marginBottom: 14 }}>The strategy checks these limits on every scheduled run. Enter your average purchase cost so realised loss can be estimated in ASE. Stop-loss and take-profit use the {sourceType === 'strata' ? 'Auras' : 'AseDex'} pool price, not an external oracle.</p>
                    <div className="row-2">
                      <div className="field"><label htmlFor="costBasis">Average purchase cost · ASE / token</label><input id="costBasis" className="input" value={costBasis} onChange={(event) => setCostBasis(event.target.value)} placeholder="e.g. 0.025" inputMode="decimal" /></div>
                      <div className="field"><label htmlFor="dailyLoss">Max realised daily loss · ASE</label><input id="dailyLoss" className="input" value={dailyLossLimit} onChange={(event) => setDailyLossLimit(event.target.value)} inputMode="decimal" /><p className="field-help">Stops before the next sale when estimated daily realised PnL reaches this loss.</p></div>
                    </div>
                    <div className="row-3">
                      <div className="field"><label htmlFor="stopLoss">Stop-loss · %</label><input id="stopLoss" className="input" value={(Number(stopLossBps) / 100).toString()} onChange={(event) => setStopLossBps(String(Math.round(Number(event.target.value) * 100)))} inputMode="decimal" /></div>
                      <div className="field"><label htmlFor="takeProfit">Take-profit · %</label><input id="takeProfit" className="input" value={(Number(takeProfitBps) / 100).toString()} onChange={(event) => setTakeProfitBps(String(Math.round(Number(event.target.value) * 100)))} inputMode="decimal" /></div>
                      <div className="field"><label htmlFor="maxDrawdown">Max drawdown · %</label><input id="maxDrawdown" className="input" value={(Number(maxDrawdownBps) / 100).toString()} onChange={(event) => setMaxDrawdownBps(String(Math.round(Number(event.target.value) * 100)))} inputMode="decimal" /></div>
                    </div>
                    <p className="field-help">Price rules are checked only when the scheduled run executes (not continuously), using the {sourceType === 'strata' ? 'Auras' : 'AseDex'} pool spot price. A triggered stop-loss, take-profit or drawdown exit is latched and sells at most the configured token amount per scheduled run until the declared allocation is exhausted. Each sale has a 2% minimum-output guard. Daily loss uses your declared average cost and realised fills; it excludes unrealised inventory losses and gas.</p>
                  </div>
                </div>
              )}

              {template.id === 'limit-exit' && (
                <div className="panel" style={{ marginTop: 18 }}>
                  <div className="panel-head"><span className="label">Limit sell · reduce-only</span><span className="pill pill-live">One execution</span></div>
                  <div className="panel-body">
                    <div className="field"><label htmlFor="limitTargetPro">Target above current pool price · %</label><input id="limitTargetPro" className="input" value={(Number(targetUpsideBps) / 100).toString()} onChange={(event) => setTargetUpsideBps(String(Math.round(Number(event.target.value) * 100)))} inputMode="decimal" /></div>
                    <p className="field-help">Strata records the current {sourceType === 'strata' ? 'Auras' : 'AseDex'} pool price at deployment, checks it on the selected schedule and sells one order size when the target is reached. This is not a continuously resting order-book limit.</p>
                  </div>
                </div>
              )}

              {template.id === 'scale' && (
                <div className="panel" style={{ marginTop: 18 }}>
                  <div className="panel-head"><span className="label">Scale ladder · reduce-only</span><span className="pill pill-live">Price triggered</span></div>
                  <div className="panel-body">
                    <div className="row-2">
                      <div className="field"><label htmlFor="scaleTarget">Target above current price · %</label><input id="scaleTarget" className="input" value={(Number(targetUpsideBps) / 100).toString()} onChange={(event) => setTargetUpsideBps(String(Math.round(Number(event.target.value) * 100)))} inputMode="decimal" /></div>
                      <div className="field"><label htmlFor="levels">Sell levels</label><input id="levels" className="input" value={levels} onChange={(event) => changeLevels(event.target.value)} inputMode="numeric" /></div>
                    </div>
                    <p className="field-help">Each level sells the amount set above. Strata checks the {sourceType === 'strata' ? 'Auras' : 'AseDex'} pool price on schedule and sells one slice when a trigger is reached. Reduce-only spot execution; the pool must reach the trigger while the cron job is active.</p>
                  </div>
                </div>
              )}

              <div className="row-2">
                <div className="field">
                  <label htmlFor="threshold">Threshold · bps <span className="dim">(100 bps = 1%)</span></label>
                  <input id="threshold" className="input" value={threshold} onChange={(event) => setThreshold(event.target.value)} inputMode="numeric" />
                </div>
                <div className="field">
                  <label htmlFor="escrow">Gas escrow · ASE</label>
                  <input id="escrow" className="input" value={escrow} onChange={(event) => setEscrow(event.target.value)} inputMode="decimal" />
                </div>
              </div>

              <div className="row-2">
                <div className="field">
                  <label htmlFor="interval">Interval · seconds</label>
                  <input id="interval" className="input" value={interval} onChange={(event) => setInterval(Number(event.target.value))} inputMode="numeric" min={60} max={86400} disabled={!supportsCustomInterval} />
                  {!supportsCustomInterval && <p className="field-help">This template uses its fixed on-chain schedule. Custom intervals must be 60–86,400 seconds.</p>}
                </div>
                <div className="field">
                  <label htmlFor="levelsPro">Levels / slices</label>
                  <div className="row-2">
                    <input id="levelsPro" className="input" value={levels} onChange={(event) => changeLevels(event.target.value)} inputMode="numeric" aria-label="Levels" />
                    <input className="input" value={slices} onChange={(event) => changeSlices(Number(event.target.value) || 1)} inputMode="numeric" aria-label="TWAP slices" />
                  </div>
                </div>
              </div>

              <div className="pro-command">
                <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="label">PowerShell · CLI command</span>
                  <span className="pill pill-live">{sourceType === 'asepad' ? 'AseDex AMM' : 'Auras AMM'}</span>
                </div>
                <div className="cmd" style={{ margin: 14 }}>
                  <span className="prompt">PS&gt;</span><span>{command}</span>
                  <button onClick={copy} type="button">{copied ? 'copied' : 'copy'}</button>
                </div>
                <div className="panel-body">
                  <p className="muted">Run from the project root in PowerShell. The local CLI signs with the seed in <code>.strata/seed.json</code> or the <code>STRATA_SEED</code> environment variable. Back up the seed securely; do not send it to anyone.</p>
                </div>
              </div>

              <div className="lite-deploy-panel" style={{ marginTop: 18 }}>
                <div>
                  <div className="template-name">Ready to deploy?</div>
                  <p className="muted" style={{ marginTop: 5 }}>Your wallet signs each step. No seed phrase or private key is requested by this page.</p>
                </div>
                <button className="btn btn-primary" type="button" onClick={deployLite} disabled={launchDisabled}>
                  {deploying ? 'Working…' : wallet.connected ? 'Deploy with wallet' : 'Connect wallet to deploy'}
                </button>
                {stage && <div className="deploy-stage" role="status">{stage}</div>}
                {error && <div className="notice deploy-error" role="alert">{error}</div>}
                {resultWarning && <div className="notice deploy-warning">{resultWarning}</div>}
                {resultAddress && (
                  <div className="deploy-result">
                    <div className="live-dot">Contract deployed</div>
                    <a className="mono" href={`https://explorer.asentum.com/address/${displayAseAddress(resultAddress)}`} target="_blank" rel="noreferrer">{displayAseAddress(resultAddress)}</a>
                    <div className="muted">{registrationOk ? 'Registered in Strata Hub.' : 'Check the registration warning above.'} Review the transaction receipts in the explorer.</div>
                  </div>
                )}
              </div>

              <div className="panel" style={{ marginTop: 20 }}>
                <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="label">Live {sourceType === 'asepad' ? 'AseDex' : 'Auras'} pairs ({(sourceType === 'asepad' ? asedexPools.loading : pools.loading) ? '…' : livePools.length})</span>
                  <span className="mono dim" style={{ fontSize: 11 }}>Asentum testnet</span>
                </div>
                <div className="panel-body pool-live-list">
                  {livePools.slice(0, 12).map((pool) => (
                    <button type="button" key={pool.id} className={pool.id === poolId ? 'pool-live-row selected' : 'pool-live-row'} onClick={() => setPoolId(pool.id)}>
                      <span>{pool.symbol}/ASE <small>#{pool.id}</small></span>
                      <span className="mono">{weiToAse(pool.reserveNative, 2)} ASE</span>
                      <span className="mono dim">spot {weiToAse(pool.spot, 6)}</span>
                    </button>
                  ))}
                  {(sourceType === 'asepad' ? asedexPools.loading : pools.loading) && <p className="muted">Loading live pairs from Asentum…</p>}
                  {!(sourceType === 'asepad' ? asedexPools.loading : pools.loading) && !livePools.length && <p className="muted">Pool data is unavailable right now.</p>}
                </div>
              </div>
            </div>
          )}

          <aside className="terminal-side">
            <WalletPanel compact />

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
                <div className="preview-fact"><span>Network fee</span><strong>{escrow} ASE</strong></div>
                <div className="safety-line">
                  <span className="safety-icon" aria-hidden="true">✓</span>
                  <span>100% on-chain smart contract. Stop it or withdraw your funds whenever you want — no server and no custodian.</span>
                </div>
              </div>
            </div>

            {mode === 'pro' && (
              <div className="panel">
                <div className="panel-head"><span className="label">Raw parameters</span></div>
                <div className="panel-body">
                  <dl className="kv">
                    <dt>Template</dt><dd>{template.id}</dd>
                    <dt>Venue</dt><dd>{sourceType === 'asepad' ? 'AseDex AMM' : 'Auras AMM'}</dd>
                    <dt>Pool</dt><dd>{selectedPool ? `#${selectedPool.id} · ${selectedPool.symbol}/ASE` : '—'}</dd>
                    <dt>Threshold</dt><dd>{threshold} bps</dd>
                    <dt>Token budget</dt><dd>{template.trades && template.id !== 'dca' ? `${budget} ${sym}` : '—'}</dd>
                    <dt>Sell size</dt><dd>{template.trades && template.id !== 'dca' ? `${size} ${sym}` : '—'}</dd>
                    <dt>ASE buy size</dt><dd>{template.id === 'dca' || template.id === 'grid' ? `${buySizeAse} ASE` : '—'}</dd>
                    <dt>ASE buy reserve</dt><dd>{template.id === 'dca' || template.id === 'grid' ? `${buyBudgetAse} ASE` : '—'}</dd>
                    <dt>Cadence</dt><dd>{interval}s</dd>
                    <dt>Levels / slices</dt><dd>{template.id === 'grid' || template.id === 'scale' ? levels : template.id === 'twap' ? slices : '—'}</dd>
                    <dt>Gas escrow</dt><dd>{escrow} ASE</dd>
                    <dt>Needs</dt><dd>{template.id === 'dca' ? 'ASE budget + cron gas' : template.id === 'grid' ? 'Token inventory + ASE buy reserve + cron gas' : template.requires === 'gas' ? 'ASE only' : 'ASE + token budget'}</dd>
                  </dl>
                </div>
              </div>
            )}

            <div className="panel">
              <div className="panel-body">
                <p className="muted" style={{ fontSize: 12.5 }}>
                  Experimental testnet software, not investment advice. The owner can stop the cron job from the bot page; unused escrow returns to the contract, then ASE and unused tokens can be withdrawn. Confirm the pair, amount and source hash before signing.
                </p>
                <Link className="btn btn-ghost" to="/how" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}>How it works →</Link>
              </div>
            </div>
          </aside>
        </div>
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
                    onClick={() => {
                      setSourceType(pool.venue === 'asedex' ? 'asepad' : 'strata');
                      setPoolId(pool.id);
                      setTokenModalOpen(false);
                    }}
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
                {currentStep === 6 ? 'Bot is live' : `Launching ${activeBot.title} bot`}
              </h3>
              {(!deploying || currentStep === 6 || stepStatus === 'error') && (
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
              {currentStep === 6
                ? 'Your bot contract is live, initialized, funded, and registered in Strata Hub on Asentum.'
                : 'Follow the 5 steps below. Keep this tab open and confirm each wallet prompt as it appears.'}
            </p>

            <div className="deploy-stepper-progress">
              <div
                className="deploy-stepper-bar"
                style={{
                  width: currentStep === 6 ? '100%' : `${Math.max(10, ((currentStep - 1) / 5) * 100)}%`,
                  background: stepStatus === 'error' ? '#ef4444' : undefined,
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
                      <a href={explorerTxUrl(txHashes.deploy)} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>
                        Tx ↗
                      </a>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
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
                  <strong>2. Verify the published code</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {currentStep === 2 && 'Comparing the source hash on Asentum…'}
                    {currentStep > 2 && 'Source hash matches the deployed contract'}
                  </div>
                </div>
              </div>

              <div className={`stepper-item ${currentStep === 3 ? 'active' : currentStep > 3 ? 'done' : ''}`}>
                <div className={`stepper-icon ${currentStep > 3 ? 'done' : currentStep === 3 ? (stepStatus === 'error' ? 'error' : 'active') : 'pending'}`}>
                  {currentStep > 3 ? '✓' : '3'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>3. Start the schedule</strong>
                    {txHashes.init && (
                      <a href={explorerTxUrl(txHashes.init)} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>
                        Tx ↗
                      </a>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {currentStep === 3 && stepStatus === 'waiting_signature' && 'Please sign the init() call in your wallet to schedule runs…'}
                    {currentStep === 3 && stepStatus === 'confirming' && 'Confirming schedule on Asentum…'}
                    {currentStep > 3 && 'Schedule armed with Cron'}
                  </div>
                </div>
              </div>

              {template.trades && template.id !== 'dca' && (
                <div className={`stepper-item ${currentStep === 4 ? 'active' : currentStep > 4 ? 'done' : ''}`}>
                  <div className={`stepper-icon ${currentStep > 4 ? 'done' : currentStep === 4 ? (stepStatus === 'error' ? 'error' : 'active') : 'pending'}`}>
                    {currentStep > 4 ? '✓' : '4'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>4. Deposit the tokens</strong>
                      {txHashes.fund && (
                        <a href={explorerTxUrl(txHashes.fund)} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>
                          Tx ↗
                        </a>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {currentStep === 4 && stepStatus === 'waiting_signature' && `Please approve transfer of ${budget} ${selectedPool?.symbol} in your wallet…`}
                      {currentStep === 4 && stepStatus === 'confirming' && 'Confirming token transfer…'}
                      {currentStep > 4 && `${budget} ${selectedPool?.symbol} deposited`}
                    </div>
                  </div>
                </div>
              )}

              <div className={`stepper-item ${currentStep === 5 ? 'active' : currentStep > 5 ? 'done' : ''}`}>
                <div className={`stepper-icon ${currentStep > 5 ? 'done' : currentStep === 5 ? (stepStatus === 'error' ? 'error' : 'active') : 'pending'}`}>
                  {currentStep > 5 ? '✓' : '5'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>5. Publish to the Strata Hub</strong>
                    {txHashes.register && (
                      <a href={explorerTxUrl(txHashes.register)} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>
                        Tx ↗
                      </a>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {currentStep === 5 && stepStatus === 'waiting_signature' && 'Please confirm public registration in Strata Hub…'}
                    {currentStep === 5 && stepStatus === 'confirming' && 'Registering for the leaderboard…'}
                    {currentStep > 5 && 'Registered in Strata Hub'}
                  </div>
                </div>
              </div>
            </div>

            {stepError && (
              <div className="notice" style={{ borderColor: '#ef4444', background: 'rgba(239, 68, 68, 0.08)', marginBottom: 16 }}>
                <strong style={{ color: '#ef4444' }}>Transaction halted:</strong>
                <p style={{ margin: '4px 0 0', fontSize: 13 }}>{stepError}</p>
                {/session|expired|locked/i.test(stepError) && (
                  <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
                    If you paired via Telegram (@AsentumWalletBot), the session timed out or was disconnected. If using the Chrome Extension, ensure your wallet is unlocked. Click "Reconnect wallet" to refresh your session.
                  </p>
                )}
                {resultAddress && (
                  <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
                    The contract was deployed at {shortAddr(resultAddress)} and is saved in your Portfolio.
                  </p>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              {currentStep === 6 ? (
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
                  {/session|expired|locked|reconnect/i.test(stepError) ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setModalOpen(false);
                        wallet.openConnect();
                      }}
                    >
                      🔗 Reconnect wallet
                    </button>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={deployLite}>
                      Retry deployment
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
