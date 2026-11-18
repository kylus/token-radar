// The token radar's model (radar-3): one snapshot in, one ranked board out. Standard library only.
//
// A protocol is "pre-token" when the snapshot records no token for it (no market cap, no CoinGecko id,
// no symbol). The board ranks pre-token protocols by an implied launch value, and keeps the protocols
// whose token already trades apart, as the market's own values: they are the model's comparables.
//
// Implied value follows only from the snapshot's own figures, never from a list of names:
//
//   comparable   = per category, the median of mcap / TVL (each held to 0.03 .. 1.5) over live-token
//                  protocols of that category, shrunk toward the median of all of them (K = 8
//                  pseudo-peers) when the category has few, and held to 0.08 .. 1.0
//   implied      = TVL x comparable x size x growth x quiet-time x reach
//   size         = (TVL / median comparable TVL) ^ slope, held to 0.35 .. 1.6, where slope is the least-
//                  squares slope of ln(mcap / TVL) on ln(TVL) over the same comparables, held to -0.45 .. 0:
//                  the market pays less per dollar of TVL the bigger the protocol is, and the comparables'
//                  own multiples are divided by that effect first, so it is counted once
//   growth      = 1 + 0.5 x clamp(change_7d, -50, +100) / 100              (0.75 .. 1.50)
//   quiet-time   = 0.7 + 0.5 x min(age, 730) / 730 - 0.25 x clamp((age - 1095) / 1095, 0, 1)
//                  age is the days DefiLlama has tracked the protocol with no token (unknown: 540)
//   reach        = 1 + 0.03 x min(chains - 1, 5)                            (1.00 .. 1.15)
//
// The shape of quiet-time is an assumption, stated on the page: a protocol that has run for two years
// without a token has users who are owed a reward, while one that has run past three years with none
// has shown it can do without. Every constant sits in MODEL and is shown in the dashboard.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export const MODEL = {
  comp_min_tvl_usd: 10_000_000,
  comp_ratio_floor: 0.03,
  comp_ratio_cap: 1.5,
  comp_shrink_peers: 8,
  multiple_floor: 0.08,
  multiple_cap: 1,
  size_slope_floor: -0.45,
  size_mult_floor: 0.35,
  size_mult_cap: 1.6,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  quiet_floor: 0.7,
  quiet_gain: 0.5,
  quiet_ramp_days: 730,
  quiet_decay: 0.25,
  quiet_decay_start_days: 1095,
  quiet_decay_span_days: 1095,
  unknown_age_days: 540,
  reach_step: 0.03,
  reach_max_extra_chains: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many pre-token protocols below the watchlist floor the early radar adds, by TVL. */
export const EARLY_ROWS = 160;

/** The biggest live-token protocols the Live tab shows, by market cap. */
export const LIVE_ROWS = 30;

/** One category's comparable: what the market pays for a dollar of TVL where a token trades. */
export interface Comp {
  category: string;
  peers: number;
  median: number;
  multiple: number;
  examples: string[];
}

/** One step of a farm plan: the action, what it costs and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One board row: everything the gate needs, plus the figures the dashboard shows. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  implied_value_usd: number;
  value_to_tvl: number;
  model: {
    category_multiple: number;
    comp_peers: number;
    size_multiplier: number;
    growth_multiplier: number;
    quiet_time_multiplier: number;
    reach_multiplier: number;
  };
  farm_capital_usd: number;
  farm_gas_usd: number;
  farm_days: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the page shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_to_tvl: number;
}

/** What the dashboard needs: the board with its plans, the comparables and the live set. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  global_multiple: number;
  size_slope: number;
  size_ref_tvl: number;
  watchlist_size: number;
  protocol_count: number;
  pre_token_count: number;
  live_count: number;
  rows: Array<Omit<BoardRow, 'farm_steps'> & { plan: FarmStep[] }>;
  comps: Comp[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Whole days from the day DefiLlama began tracking a protocol to the snapshot's day; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** Whether the snapshot records no token for a protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The watchlist's own rule, as far as the ten fields let a model apply it to a protocol below the floor. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_START = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)/i;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a pre-token protocol is a launch candidate: not a bridge, a staking receipt, an exchange or a versioned pool. */
