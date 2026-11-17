/* Token Radar: renders window.RADAR (written by main.ts from the sealed snapshot). No network, no framework.
   Views: Board (sortable, filterable), Detail (one protocol: how its value is built, and its farm plan),
   Model (the formula and the comparables), Live tokens (the market's own values, kept off the board).
   The state lives in the URL hash, so a view can be linked and reloaded. */
(function () {
  'use strict';
  var R = window.RADAR;
  var rows = R.rows;
  var M = R.model;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var compOf = {};
  R.comps.forEach(function (c) { compOf[c.category] = c; });

  var DEFAULTS = { tab: 'board', q: '', cat: '', chain: '', scope: 'all', min: '0', sort: 'rank', dir: 'asc', p: '' };
  var S = {};
  var $ = function (id) { return document.getElementById(id); };

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function money(n) {
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function pct(v) {
    if (v === null) return '<span class="sm">n/a</span>';
    return '<span class="' + (v >= 0 ? 'up' : 'down') + '">' + (v >= 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function age(d) {
    if (d === null) return 'unknown';
    if (d < 60) return d + ' days';
    if (d < 730) return Math.round(d / 30.4) + ' months';
    return (d / 365).toFixed(1) + ' years';
  }
  function x(n) { return n.toFixed(2) + 'x'; }
  function bar(frac, cls) { return '<div class="bar ' + (cls || '') + '"><i style="width:' + Math.max(2, Math.min(100, frac * 100)).toFixed(1) + '%"></i></div>'; }

  /* ---- state in the hash ---- */
  function readHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    S = {};
    Object.keys(DEFAULTS).forEach(function (k) { S[k] = p.has(k) ? p.get(k) : DEFAULTS[k]; });
    if (!['board', 'detail', 'model', 'live'].includes(S.tab)) S.tab = 'board';
    if (S.p && !bySlug[S.p]) S.p = '';
    if (S.tab === 'detail' && !S.p) S.tab = 'board';
  }
  function writeHash(replace) {
    var p = new URLSearchParams();
    Object.keys(DEFAULTS).forEach(function (k) { if (S[k] !== DEFAULTS[k]) p.set(k, S[k]); });
    var h = '#' + p.toString();
    if (replace) history.replaceState(null, '', h); else location.hash = h;
  }
  function go(patch) { Object.assign(S, patch); writeHash(false); }

  /* ---- the filtered, sorted list ---- */
  var KEYS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    chg: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
    age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    val: function (r) { return r.implied_value_usd; },
    mult: function (r) { return r.value_to_tvl; },
    cost: function (r) { return r.farm_gas_usd; }
  };
  function visible() {
    var q = S.q.trim().toLowerCase();
    var min = Number(S.min) || 0;
    var list = rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      if (S.cat && (r.category || 'No category') !== S.cat) return false;
      if (S.chain && r.chains.indexOf(S.chain) < 0) return false;
      if (S.scope === 'watch' && !r.on_watchlist) return false;
      if (S.scope === 'below' && r.on_watchlist) return false;
      return r.tvl_usd >= min;
    });
    var key = KEYS[S.sort] || KEYS.rank;
    var d = S.dir === 'desc' ? -1 : 1;
    return list.sort(function (a, b) { var A = key(a), B = key(b); return (A < B ? -1 : A > B ? 1 : a.rank - b.rank) * d; });
  }

  /* ---- shell ---- */
  function tabs() {
    var t = [['board', 'Board'], ['model', 'Model'], ['live', 'Live tokens']];
    $('tabs').innerHTML = t.map(function (e) {
      var on = S.tab === e[0] || (S.tab === 'detail' && e[0] === 'board');
      return '<button type="button" data-tab="' + e[0] + '"' + (on ? ' aria-current="page"' : '') + '>' + e[1] + '</button>';
    }).join('');
  }
  function chrome() {
    $('sub').textContent = 'Pre-token protocols ranked by implied launch value. Snapshot of ' + R.as_of + ', model ' + R.model_version + '.';
    $('foot').innerHTML = 'Implied value is this entry\'s own estimate from the snapshot\'s figures, never make.fun\'s. It says nothing about whether or when a protocol issues a token, and nothing here is financial advice. Source: ' + esc(R.source) + '.';
  }

  /* ---- board ---- */
  function boardView() {
    var total = rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var cats = {};
    rows.forEach(function (r) { var c = r.category || 'No category'; cats[c] = (cats[c] || 0) + r.implied_value_usd; });
    var order = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; });
    var top = order.slice(0, 4);
    var chains = {};
    rows.forEach(function (r) { r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
    var chainList = Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a] || (a < b ? -1 : 1); }).slice(0, 24);
    var mins = [['0', 'Any TVL'], ['20000000', 'TVL $20M+'], ['50000000', 'TVL $50M+'], ['100000000', 'TVL $100M+'], ['500000000', 'TVL $500M+'], ['1000000000', 'TVL $1B+']];
    var watchRows = rows.filter(function (r) { return r.on_watchlist; }).length;
    $('view').innerHTML =
      '<div class="stats">' +
      '<div class="stat"><span>Ranked</span><b>' + rows.length + '</b> <small>of ' + R.pre_token_count + ' with no token</small></div>' +
      '<div class="stat"><span>Watchlist covered</span><b>' + watchRows + '/' + R.watchlist_size + '</b> <small>every slug</small></div>' +
      '<div class="stat"><span>Implied value, all rows</span><b>' + money(total) + '</b></div>' +
      '<div class="stat"><span>Live-token comparables</span><b>' + R.live_count + '</b> <small>' + R.comps.length + ' categories</small></div>' +
      '<div class="stat"><span>Median market cap / TVL</span><b>' + x(R.global_multiple) + '</b> <small>where a token trades</small></div>' +
      '</div>' +
      '<div class="shares" aria-label="Where the implied value sits, by category">' + top.map(function (c) {
        return '<button type="button" class="share" data-cat="' + esc(c) + '" aria-pressed="' + (S.cat === c) + '"><div class="row"><span>' + esc(c) + '</span><b>' + money(cats[c]) + '</b></div>' + bar(cats[c] / cats[order[0]]) + '</button>';
      }).join('') + '</div>' +
      '<div class="controls">' +
      '<input id="q" type="search" placeholder="Search a protocol, category or chain" aria-label="Search" value="' + esc(S.q) + '">' +
      '<select id="cat" aria-label="Category"><option value="">All categories</option>' + order.map(function (c) { return '<option' + (S.cat === c ? ' selected' : '') + ' value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="chain" aria-label="Chain"><option value="">All chains</option>' + chainList.map(function (c) { return '<option' + (S.chain === c ? ' selected' : '') + ' value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="scope" aria-label="Scope">' + [['all', 'Whole board'], ['watch', 'Watchlist only'], ['below', 'Below the floor only']].map(function (o) { return '<option' + (S.scope === o[0] ? ' selected' : '') + ' value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select>' +
      '<select id="min" aria-label="Minimum TVL">' + mins.map(function (o) { return '<option' + (S.min === o[0] ? ' selected' : '') + ' value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn" id="reset">Reset</button><span class="count" id="count"></span></div>' +
      '<div class="tablewrap" id="results"></div>';
    results();
  }
  function th(key, label, cls) {
    var on = S.sort === key;
    return '<th class="' + (cls || '') + '" aria-sort="' + (on ? (S.dir === 'desc' ? 'descending' : 'ascending') : 'none') + '"><button type="button" data-sort="' + key + '">' + label + '</button></th>';
  }
  function results() {
    var list = visible();
    var top = list.length ? Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) : 1;
    $('count').textContent = list.length + ' of ' + rows.length + ' rows';
    if (!list.length) { $('results').innerHTML = '<div class="empty">No protocol matches these filters. <button type="button" class="btn" data-act="reset">Reset the filters</button></div>'; return; }
    $('results').innerHTML = '<table><thead><tr>' + th('rank', 'Rank', 'num') + th('name', 'Protocol') + th('tvl', 'TVL', 'num') + th('chg', '7d TVL', 'num') + th('age', 'No token for', 'num') + th('val', 'Implied value', '') + th('mult', 'Value / TVL', 'num') + th('cost', 'Farm gas', 'num') + '</tr></thead><tbody>' +
      list.map(function (r) {
        return '<tr tabindex="0" data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>' +
          '<td><span class="nm">' + esc(r.name) + '</span>' + (r.on_watchlist ? '<span class="pill w">watchlist</span>' : '') + '<span class="sm">' + esc((r.category || 'No category') + ' · ' + r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '')) + '</span></td>' +
          '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + pct(r.change_7d) + '</td><td class="num">' + age(r.age_days) + '</td>' +
          '<td class="valcell"><b class="up">' + money(r.implied_value_usd) + '</b>' + bar(r.implied_value_usd / top) + '</td>' +
          '<td class="num">' + x(r.value_to_tvl) + '</td><td class="num">' + (r.farm_gas_usd < 10 ? '$' + r.farm_gas_usd.toFixed(2) : '$' + Math.round(r.farm_gas_usd)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---- detail ---- */
  function factor(label, val, why, frac) {
    return '<div class="fx"><span class="lab">' + label + '</span><span class="val">' + val + '</span><span class="why">' + why + '</span>' + bar(frac) + '</div>';
  }
  function detailView() {
    var r = bySlug[S.p];
    var list = visible();
    var at = list.findIndex(function (e) { return e.slug === r.slug; });
    var prev = at > 0 ? list[at - 1] : null;
    var next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;
    var m = r.model;
    var comp = r.category ? compOf[r.category] : null;
    var growthText = r.change_7d === null ? 'No seven-day figure is reported, so growth counts as flat.' : 'TVL moved ' + r.change_7d.toFixed(1) + '% in seven days, held between ' + M.growth_floor + '% and +' + M.growth_cap + '%.';
    var quietText = r.age_days === null ? 'DefiLlama gives no listing date: the model assumes ' + M.unknown_age_days + ' days.' : 'Tracked for ' + age(r.age_days) + ' with no token. Rewards build up for two years, then the wait starts to count against a launch.';
    var plan = r.plan.map(function (s) {
      return '<li>' + esc(s.text) + '<div class="chips"><span class="chip">cost: ' + esc(s.cost) + '</span><span class="chip t">time: ' + esc(s.time) + '</span></div></li>';
    }).join('');
    $('view').innerHTML =
      '<div class="dhead"><button type="button" class="back" data-act="back">← Board</button><h2>' + esc(r.name) + '</h2>' +
      '<span class="pill' + (r.on_watchlist ? ' w' : '') + '">' + (r.on_watchlist ? 'watchlist' : 'below the floor') + '</span><span class="pill">' + esc(r.category || 'No category') + '</span><span class="grow"></span>' +
      '<div class="navs"><button type="button" class="back" data-go="' + (prev ? esc(prev.slug) : '') + '"' + (prev ? '' : ' disabled') + '>← Previous</button><button type="button" class="back" data-go="' + (next ? esc(next.slug) : '') + '"' + (next ? '' : ' disabled') + '>Next →</button></div></div>' +
      '<div class="grid2"><div>' +
      '<div class="card"><h3>Implied launch value, rank ' + r.rank + ' of ' + rows.length + '</h3><div class="big">' + money(r.implied_value_usd) + '</div>' +
      '<div class="kpis"><div><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div><div><span>7d TVL</span><b>' + pct(r.change_7d) + '</b></div><div><span>No token for</span><b>' + age(r.age_days) + '</b></div><div><span>Chains</span><b>' + r.chains.length + '</b></div></div>' +
      '<p class="note">' + esc(r.chains.slice(0, 6).join(', ')) + (r.chains.length > 6 ? ' and ' + (r.chains.length - 6) + ' more' : '') + '. The snapshot records no token for it; a protocol may still have one its record does not carry.</p></div>' +
      '<div class="card"><h3>How the value is built</h3>' +
      factor('TVL', money(r.tvl_usd), 'The protocol\'s own total value locked in the snapshot.', 1) +
      factor('x Category multiple', x(m.category_multiple), comp ? 'Live ' + esc(r.category) + ' protocols trade at a median ' + x(comp.median) + ' of TVL across ' + comp.peers + (comp.peers === 1 ? ' peer' : ' peers') + ' (' + esc(comp.examples.join(', ')) + '), shrunk toward the all-category median ' + x(R.global_multiple) + (comp.peers < 3 ? ', and pulled hard toward it because the category is thin' : '') + '.' : 'No live peers in this category: the all-category median ' + x(R.global_multiple) + ' applies.', m.category_multiple / M.multiple_cap) +
      factor('x Growth', x(m.growth_multiplier), growthText, (m.growth_multiplier - 0.75) / 0.75) +
      factor('x Quiet time', x(m.quiet_time_multiplier), quietText, (m.quiet_time_multiplier - 0.45) / 0.75) +
      factor('x Reach', x(m.reach_multiplier), r.chains.length + ' chains counted: each extra chain adds ' + (M.reach_step * 100) + '%, up to ' + M.reach_max_extra_chains + ' extra.', (m.reach_multiplier - 1) / 0.15) +
      '<div class="result"><span>= Implied value (' + x(r.value_to_tvl) + ' of TVL)</span><b>' + money(r.implied_value_usd) + '</b></div></div></div>' +
      '<div><div class="card"><h3>Farm plan: ' + r.plan.length + ' steps</h3>' +
      '<div class="totals"><div><span>Capital at risk</span><b>$' + r.farm_capital_usd + '</b></div><div><span>Gas, all steps</span><b>$' + r.farm_gas_usd.toFixed(2) + '</b></div><div><span>Holding window</span><b>' + r.farm_days + ' days</b></div></div>' +
      '<ol class="plan">' + plan + '</ol>' +
      '<div class="risk">A plan is a guess at what a reward would count, not a promise of one. The capital stays exposed to smart-contract risk for the whole window; use only what you can lose.</div></div></div></div>';
  }

  /* ---- model and live ---- */
  function modelView() {
    $('view').innerHTML =
      '<div class="cols"><div><div class="card"><h3>The model, ' + esc(R.model_version) + '</h3>' +
      '<div class="formula">implied = TVL<br>&nbsp;&nbsp;x category multiple<br>&nbsp;&nbsp;x growth<br>&nbsp;&nbsp;x quiet time<br>&nbsp;&nbsp;x reach</div>' +
      '<p class="note"><b>Category multiple:</b> the median of market cap / TVL over live-token protocols of the same category with at least ' + money(M.comp_min_tvl_usd) + ' of TVL, shrunk toward the all-category median (' + x(R.global_multiple) + ') by ' + M.comp_shrink_peers + ' pseudo-peers, and held between ' + x(M.multiple_floor) + ' and ' + x(M.multiple_cap) + '.</p>' +
      '<p class="note"><b>Growth:</b> 1 + ' + M.growth_weight + ' x the seven-day TVL change, held between ' + M.growth_floor + '% and +' + M.growth_cap + '%, so 0.75x to 1.50x.</p>' +
      '<p class="note"><b>Quiet time:</b> ' + M.quiet_floor + ' + ' + M.quiet_gain + ' x min(age, ' + M.quiet_ramp_days + ') / ' + M.quiet_ramp_days + ', less up to ' + M.quiet_decay + ' once the age passes ' + M.quiet_decay_start_days + ' days, where age is the days DefiLlama has tracked the protocol with no token. This shape is an assumption, not a measurement.</p>' +
      '<p class="note"><b>Reach:</b> 1 + ' + M.reach_step + ' per extra chain, up to ' + M.reach_max_extra_chains + ' extra.</p></div>' +
      '<div class="card"><h3>What the board holds</h3><p class="note">Every protocol on the snapshot\'s watchlist (' + R.watchlist_size + '), then the largest pre-token protocols below the floor of ' + money(R.floor_usd) + ', until the board holds ' + rows.length + '. Bridges, staking receipts, exchanges, wrapped products and versioned pools are left off the early rows, as the watchlist\'s rule leaves them off. No protocol is named anywhere in the model: one function scores every row.</p></div></div>' +
      '<div class="card"><h3>Comparables: live-token protocols by category</h3><table><thead><tr><th>Category</th><th class="num">Peers</th><th class="num">Median</th><th class="num">Used</th></tr></thead><tbody>' +
      R.comps.map(function (c) { return '<tr><td>' + esc(c.category) + '<span class="sm">' + esc(c.examples.join(', ')) + '</span></td><td class="num">' + c.peers + '</td><td class="num">' + x(c.median) + '</td><td class="num valcell"><b class="up">' + x(c.multiple) + '</b>' + bar(c.multiple / M.multiple_cap) + '</td></tr>'; }).join('') +
      '</tbody></table></div></div>';
  }
  function liveView() {
    var top = R.live.length ? R.live[0].mcap_usd : 1;
    $('view').innerHTML = '<div class="card"><h3>Protocols whose token already trades: the market\'s own values, kept off the ranked board</h3>' +
      '<div class="tablewrap" style="max-height:none"><table><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">7d TVL</th><th class="num">Market cap</th><th class="num">Market cap / TVL</th></tr></thead><tbody>' +
      R.live.map(function (p) { return '<tr><td><span class="nm">' + esc(p.name) + '</span><span class="sm">' + esc(p.category || 'No category') + '</span></td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + pct(p.change_7d) + '</td><td class="num valcell"><b>' + money(p.mcap_usd) + '</b>' + bar(p.mcap_usd / top, 'amber') + '</td><td class="num">' + x(p.mcap_to_tvl) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="note">The ' + R.live.length + ' largest of ' + R.live_count + ' live-token protocols by market cap. They set the category multiples; none of them is ranked.</p></div>';
  }

  /* ---- events ---- */
  function render() {
    readHash();
    tabs();
    chrome();
    ({ board: boardView, detail: detailView, model: modelView, live: liveView })[S.tab]();
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab],[data-sort],[data-cat],[data-go],[data-act],tr[data-slug]');
    if (!t) return;
    if (t.dataset.tab) go({ tab: t.dataset.tab, p: '' });
    else if (t.dataset.sort) {
      var k = t.dataset.sort;
      go({ sort: k, dir: S.sort === k ? (S.dir === 'asc' ? 'desc' : 'asc') : (k === 'rank' || k === 'name' ? 'asc' : 'desc') });
    } else if (t.dataset.cat !== undefined && t.classList.contains('share')) go({ cat: S.cat === t.dataset.cat ? '' : t.dataset.cat });
    else if (t.dataset.go) go({ p: t.dataset.go, tab: 'detail' });
    else if (t.dataset.act === 'back') go({ tab: 'board' });
    else if (t.dataset.act === 'reset') go({ q: '', cat: '', chain: '', scope: 'all', min: '0', sort: 'rank', dir: 'asc' });
    else if (t.dataset.slug) go({ p: t.dataset.slug, tab: 'detail' });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.matches('tr[data-slug]')) go({ p: e.target.dataset.slug, tab: 'detail' });
    if (S.tab === 'detail' && !e.target.matches('input,select')) {
      var nav = e.key === 'ArrowLeft' ? 0 : e.key === 'ArrowRight' ? 1 : -1;
      var b = nav >= 0 ? document.querySelectorAll('.navs button')[nav] : null;
      if (b && !b.disabled) b.click();
      if (e.key === 'Escape') go({ tab: 'board' });
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'q') { S.q = e.target.value; writeHash(true); results(); }
  });
  document.addEventListener('change', function (e) {
    var id = e.target.id;
    if (['cat', 'chain', 'scope', 'min'].indexOf(id) >= 0) { var p = {}; p[id] = e.target.value; go(p); }
  });
  window.addEventListener('hashchange', render);
  render();
  $('view').removeAttribute('aria-busy');
})();