export function isCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  return !VERSIONED.test(p.name) && !WRAPPED_WORD.test(p.name) && !EXCHANGE_START.test(p.name);
}

/** The comparables: per category, what live-token protocols are worth per dollar of TVL. */
export function buildComps(snapshot: Snapshot): { global: number; comps: Map<string, Comp>; live: SnapshotProtocol[]; slope: number; refTvl: number } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0);
  const usable = live.filter((p) => p.tvl_usd >= MODEL.comp_min_tvl_usd && p.category !== null && p.category !== 'CEX');
  // One peer's ratio is held inside a band, so a single outlier cannot set a whole category's multiple.
  const raw = (p: SnapshotProtocol): number => clamp(p.mcap_usd! / p.tvl_usd, MODEL.comp_ratio_floor, MODEL.comp_ratio_cap);
  // The size effect: the least-squares slope of ln(ratio) on ln(TVL) over all comparables.
  const refTvl = usable.length > 0 ? median(usable.map((p) => p.tvl_usd)) : MODEL.comp_min_tvl_usd;
  let slope = 0;
  if (usable.length >= 8) {
    const xs = usable.map((p) => Math.log(p.tvl_usd / refTvl));
    const ys = usable.map((p) => Math.log(raw(p)));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0);
    slope = sxx > 0 ? clamp(sxy / sxx, MODEL.size_slope_floor, 0) : 0;
  }
  // A comparable's ratio with the size effect taken out: what it would trade at, at the median size.
  const ratio = (p: SnapshotProtocol): number => raw(p) / Math.pow(p.tvl_usd / refTvl, slope);
  const ratios = usable.map(ratio);
  const global = ratios.length > 0 ? median(ratios) : 0.5;
  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of usable) groups.set(p.category!, [...(groups.get(p.category!) ?? []), p]);
  const comps = new Map<string, Comp>();
  for (const [category, peers] of groups) {
    const med = median(peers.map(ratio));
    const shrunk = (peers.length * med + MODEL.comp_shrink_peers * global) / (peers.length + MODEL.comp_shrink_peers);
    const examples = [...peers].sort((a, b) => b.mcap_usd! - a.mcap_usd! || byText(a.slug, b.slug)).slice(0, 3).map((p) => p.name);
    comps.set(category, { category, peers: peers.length, median: round4(med), multiple: round4(clamp(shrunk, MODEL.multiple_floor, MODEL.multiple_cap)), examples });
  }
  return { global: round4(clamp(global, MODEL.multiple_floor, MODEL.multiple_cap)), comps, live, slope: round4(slope), refTvl };
}

/** The size multiplier for a TVL: below the comparables' median size a protocol earns more per dollar, above it less. */
export function sizeMultiplier(tvl: number, refTvl: number, slope: number): number {
  return clamp(Math.pow(Math.max(tvl, 1) / refTvl, slope), MODEL.size_mult_floor, MODEL.size_mult_cap);
}

/** The growth multiplier for a seven-day TVL change in per cent. */
export function growthMultiplier(change7d: number | null): number {
  const g = clamp(change7d ?? 0, MODEL.growth_floor, MODEL.growth_cap);
  return 1 + (g / 100) * MODEL.growth_weight;
}

/** The quiet-time multiplier for the days a protocol has run with no token. */
export function quietTimeMultiplier(age: number | null): number {
  const a = age ?? MODEL.unknown_age_days;
  const ramp = (Math.min(Math.max(a, 0), MODEL.quiet_ramp_days) / MODEL.quiet_ramp_days) * MODEL.quiet_gain;
  const decay = clamp((a - MODEL.quiet_decay_start_days) / MODEL.quiet_decay_span_days, 0, 1) * MODEL.quiet_decay;
  return MODEL.quiet_floor + ramp - decay;
}

/** The reach multiplier for the number of chains a protocol counts TVL on. */
export function reachMultiplier(chains: number): number {
  return 1 + MODEL.reach_step * Math.min(Math.max(chains - 1, 0), MODEL.reach_max_extra_chains);
}

/** The gas one transaction costs on a protocol's first chain, in dollars: a stated assumption, not a quote. */
function gasPerTx(chain: string): number {
  const table: Record<string, number> = {
    Ethereum: 6, Arbitrum: 0.4, Base: 0.1, Optimism: 0.2, Polygon: 0.1, BSC: 0.3, Binance: 0.3, Avalanche: 0.3,
    Solana: 0.02, Sui: 0.05, Hyperliquid: 0.1, 'Hyperliquid L1': 0.1, Monad: 0.1, Tron: 1, Bitcoin: 4, Stellar: 0.01, Ripple: 0.01,
  };
  return table[chain] ?? 1;
}

/** Capital for one farm position, sized from the protocol's own TVL so a small pool is not moved by it. */
function capitalFor(tvl: number): number {
  if (tvl >= 2_000_000_000) return 300;
  if (tvl >= 500_000_000) return 200;
  if (tvl >= 100_000_000) return 100;
  if (tvl >= 20_000_000) return 75;
  return 50;
}

/** How many days to hold: a younger protocol has fewer snapshots behind it, so it asks for a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 75;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

const usd = (n: number): string => (n >= 10 ? `$${Math.round(n)}` : `$${n.toFixed(n < 1 ? 2 : 1).replace(/\.0$/, '')}`);

/** The category's two core actions: the first opens the position, the second is a second kind of touch. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('credit')) {
    return [`Supply ${usd(capital)} of a stablecoin to ${n} on ${chain}, and keep it supplied.`, `Borrow a small amount, about ${usd(capital / 5)}, against it, hold it a day, then repay it in full to show both sides of the market.`];
  }
  if (c.includes('dex') || c.includes('liquidity') || c.includes('farm') || c.includes('leveraged')) {
    return [`Add ${usd(capital)} of liquidity to ${n}'s deepest stablecoin pool on ${chain}.`, `Make two small swaps through ${n} (about ${usd(capital / 10)} each, there and back) so the wallet also counts as a trader.`];
  }
  if (c.includes('deriv') || c.includes('option') || c.includes('perp') || c.includes('basis') || c.includes('interest')) {
    return [`Deposit ${usd(capital)} of USDC into ${n} on ${chain} as margin or vault shares.`, `Open one small position, about ${usd(capital / 10)}, with no leverage, and close it before the week is out.`];
  }
  if (c.includes('yield') || c.includes('aggregator') || c.includes('allocator') || c.includes('curator') || c.includes('vault')) {
    return [`Deposit ${usd(capital)} into ${n}'s largest stablecoin vault on ${chain} and keep the shares.`, `Withdraw a tenth of it after two weeks and deposit it again to show the wallet moves funds in and out.`];
  }
  if (c.includes('rwa') || c.includes('stable') || c.includes('algo') || c.includes('reserve')) {
    return [`Mint or buy ${usd(capital)} of ${n}'s own asset on ${chain}, and hold it.`, `Redeem a small part, about ${usd(capital / 10)}, once, to show the exit works.`];
  }
  if (c.includes('stak') || c.includes('restak')) {
    return [`Stake ${usd(capital)} of the asset ${n} accepts on ${chain} and keep the receipt.`, `Unstake a tenth of it after two weeks to learn the exit time before more money is committed.`];
  }
  if (c.includes('predict')) {
    return [`Fund ${usd(capital)} on ${n} and take one position on a market that is far from its deadline.`, `Sell the position back before the market closes and take one position on a second market.`];
  }
  return [`Deposit ${usd(capital)} of USDC into ${n} on ${chain} and use its main feature once.`, `Use a second feature of ${n} once, with a small amount, about ${usd(capital / 10)}.`];
}

/** A farm plan: seven steps, each with a cost and a time, derived from the protocol's own record. */
export function farmPlan(p: SnapshotProtocol, age: number | null, peers: Comp | undefined): { plan: FarmStep[]; capital: number; gas: number; days: number; chain: string } {
  // The cheapest of the chains the protocol counts TVL on is where the plan runs; ties keep the listed order.
  const chain = p.chains.length > 0 ? p.chains.reduce((best, c) => (gasPerTx(c) < gasPerTx(best) ? c : best)) : 'its main chain';
  const g = gasPerTx(chain);
  const capital = capitalFor(p.tvl_usd);
  const days = holdDaysFor(age);
  const weeks = Math.ceil(days / 7);
  const [open, second] = actionsFor(p, capital, chain);
  const weekly = g * 2;
  const move = p.change_7d;
  const where = chain === p.chains[0] || p.chains.length < 2 ? `on ${chain}` : `on ${chain}, the cheapest of its ${p.chains.length} chains`;
  const peerText = peers === undefined ? `Its category has no live token to compare with, so no price is implied by a peer.` : `Live ${p.category} protocols such as ${peers.examples[0]} trade near ${(peers.median * 100).toFixed(0)}% of their TVL, which is the range this board prices ${p.name} in.`;
  // The signal step reads the protocol's own record: its growth, its age and its size decide what to look for first.
  const momentum = move === null
    ? `DefiLlama reports no seven-day change for ${p.name}, so look at its TVL chart yourself before you deposit.`
    : move >= 15
      ? `TVL is up ${move.toFixed(0)}% in a week, which usually means an incentive programme is running: look for a live points page, and expect deposit caps.`
      : move <= -15
        ? `TVL is down ${Math.abs(move).toFixed(0)}% in a week: find out why (an exploit, a campaign that ended) before any money goes in.`
        : `TVL is steady (${move >= 0 ? '+' : ''}${move.toFixed(1)}% in a week), so there is no campaign rush: enter at your own pace.`;
  const maturity = age === null
    ? ''
    : age < 180
      ? ` It has been tracked only ${Math.max(1, Math.round(age / 30))} months: early users are what first snapshots tend to reward, so start in the first week.`
      : age > 730
        ? ` It has been tracked ${(age / 365).toFixed(1)} years with no token: any reward would likely favour long-time users, so a late start earns little extra.`
        : '';
  const scale = p.tvl_usd >= 1_000_000_000
    ? `At ${p.tvl_usd >= 1e10 ? '$10B' : `$${(p.tvl_usd / 1e9).toFixed(1)}B`} of TVL, ${usd(capital)} is a rounding error, so only a per-wallet rule can reward it: cover several features, not more money.`
    : `With $${Math.max(1, Math.round(p.tvl_usd / 1e6))}M of TVL, ${usd(capital)} is still a small position: a reward that scales with dollars pays little, so favour what counts wallets and actions.`;
  const plan: FarmStep[] = [
    { text: `Open a wallet used only for this, with the seed phrase kept offline. Fund it with ${usd(capital)} and a gas reserve of ${usd(g * 10)} ${where}.`, cost: `${usd(g * 2)} of gas to fund it`, time: '10 minutes' },
    { text: `Reach ${p.name} through the link on its DefiLlama listing, not a search ad. Read what its docs say counts toward rewards. ${peerText}`, cost: 'nothing', time: '20 minutes' },
    { text: `${momentum}${maturity} ${scale}`, cost: 'nothing', time: '10 minutes' },
    { text: open, cost: `${usd(capital)} of capital and ${usd(g * 3)} of gas`, time: '15 minutes' },
    { text: second, cost: `about ${usd(g * 3)} of gas`, time: '15 minutes' },
    ...(p.chains.length >= 3 ? [{ text: `${p.name} counts TVL on ${p.chains.length} chains. Make one small deposit of about ${usd(capital / 10)} on a second chain it supports, so the wallet is seen across chains.`, cost: `about ${usd(g * 4)} of gas, plus a bridge fee of a few dollars`, time: '20 minutes' }] : []),
    { text: `Make one qualifying action a week for ${weeks} weeks: a deposit, a swap, a vote or a claim of the protocol's own points.`, cost: `${usd(weekly)} of gas a week, ${usd(weekly * weeks)} in all`, time: '10 minutes a week' },
    { text: `Hold the position for ${days} days, so it sits inside more than one snapshot. Withdraw only after the window, or after the protocol publishes a snapshot date.`, cost: `${usd(capital)} stays at risk, and earns the pool's own yield`, time: `${days} days` },
    { text: `Revoke token approvals when done, never sign a claim from a link in a message, and keep a log of each transaction. One wallet is the plan: splitting it across many wallets is what reward filters look for.`, cost: `${usd(g)} of gas to revoke`, time: '15 minutes' },
  ];
  const total = g * (plan.length - 1) + weekly * weeks;
  return { plan, capital, gas: Math.round(total * 100) / 100, days, chain };
}

/** A step as one string within the gate's 20 to 600 characters: its action, then its cost and time. */
export function stepText(step: FarmStep): string {
  const s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  return s.length > 600 ? `${s.slice(0, 596)}...` : s;
}

/** The ranked board and the data the dashboard renders, from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { global, comps, live, slope, refTvl } = buildComps(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is a row.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: candidates below the floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isCandidate(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || byText(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const comp = p.category === null ? undefined : comps.get(p.category);
    const multiple = comp === undefined ? global : comp.multiple;
    const size = sizeMultiplier(p.tvl_usd, refTvl, slope);
    const growth = growthMultiplier(p.change_7d);
    const quiet = quietTimeMultiplier(age);
    const reach = reachMultiplier(p.chains.length);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * size * growth * quiet * reach));
    return { p, age, comp, multiple, size, growth, quiet, reach, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || byText(a.p.slug, b.p.slug));

  const board: BoardRow[] = [];
  const rows: RadarData['rows'] = [];
  scored.forEach((s, i) => {
    const farm = farmPlan(s.p, s.age, s.comp);
    const row = {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: null,
      listed_at: s.p.listed_at,
      age_days: s.age,
      token_status: 'pre-token' as const,
      on_watchlist: watch.has(s.p.slug),
      implied_value_usd: s.implied,
      value_to_tvl: round4(s.implied / Math.max(1, s.p.tvl_usd)),
      model: {
        category_multiple: s.multiple,
        comp_peers: s.comp?.peers ?? 0,
        size_multiplier: round4(s.size),
        growth_multiplier: round4(s.growth),
        quiet_time_multiplier: round4(s.quiet),
        reach_multiplier: round4(s.reach),
      },
      farm_capital_usd: farm.capital,
      farm_gas_usd: farm.gas,
      farm_days: farm.days,
    };
    board.push({ ...row, farm_steps: farm.plan.map(stepText) });
    rows.push({ ...row, plan: farm.plan });
  });

  const liveRows: LiveRow[] = [...live]
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || byText(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, change_7d: p.change_7d, mcap_to_tvl: round4(p.mcap_usd! / Math.max(1, p.tvl_usd)) }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    global_multiple: global,
    size_slope: slope,
    size_ref_tvl: Math.round(refTvl),
    watchlist_size: snapshot.watchlist.length,
    protocol_count: snapshot.protocols.length,
    pre_token_count: snapshot.protocols.filter(isPreToken).length,
    live_count: live.length,
    rows,
    comps: [...comps.values()].sort((a, b) => b.peers - a.peers || byText(a.category, b.category)),
    live: liveRows,
  };
  return { board, radar };
}

/** The dashboard's data file: the page reads window.RADAR, so it needs no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board has ${board.length} rows, at least 100 are needed`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const invented = board.filter((r) => !known.has(r.slug));
  if (invented.length > 0) return `${invented.length} slugs are not in the snapshot: ${invented.slice(0, 3).map((r) => r.slug).join(', ')}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${i + 1} has rank ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  return null;
}
