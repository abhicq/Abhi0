// RankPilot Local — single-page dashboard (vanilla JS, no build step).
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }));
const when = (s) => (s ? new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z').toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const stars = (n) => '★'.repeat(n || 0) + '☆'.repeat(5 - (n || 0));

const state = { token: localStorage.getItem('rp_token'), me: null, locations: [], locId: localStorage.getItem('rp_loc'), meta: null };

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { logout(); throw new Error('Session expired'); }
  if (!r.ok) {
    const err = new Error(data.error || r.statusText);
    if (r.status === 402) err.message += ' — top up credits or upgrade your plan.';
    throw err;
  }
  return data;
}

function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = 'toast'), 3800);
}

/** Wrap a button action: disables while running, toasts errors, refreshes credits. */
async function act(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); await refreshMe(); return r; }
  catch (e) { toast(e.message, true); }
  finally { if (btn) btn.disabled = false; }
}

// ── Auth ────────────────────────────────────────────────────────────────────
let signupMode = true;
$('#authToggle').onclick = (e) => {
  e.preventDefault(); signupMode = !signupMode;
  document.querySelectorAll('.signup-only').forEach((el) => el.classList.toggle('hidden', !signupMode));
  $('#authSubmit').textContent = signupMode ? 'Start free trial' : 'Log in';
  $('#authToggle').textContent = signupMode ? 'Already have an account? Log in' : 'New here? Start a free trial';
};
$('#authForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    const r = await api(signupMode ? '/auth/signup' : '/auth/login', { method: 'POST', body: f });
    state.token = r.token; localStorage.setItem('rp_token', r.token); boot();
  } catch (err) { toast(err.message, true); }
};
function logout() { localStorage.removeItem('rp_token'); state.token = null; $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden'); }
$('#logout').onclick = logout;

// ── Shell ───────────────────────────────────────────────────────────────────
const NAV = [
  ['dashboard', '📊', 'Dashboard'], ['locations', '📍', 'Locations'], ['optimize', '⚡', 'Optimize'],
  ['keywords', '🔑', 'Keywords'], ['posts', '📝', 'Posts'], ['reviews', '⭐', 'Reviews'],
  ['rankmap', '🗺️', 'Rank Map 360°'], ['citations', '🔗', 'Citations'], ['leads', '📞', 'Leads'],
  ['autopilot', '🤖', 'Autopilot'], ['billing', '💳', 'Billing & Value'],
];

async function refreshMe() {
  state.me = await api('/me');
  $('#creditBalance').textContent = fmt(state.me.tenant.credits_balance);
  $('#planName').textContent = `${state.me.tenant.plan_info?.name || state.me.tenant.plan} plan`;
  const ephemeral = state.me.integrations.database === 'ephemeral'
    ? '<span class="chip bad" title="No hosted database configured (TURSO_DATABASE_URL). Data resets on redeploy or cold start.">Demo database — data resets</span> ' : '';
  $('#modeBadges').innerHTML = ephemeral + Object.entries(state.me.integrations).filter(([k, v]) => k !== 'database' && v === 'demo').length
    ? `<span class="chip warn" title="${esc(Object.entries(state.me.integrations).map(([k, v]) => `${k}: ${v}`).join('\n'))}">Demo integrations active</span>` : '<span class="chip ok">All integrations live</span>';
}

async function loadLocations() {
  state.locations = await api('/locations');
  if (!state.locations.find((l) => l.id === state.locId)) state.locId = state.locations[0]?.id || null;
  const sel = $('#locSelect');
  sel.innerHTML = state.locations.length ? state.locations.map((l) => `<option value="${l.id}" ${l.id === state.locId ? 'selected' : ''}>${esc(l.name)} — ${esc(l.city || '')}</option>`).join('') : '<option>No locations yet</option>';
}
$('#locSelect').onchange = (e) => { state.locId = e.target.value; localStorage.setItem('rp_loc', state.locId); route(); };

async function boot() {
  try { await refreshMe(); } catch { return logout(); }
  state.meta = await api('/meta');
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  await loadLocations();
  route();
}
window.addEventListener('hashchange', route);

function route() {
  const page = (location.hash.slice(1).split('?')[0] || 'dashboard');
  $('#nav').innerHTML = NAV.map(([k, i, t]) => `<a href="#${k}" class="${k === page ? 'active' : ''}"><span>${i}</span>${t}</a>`).join('');
  const needsLoc = !['locations', 'billing', 'dashboard'].includes(page);
  if (needsLoc && !state.locId) { $('#view').innerHTML = `<div class="card empty"><h2>Connect your first Google Business Profile</h2><p>Everything starts with a location.</p><a class="btn primary" href="#locations">Connect GBP</a></div>`; return; }
  const v = VIEWS[page] || VIEWS.dashboard;
  $('#view').innerHTML = '<div class="empty">Loading…</div>';
  v().catch((e) => { $('#view').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; });
}

const curLoc = () => state.locations.find((l) => l.id === state.locId);

// ── Charts ──────────────────────────────────────────────────────────────────
function lineChart(rows, series, { h = 180 } = {}) {
  if (!rows.length) return '<div class="empty">No data yet — sync the profile.</div>';
  const w = 640, pad = 28;
  const max = Math.max(1, ...rows.flatMap((r) => series.map((s) => r[s.key] || 0)));
  const x = (i) => pad + (i / Math.max(1, rows.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - (v / max) * (h - pad * 2);
  const paths = series.map((s) => `<path d="${rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[s.key] || 0).toFixed(1)}`).join('')}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round"/>`).join('');
  const ticks = [0, 0.5, 1].map((t) => `<text x="2" y="${y(max * t) + 3}">${Math.round(max * t)}</text><line x1="${pad}" x2="${w - pad}" y1="${y(max * t)}" y2="${y(max * t)}" stroke="currentColor" opacity=".08"/>`).join('');
  const labels = [0, Math.floor(rows.length / 2), rows.length - 1].map((i) => `<text x="${x(i) - 14}" y="${h - 8}">${rows[i].date.slice(5)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="color:var(--ink)">${ticks}${paths}${labels}</svg>
    <div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>`;
}

function ring(score) {
  const c = 2 * Math.PI * 50, color = score >= 80 ? 'var(--ok)' : score >= 55 ? 'var(--warn)' : 'var(--bad)';
  return `<svg class="score-ring" viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--chip)" stroke-width="12"/>
    <circle cx="60" cy="60" r="50" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(c * score) / 100} ${c}" transform="rotate(-90 60 60)"/>
    <text x="60" y="68" text-anchor="middle" style="font-size:28px;font-weight:800;fill:var(--ink)">${score}</text></svg>`;
}

const rankColor = (r) => (!r ? '#6b7280' : r <= 3 ? 'var(--r1)' : r <= 7 ? 'var(--r2)' : r <= 10 ? 'var(--r3)' : r <= 15 ? 'var(--r4)' : 'var(--r5)');

// ── Views ───────────────────────────────────────────────────────────────────
const VIEWS = {};

VIEWS.dashboard = async () => {
  const days = 30;
  const ov = await api(`/analytics/overview?days=${days}${state.locId ? '' : ''}`);
  const L = ov.leads; const g = L.google || {}; const t = L.tracked || {};
  const growth = ov.lead_growth_pct;
  $('#view').innerHTML = `
  <div class="page-head"><div><h1>Results overview</h1><div class="muted">All locations · last ${days} days</div></div><div class="spacer"></div>
    ${state.locations.length ? '' : '<a class="btn primary" href="#locations">Connect GBP</a>'}</div>
  <div class="grid g4">
    <div class="card kpi"><div class="label">Total leads</div><div class="value">${fmt(L.total_leads)}</div><div class="sub">${growth == null ? 'calls · messages · directions' : `<span class="${growth >= 0 ? 'up' : 'down'}">${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)}%</span> vs previous ${days}d`}</div></div>
    <div class="card kpi"><div class="label">Phone calls</div><div class="value">${fmt(L.calls)}</div><div class="sub">${fmt(t.call || 0)} via tracked links</div></div>
    <div class="card kpi"><div class="label">Texts + WhatsApp</div><div class="value">${fmt(L.messages)}</div><div class="sub">WhatsApp ${fmt(t.whatsapp || 0)} · SMS ${fmt(t.sms || 0)} · GBP chat ${fmt(g.BUSINESS_CONVERSATIONS || 0)}</div></div>
    <div class="card kpi"><div class="label">Est. revenue / ROI</div><div class="value">${money(ov.est_revenue)}</div><div class="sub">${ov.roi_multiple ? `<b class="up">${ov.roi_multiple}× ROI</b> on ${money(ov.plan_cost)}/mo` : 'Upgrade to track ROI'}${ov.cost_per_lead ? ` · $${ov.cost_per_lead.toFixed(2)}/lead` : ''}</div></div>
  </div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card" style="grid-column: span 2"><h2>Lead actions per day (Google + tracked)</h2>${lineChart(L.daily, [{ key: 'calls', label: 'Calls', color: '#3b5bfd' }, { key: 'messages', label: 'Messages', color: '#12b76a' }, { key: 'directions', label: 'Directions', color: '#f79009' }, { key: 'website', label: 'Website', color: '#a855f7' }])}</div>
    <div class="card"><h2>Locations</h2><div class="list">${state.locations.map((l) => `
      <div class="item"><div class="row"><b>${esc(l.name)}</b><span class="fit chip ${l.score >= 80 ? 'ok' : l.score >= 55 ? 'warn' : 'bad'}">Score ${l.score ?? '—'}</span></div>
      <div class="meta"><span>${esc(l.city || '')}</span><span>Leads ${fmt(l.leads_30d)}</span>${l.last_scan ? `<span>SoLV ${l.last_scan.solv}% "${esc(l.last_scan.keyword)}"</span>` : ''}</div></div>`).join('') || '<div class="muted">No locations yet.</div>'}</div></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h2>Credit usage (30d)</h2>${ov.usage.length ? `<table><tr><th>Action</th><th>Runs</th><th>Credits</th></tr>${ov.usage.map((u) => `<tr><td>${esc(u.label)}</td><td>${fmt(u.events)}</td><td>${fmt(u.credits)}</td></tr>`).join('')}</table>` : '<div class="muted">No usage yet.</div>'}
      <div class="muted small" style="margin-top:8px">Balance: <b>${fmt(ov.credits.balance)}</b> credits</div></div>
    <div class="card"><h2>Automation activity</h2><div class="list">${ov.activity.map((a) => `<div class="small"><span class="chip">${esc(a.kind)}</span> ${esc(a.message)} <span class="muted">· ${when(a.created_at)}</span></div>`).join('') || '<div class="muted">Nothing yet.</div>'}</div></div>
  </div>`;
};

VIEWS.locations = async () => {
  const conns = await api('/google/connections');
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  if (params.get('error')) toast(params.get('error'), true);
  $('#view').innerHTML = `
  <div class="page-head"><div><h1>Locations</h1><div class="muted">Connect Google Business Profiles or add a business manually.</div></div><div class="spacer"></div>
    <button class="btn primary" id="connect">Connect Google Business Profile</button><button class="btn" id="connectDemo">Use demo GBP account</button></div>
  <div class="grid g2">
    <div class="card"><h2>Your locations</h2><div class="list">${state.locations.map((l) => `
      <div class="item"><div class="row"><b>${esc(l.name)}</b><span class="fit chip">${esc(l.primary_category || l.industry)}</span></div>
      <div class="meta"><span>${esc([l.address, l.city, l.region].filter(Boolean).join(', '))}</span><span>${esc(l.phone || 'no phone')}</span><span>${l.gbp_location ? 'GBP linked' : 'Manual'}</span><span>Synced ${when(l.last_synced_at)}</span></div>
      <div class="row" style="margin-top:8px"><button class="btn small fit" data-sync="${l.id}">Sync now</button><button class="btn small fit" data-edit="${l.id}">Edit details</button><button class="btn small ghost fit" data-del="${l.id}">Remove</button></div></div>`).join('') || '<div class="muted">No locations yet.</div>'}</div></div>
    <div class="card" id="importBox"><h2>Import from Google</h2>${conns.length ? `<select id="connSel">${conns.map((c) => `<option value="${c.id}">${esc(c.google_email)} (${c.mode})</option>`).join('')}</select><div id="remoteList" class="list" style="margin-top:10px"></div>` : '<div class="muted">Connect a Google account to list your profiles.</div>'}</div>
  </div>
  <div class="card" style="margin-top:16px"><h2 id="formTitle">Add a business manually</h2>
    <form id="locForm" class="grid g3">
      <label>Business name<input name="name" required></label>
      <label>Nature of business<select name="industry">${state.meta.industries.map((i) => `<option value="${i.key}">${esc(i.label)}</option>`).join('')}</select></label>
      <label>Primary GBP category<input name="primary_category" placeholder="e.g. Plumber"></label>
      <label>Phone<input name="phone" placeholder="+1 512 555 0100"></label>
      <label>WhatsApp number<input name="whatsapp" placeholder="defaults to phone"></label>
      <label>Website<input name="website" placeholder="https://"></label>
      <label>Street address<input name="address"></label>
      <label>City<input name="city" required></label>
      <label>State / Region<input name="region"></label>
      <label>Country (ISO)<input name="country" value="US"></label>
      <label>Latitude<input name="lat" type="number" step="any" required></label>
      <label>Longitude<input name="lng" type="number" step="any" required></label>
      <label>Service areas (comma separated)<input name="service_areas"></label>
      <label>Average lead value ($)<input name="avg_lead_value" type="number" value="150"></label>
      <label>Close rate (0-1)<input name="close_rate" type="number" step="0.05" value="0.3"></label>
      <div class="row" style="align-items:end"><button class="btn primary" type="submit">Save location</button></div>
    </form></div>`;

  $('#connect').onclick = (e) => act(e.target, async () => {
    const r = await api('/google/connect');
    if (r.mode === 'live') location.href = r.url; else { toast('Google OAuth not configured — connected a demo account'); route(); }
  });
  $('#connectDemo').onclick = (e) => act(e.target, async () => { await api('/google/connect?demo=1'); route(); }, 'Demo account connected');
  const loadRemote = async () => {
    const box = $('#remoteList'); if (!box) return;
    box.innerHTML = '<div class="muted">Loading profiles…</div>';
    const list = await api(`/google/connections/${$('#connSel').value}/locations`);
    box.innerHTML = list.map((r) => `<div class="item"><div class="row"><b>${esc(r.name)}</b>${r.imported ? '<span class="fit chip ok">Imported</span>' : `<button class="btn small primary fit" data-imp="${esc(r.gbp_location)}">Import & optimize</button>`}</div><div class="meta">${esc(r.primary_category || '')} · ${esc(r.city || '')}</div></div>`).join('') || '<div class="muted">No locations on this account.</div>';
    box.querySelectorAll('[data-imp]').forEach((b) => (b.onclick = () => act(b, async () => {
      const r = await api('/google/import', { method: 'POST', body: { connection_id: $('#connSel').value, gbp_locations: [b.dataset.imp] } });
      state.locId = r.imported[0]; localStorage.setItem('rp_loc', state.locId); await loadLocations(); location.hash = 'optimize';
    }, 'Imported — synced reviews & insights, built keywords, ran audit')));
  };
  if ($('#connSel')) { $('#connSel').onchange = loadRemote; loadRemote().catch((e) => toast(e.message, true)); }

  let editing = null;
  document.querySelectorAll('[data-sync]').forEach((b) => (b.onclick = () => act(b, () => api(`/locations/${b.dataset.sync}/sync`, { method: 'POST' }), (r) => `Synced ${r.reviews} reviews, ${r.metrics} datapoints`)));
  document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => confirm('Remove this location and all its data?') && act(b, async () => { await api(`/locations/${b.dataset.del}`, { method: 'DELETE' }); await loadLocations(); route(); }, 'Removed')));
  document.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => {
    const l = state.locations.find((x) => x.id === b.dataset.edit); editing = l.id;
    const f = $('#locForm');
    for (const el of f.elements) if (el.name && l[el.name] !== undefined) el.value = Array.isArray(l[el.name]) ? l[el.name].join(', ') : (l[el.name] ?? '');
    $('#formTitle').textContent = `Edit ${l.name}`; f.scrollIntoView({ behavior: 'smooth' });
  }));
  $('#locForm').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.service_areas = f.service_areas ? f.service_areas.split(',').map((s) => s.trim()).filter(Boolean) : [];
    for (const k of ['lat', 'lng', 'avg_lead_value', 'close_rate']) f[k] = f[k] === '' ? null : Number(f[k]);
    act(e.submitter, async () => {
      const r = editing ? await api(`/locations/${editing}`, { method: 'PATCH', body: f }) : await api('/locations', { method: 'POST', body: f });
      state.locId = r.id; localStorage.setItem('rp_loc', r.id); await loadLocations(); route();
    }, editing ? 'Saved' : 'Location added — keywords built and audit ready');
  };
};

VIEWS.optimize = async () => {
  const l = curLoc();
  const { latest, history } = await api(`/locations/${l.id}/audit`);
  const a = latest || (await api(`/locations/${l.id}/audit`, { method: 'POST' }));
  const pill = (k, lbl) => `<div><div class="row"><span>${lbl}</span><b class="fit">${a.pillars[k] ?? 0}</b></div><div class="bar"><i style="width:${a.pillars[k] ?? 0}%"></i></div></div>`;
  const action = { optimize: ['Fix with AI (25 cr)', 'ai'], autopilot_posts: ['Enable autopilot posts', 'autopilot'], reply_reviews: ['Auto-reply reviews', 'reviews'], build_citations: ['Build citations', 'citations'], run_scan: ['Run geo-grid', 'rankmap'], target_weak_zones: ['See weak zones', 'rankmap'], generate_keywords: ['Build keywords', 'keywords'], create_tracking_links: ['Create lead links', 'leads'], review_request_links: ['Review request link', 'leads'] };
  $('#view').innerHTML = `
  <div class="page-head"><div><h1>Profile optimization</h1><div class="muted">${esc(l.name)} · scored against Google's local ranking factors</div></div><div class="spacer"></div>
    <button class="btn" id="reaudit">Re-run audit (free)</button><button class="btn primary" id="aiopt">⚡ Generate AI optimization · 25 credits</button></div>
  <div class="grid g3">
    <div class="card" style="display:grid;place-items:center;gap:6px">${ring(a.score)}<b>Local Rank Readiness</b><span class="muted small">${history.length > 1 ? `was ${history[0].score} on ${when(history[0].created_at)}` : 'first audit'}</span></div>
    <div class="card"><h2>Ranking pillars</h2><div class="list">${pill('relevance', 'Relevance')}${pill('prominence', 'Prominence')}${pill('visibility', 'Visibility (geo-grid)')}${pill('conversion', 'Conversion (lead capture)')}</div></div>
    <div class="card"><h2>Biggest wins</h2><div class="list">${a.priorities.slice(0, 5).map((p) => `<div class="small"><b>+${p.potential_points} pts</b> ${esc(p.label)}</div>`).join('') || 'Profile fully optimized 🎉'}</div></div>
  </div>
  <div class="card" style="margin-top:16px"><h2>Checklist</h2>${a.checks.map((c) => {
    const fx = c.fix && action[c.fix.action];
    return `<div class="check-row"><span class="dot" style="background:${c.score >= 0.9 ? 'var(--ok)' : c.score >= 0.5 ? 'var(--warn)' : 'var(--bad)'}"></span>
      <div><b>${esc(c.label)}</b> <span class="chip">${c.pillar}</span><div class="muted small">${esc(c.detail)}</div></div>
      <div>${c.score < 0.9 && fx ? (fx[1] === 'ai' ? `<button class="btn small" data-ai>${fx[0]}</button>` : `<a class="btn small" href="#${fx[1]}">${fx[0]}</a>`) : ''}</div></div>`;
  }).join('')}</div>
  <div id="proposal"></div>`;
  $('#reaudit').onclick = (e) => act(e.target, async () => { await api(`/locations/${l.id}/audit`, { method: 'POST' }); route(); }, 'Audit refreshed');
  const gen = (btn) => act(btn, async () => {
    const p = await api(`/locations/${l.id}/optimize`, { method: 'POST' });
    $('#proposal').innerHTML = `<div class="card" style="margin-top:16px"><div class="page-head"><h2>AI optimization proposal <span class="chip">${p.mode}</span></h2><div class="spacer"></div><button class="btn primary" id="applyOpt">Apply to Google</button></div>
      <div class="grid g2"><label>Description (${p.description.length}/750)<textarea id="optDesc">${esc(p.description)}</textarea></label>
      <div><h3>Secondary categories</h3>${p.secondary_categories.map((c) => `<span class="chip">${esc(c)}</span> `).join('')}<h3 style="margin-top:12px">Photo plan</h3><ul class="small">${p.photo_ideas.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
      <h3>Services (${p.services.length})</h3><div class="table-wrap"><table>${p.services.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td class="muted">${esc(s.description)}</td></tr>`).join('')}</table></div>
      <h3 style="margin-top:12px">FAQs (use on website & posts)</h3>${p.faqs.map((f) => `<div class="small" style="margin-bottom:6px"><b>${esc(f.question)}</b><br>${esc(f.answer)}</div>`).join('')}</div>`;
    $('#proposal').scrollIntoView({ behavior: 'smooth' });
    $('#applyOpt').onclick = (e) => act(e.target, async () => {
      const r = await api(`/locations/${l.id}/optimize/apply`, { method: 'POST', body: { description: $('#optDesc').value, services: p.services, secondary_categories: p.secondary_categories } });
      await loadLocations(); setTimeout(route, 600); return r;
    }, (r) => `Applied (${r.pushed.mode}). New score: ${r.audit.score}`);
  }, 'Proposal ready — review and apply');
  $('#aiopt').onclick = (e) => gen(e.target);
  document.querySelectorAll('[data-ai]').forEach((b) => (b.onclick = () => gen(b)));
};

VIEWS.keywords = async () => {
  const l = curLoc();
  const kws = await api(`/locations/${l.id}/keywords`);
  $('#view').innerHTML = `
  <div class="page-head"><div><h1>Keyword strategy</h1><div class="muted">Generated from the nature of business, services, city & service areas. Autopilot rotates these through posts, replies and scans.</div></div><div class="spacer"></div>
    <button class="btn" id="rebuild">Regenerate (free)</button><button class="btn primary" id="vol">Fetch search volume & CPC · 15 credits</button></div>
  <div class="card"><form id="addKw" class="row"><input name="keyword" placeholder="Add a custom keyword, e.g. tankless water heater austin"><select name="priority" class="fit" style="width:120px"><option value="1">P1 money</option><option value="2">P2</option><option value="3">P3 long tail</option></select><button class="btn primary">Add</button></form></div>
  <div class="card" style="margin-top:16px"><div class="table-wrap"><table><tr><th>Keyword</th><th>Priority</th><th>Intent</th><th>Volume/mo</th><th>CPC</th><th>Lead value</th><th>Tracked</th><th></th></tr>
  ${kws.map((k) => `<tr><td><b>${esc(k.keyword)}</b></td><td><span class="chip ${k.priority === 1 ? 'ok' : ''}">P${k.priority}</span></td><td class="muted">${esc(k.intent || '')}</td><td>${fmt(k.search_volume)}</td><td>${k.cpc ? '$' + k.cpc : '—'}</td>
    <td class="muted small">${k.cpc && k.search_volume ? `${money(k.cpc * k.search_volume * 0.1)}/mo ad-equiv.` : ''}</td>
    <td><input type="checkbox" data-track="${k.id}" ${k.tracked ? 'checked' : ''} style="width:auto"></td>
    <td><a href="#rankmap?kw=${encodeURIComponent(k.keyword)}" class="btn small">Scan</a> <button class="btn small ghost" data-del="${k.id}">✕</button></td></tr>`).join('')}</table></div></div>`;
  $('#rebuild').onclick = (e) => act(e.target, async () => { await api(`/locations/${l.id}/keywords/build`, { method: 'POST' }); route(); }, 'Keywords regenerated');
  $('#vol').onclick = (e) => act(e.target, async () => { await api(`/locations/${l.id}/keywords/build`, { method: 'POST', body: { with_volumes: true } }); route(); }, 'Search volumes updated');
  $('#addKw').onsubmit = (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); act(e.submitter, async () => { await api(`/locations/${l.id}/keywords`, { method: 'POST', body: f }); route(); }, 'Added'); };
  document.querySelectorAll('[data-track]').forEach((c) => (c.onchange = () => act(null, () => api(`/keywords/${c.dataset.track}`, { method: 'PATCH', body: { tracked: c.checked ? 1 : 0 } }))));
  document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => act(b, async () => { await api(`/keywords/${b.dataset.del}`, { method: 'DELETE' }); route(); })));
};

VIEWS.posts = async () => {
  const l = curLoc();
  const [posts, kws] = await Promise.all([api(`/locations/${l.id}/posts`), api(`/locations/${l.id}/keywords`)]);
  const st = { draft: '', scheduled: 'warn', pending_approval: 'warn', published: 'ok', failed: 'bad' };
  $('#view').innerHTML = `
  <div class="page-head"><div><h1>Posts</h1><div class="muted">Keyword-targeted GBP updates & offers with tracked call/WhatsApp CTAs.</div></div><div class="spacer"></div>
    <button class="btn primary" id="fill">🤖 Fill next week's queue</button></div>
  <div class="card"><h2>Create a post with AI · 4 credits</h2><form id="genForm" class="row">
    <select name="keyword"><option value="">Auto-rotate keyword</option>${kws.map((k) => `<option>${esc(k.keyword)}</option>`).join('')}</select>
    <select name="topic_type" class="fit" style="width:140px"><option value="STANDARD">Update</option><option value="OFFER">Offer</option><option value="EVENT">Event</option></select>
    <input name="offer" placeholder="Offer details (optional)"><input name="scheduled_at" type="datetime-local" class="fit" style="width:210px">
    <button class="btn primary">Generate</button></form></div>
  <div class="list" style="margin-top:16px">${posts.map((p) => `
    <div class="card"><div class="row"><span class="fit chip ${st[p.status] || ''}">${p.status.replace('_', ' ')}</span><span class="fit chip">${p.topic_type}</span>${p.keyword ? `<span class="fit muted small">🔑 ${esc(p.keyword)}</span>` : ''}<span class="muted small" style="text-align:right">${p.status === 'published' ? 'Published ' + when(p.published_at) : p.scheduled_at ? 'Scheduled ' + when(p.scheduled_at) : 'Draft'} · ${p.source}</span></div>
    <textarea data-sum="${p.id}" ${p.status === 'published' ? 'readonly' : ''} style="margin-top:8px;min-height:90px">${esc(p.summary)}</textarea>
    <div class="row" style="margin-top:8px"><span class="muted small">CTA: ${esc(p.cta_type || 'none')} ${p.cta_url ? '→ ' + esc(p.cta_url) : ''}</span>${p.error ? `<span class="chip bad">${esc(p.error)}</span>` : ''}
      ${p.status !== 'published' ? `${p.status === 'pending_approval' ? `<button class="btn small fit" data-approve="${p.id}">Approve</button>` : ''}<button class="btn small fit" data-save="${p.id}">Save</button><button class="btn small primary fit" data-pub="${p.id}">Publish now · 1 cr</button><button class="btn small ghost fit" data-del="${p.id}">Delete</button>` : ''}</div></div>`).join('') || '<div class="card empty">No posts yet — generate one or fill the queue.</div>'}</div>`;
  $('#genForm').onsubmit = (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    if (f.scheduled_at) f.scheduled_at = new Date(f.scheduled_at).toISOString().replace('T', ' ').slice(0, 19); else delete f.scheduled_at;
    act(e.submitter, async () => { await api(`/locations/${l.id}/posts/generate`, { method: 'POST', body: f }); route(); }, 'Post generated');
  };
  $('#fill').onclick = (e) => act(e.target, async () => { const r = await api(`/locations/${l.id}/posts/fill-queue`, { method: 'POST' }); route(); return r; }, (r) => `${r.length} posts scheduled`);
  document.querySelectorAll('[data-pub]').forEach((b) => (b.onclick = () => act(b, async () => { await api(`/posts/${b.dataset.pub}`, { method: 'PATCH', body: { summary: $(`[data-sum="${b.dataset.pub}"]`).value } }); await api(`/posts/${b.dataset.pub}/publish`, { method: 'POST' }); route(); }, 'Published to Google')));
  document.querySelectorAll('[data-save]').forEach((b) => (b.onclick = () => act(b, () => api(`/posts/${b.dataset.save}`, { method: 'PATCH', body: { summary: $(`[data-sum="${b.dataset.save}"]`).value } }), 'Saved')));
  document.querySelectorAll('[data-approve]').forEach((b) => (b.onclick = () => act(b, async () => { await api(`/posts/${b.dataset.approve}`, { method: 'PATCH', body: { approve: true } }); route(); }, 'Approved')));
  document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => act(b, async () => { await api(`/posts/${b.dataset.del}`, { method: 'DELETE' }); route(); })));
};

VIEWS.reviews = async () => {
  const l = curLoc();
  const rv = await api(`/locations/${l.id}/reviews`);
  const avg = rv.length ? (rv.reduce((a, r) => a + (r.rating || 0), 0) / rv.length).toFixed(2) : '—';
  const unreplied = rv.filter((r) => r.reply_status !== 'published').length;
  $('#view').innerHTML = `
  <div class="page-head"><div><h1>Reviews</h1><div class="muted">${avg}★ average · ${rv.length} reviews · ${unreplied} awaiting reply</div></div><div class="spacer"></div>
    <a class="btn" href="#leads">Get more reviews</a><button class="btn primary" id="auto">🤖 Auto-reply all · 2 cr each</button></div>
  <div class="list">${rv.map((r) => `<div class="card"><div class="row"><b>${esc(r.reviewer)}</b><span class="stars fit">${stars(r.rating)}</span><span class="muted small" style="text-align:right">${when(r.review_time)}</span></div>
    <p>${esc(r.comment) || '<i class="muted">No text</i>'}</p>
    <label>Owner reply <span class="chip ${r.reply_status === 'published' ? 'ok' : r.reply_status === 'pending_approval' ? 'warn' : ''}">${r.reply_status.replace('_', ' ')}</span><textarea data-reply="${r.id}" style="min-height:70px">${esc(r.reply || '')}</textarea></label>
    <div class="row" style="margin-top:8px"><span></span><button class="btn small fit" data-draft="${r.id}">✍️ AI draft · 2 cr</button><button class="btn small primary fit" data-pub="${r.id}">Publish reply</button></div></div>`).join('') || '<div class="card empty">No reviews synced yet.</div>'}</div>`;
  $('#auto').onclick = (e) => act(e.target, async () => { const r = await api(`/locations/${l.id}/reviews/auto-reply`, { method: 'POST' }); route(); return r; }, (r) => `${r.published} replies published, ${r.held} held for approval`);
  document.querySelectorAll('[data-draft]').forEach((b) => (b.onclick = () => act(b, async () => { const r = await api(`/reviews/${b.dataset.draft}/draft`, { method: 'POST' }); $(`[data-reply="${b.dataset.draft}"]`).value = r.reply; return r; }, (r) => (r.needs_human ? 'Draft ready — needs a human check' : 'Draft ready'))));
  document.querySelectorAll('[data-pub]').forEach((b) => (b.onclick = () => act(b, async () => { await api(`/reviews/${b.dataset.pub}/publish`, { method: 'POST', body: { reply: $(`[data-reply="${b.dataset.pub}"]`).value } }); route(); }, 'Reply published')));
};

VIEWS.rankmap = async () => {
  const l = curLoc();
  const [kws, scans] = await Promise.all([api(`/locations/${l.id}/keywords`), api(`/locations/${l.id}/scans`)]);
  const pre = new URLSearchParams(location.hash.split('?')[1] || '').get('kw');
  const maxGrid = state.me.tenant.plan_info?.maxGrid || 5;
  const sizes = [3, 5, 7, 9, 11, 13, 15].filter((s) => s <= maxGrid);
  $('#view').innerHTML = `
  <div class="page-head"><div><h1>Rank Map 360°</h1><div class="muted">Your Google Maps rank from every direction around the business — find and fix weak zones.</div></div></div>
  <div class="card"><form id="scanForm" class="row">
    <select name="keyword">${kws.filter((k) => k.tracked).map((k) => `<option ${k.keyword === pre ? 'selected' : ''}>${esc(k.keyword)}</option>`).join('')}</select>
    <select name="grid_size" class="fit" style="width:110px">${sizes.map((s) => `<option value="${s}" ${s === Math.min(7, maxGrid) ? 'selected' : ''}>${s}×${s}</option>`).join('')}</select>
    <select name="radius_km" class="fit" style="width:110px">${[1, 2, 3, 5, 8, 12, 20].map((r) => `<option value="${r}" ${r === 5 ? 'selected' : ''}>${r} km</option>`).join('')}</select>
    <button class="btn primary" id="scanBtn">Run scan</button></form><div class="muted small" id="scanCost" style="margin-top:6px"></div></div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card" style="grid-column: span 2"><div id="map"></div>
      <div class="legend" style="margin-top:8px"><span><i style="background:var(--r1)"></i>1-3 (3-pack)</span><span><i style="background:var(--r2)"></i>4-7</span><span><i style="background:var(--r3)"></i>8-10</span><span><i style="background:var(--r4)"></i>11-15</span><span><i style="background:var(--r5)"></i>16-20</span><span><i style="background:#6b7280"></i>20+</span></div></div>
    <div class="grid" style="align-content:start">
      <div class="card" id="scanStats"><div class="muted">Select a scan.</div></div>
      <div class="card"><h2>Scan history</h2><div class="list">${scans.map((s) => `<a class="item" href="#" data-scan="${s.id}" style="color:inherit"><b>${esc(s.keyword)}</b><div class="meta"><span>SoLV ${s.solv}%</span><span>ATRP ${s.atrp}</span><span>${s.grid_size}×${s.grid_size}</span><span>${when(s.created_at)}</span>${s.mode === 'demo' ? '<span class="chip warn">demo</span>' : ''}</div></a>`).join('') || '<div class="muted">No scans yet.</div>'}</div></div>
    </div></div>`;
  const costLbl = () => { const n = Number($('[name=grid_size]').value); $('#scanCost').textContent = `${n * n} grid points × 1 credit = ${n * n} credits`; };
  $('[name=grid_size]').onchange = costLbl; costLbl();
  let map, layer;
  const show = async (sid) => {
    const s = await api(`/scans/${sid}`);
    const center = [s.center.lat, s.center.lng];
    if (window.L) {
      if (!map) { map = L.map('map').setView(center, 12); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map); }
      layer?.remove(); layer = L.layerGroup().addTo(map);
      L.marker(center, { title: s.center.name }).addTo(layer);
      const bounds = [];
      for (const p of s.points) {
        bounds.push([p.lat, p.lng]);
        const icon = L.divIcon({ className: '', html: `<div class="pin" style="background:${rankColor(p.rank)}">${p.rank || '20+'}</div>`, iconSize: [30, 30] });
        L.marker([p.lat, p.lng], { icon }).addTo(layer).bindPopup(`<b>Rank ${p.rank || '20+'}</b><br>Top 3 here:<br>${(p.top || []).map((t, i) => `${i + 1}. ${esc(t.title)}`).join('<br>')}`);
      }
      map.fitBounds(bounds, { padding: [20, 20] });
    } else {
      const n = s.grid_size;
      $('#map').innerHTML = `<svg viewBox="0 0 ${n * 40} ${n * 40}" width="100%" height="100%">${s.points.map((p) => `<circle cx="${p.col * 40 + 20}" cy="${p.row * 40 + 20}" r="16" fill="${rankColor(p.rank)}"/><text x="${p.col * 40 + 20}" y="${p.row * 40 + 24}" text-anchor="middle" style="fill:#fff;font-weight:800;font-size:11px">${p.rank || '20+'}</text>`).join('')}</svg>`;
    }
    const weak = s.points.filter((p) => !p.rank || p.rank > 10).length;
    $('#scanStats').innerHTML = `<h2>"${esc(s.keyword)}"</h2><div class="grid g3">
      <div class="kpi"><div class="label">SoLV</div><div class="value">${s.solv}%</div><div class="sub">in 3-pack</div></div>
      <div class="kpi"><div class="label">ARP</div><div class="value">${s.arp ?? '—'}</div><div class="sub">avg rank found</div></div>
      <div class="kpi"><div class="label">ATRP</div><div class="value">${s.atrp}</div><div class="sub">avg total rank</div></div></div>
      <p class="small">${weak} of ${s.points.length} points rank outside the top 10. ${weak ? 'Autopilot will target this keyword in upcoming posts and replies; add service-area pages + citations near weak zones.' : 'Excellent coverage!'}</p>
      <h3>Competitors owning the 3-pack</h3>${s.competitors.map((c) => `<div class="row small"><span>${esc(c.title)}</span><b class="fit">${c.share_of_3pack}%</b></div><div class="bar" style="margin-bottom:6px"><i style="width:${c.share_of_3pack}%"></i></div>`).join('') || '<div class="muted small">None</div>'}`;
  };
  document.querySelectorAll('[data-scan]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); show(a.dataset.scan); }));
  if (scans[0]) show(scans[0].id);
  $('#scanForm').onsubmit = (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    act($('#scanBtn'), async () => { const s = await api(`/locations/${l.id}/scans`, { method: 'POST', body: f }); await VIEWS.rankmap(); await show(s.id); return s; }, (s) => `Scan complete · ${s.credits_used} credits`);
  };
};

VIEWS.citations = async () => {
  const l = curLoc();
  const c = await api(`/locations/${l.id}/citations`);
  const st = { live: 'ok', queued: 'warn', in_progress: 'warn', submitted: 'warn', rejected: 'bad' };
  $('#view').innerHTML = `
  <div class="page-head"><div><h1>Citation builder</h1><div class="muted">Directories picked for ${esc(l.country)} + your industry. Pay per citation in credits — no bundles you don't need.</div></div><div class="spacer"></div>
    <button class="btn primary" id="order" disabled>Order selected</button></div>
  <div class="grid g4"><div class="card kpi"><div class="label">Recommended</div><div class="value">${c.summary.recommended}</div></div><div class="card kpi"><div class="label">Live</div><div class="value">${c.summary.live}</div></div>
    <div class="card kpi"><div class="label">In progress</div><div class="value">${c.summary.in_progress}</div></div><div class="card kpi"><div class="label">NAP issues</div><div class="value ${c.summary.nap_issues ? 'down' : ''}">${c.summary.nap_issues}</div></div></div>
  <div class="card" style="margin-top:16px"><div class="table-wrap"><table><tr><th></th><th>Directory</th><th>Type</th><th>Authority</th><th>Credits</th><th>Status</th><th>Listing / NAP</th></tr>
  ${c.directories.map((d) => `<tr><td>${!d.citation && !d.managed ? `<input type="checkbox" data-dir="${d.id}" data-cr="${d.credits}" style="width:auto">` : ''}</td>
    <td><b>${esc(d.name)}</b></td><td><span class="chip">${d.relevance}</span> <span class="muted small">${d.tier}</span></td><td>${d.da || '—'}</td><td>${d.managed ? 'included' : fmt(d.credits)}</td>
    <td>${d.managed ? '<span class="chip ok">managed via API</span>' : d.citation ? `<span class="chip ${st[d.citation.status] || ''}">${d.citation.status}</span>` : '<span class="muted">not listed</span>'}</td>
    <td class="small">${d.citation?.listing_url ? `<a href="${esc(d.citation.listing_url)}" target="_blank" rel="noopener">view</a> ` : ''}${d.citation?.nap_match === 0 ? `<span class="chip bad">${esc(d.citation.notes || 'NAP mismatch')}</span>` : d.citation?.nap_match === 1 ? '<span class="chip ok">NAP ✓</span>' : ''}</td></tr>`).join('')}</table></div></div>`;
  const upd = () => { const sel = [...document.querySelectorAll('[data-dir]:checked')]; const cr = sel.reduce((a, x) => a + Number(x.dataset.cr), 0); $('#order').disabled = !sel.length; $('#order').textContent = sel.length ? `Order ${sel.length} citations · ${fmt(cr)} credits` : 'Order selected'; };
  document.querySelectorAll('[data-dir]').forEach((x) => (x.onchange = upd));
  $('#order').onclick = (e) => act(e.target, async () => { const r = await api(`/locations/${l.id}/citations/order`, { method: 'POST', body: { directory_ids: [...document.querySelectorAll('[data-dir]:checked')].map((x) => x.dataset.dir) } }); route(); return r; }, (r) => `${r.ordered.length} citations queued for submission`);
};

VIEWS.leads = async () => {
  const l = curLoc();
  const [links, ov] = await Promise.all([api(`/locations/${l.id}/tracking-links`), api(`/analytics/overview?location_id=${l.id}`)]);
  const g = ov.leads.google || {};
  $('#view').innerHTML = `
  <div class="page-head"><div><h1>Leads: calls, texts & WhatsApp</h1><div class="muted">Every GBP action and every tracked click, attributed and valued.</div></div></div>
  <div class="grid g4">
    <div class="card kpi"><div class="label">Calls</div><div class="value">${fmt(ov.leads.calls)}</div><div class="sub">Google call clicks ${fmt(g.CALL_CLICKS || 0)}</div></div>
    <div class="card kpi"><div class="label">Messages</div><div class="value">${fmt(ov.leads.messages)}</div><div class="sub">SMS + WhatsApp + GBP chat</div></div>
    <div class="card kpi"><div class="label">Directions</div><div class="value">${fmt(g.BUSINESS_DIRECTION_REQUESTS || 0)}</div><div class="sub">Website clicks ${fmt(g.WEBSITE_CLICKS || 0)}</div></div>
    <div class="card kpi"><div class="label">Pipeline value</div><div class="value">${money(ov.est_revenue)}</div><div class="sub">@ ${money(l.avg_lead_value)} × ${Math.round(l.close_rate * 100)}% close</div></div></div>
  <div class="card" style="margin-top:16px"><h2>Tracked lead links</h2><p class="muted small">Use these as GBP post buttons, appointment URL, website buttons, QR codes on vans & invoices, and review requests. Clicks are logged then forwarded instantly.</p>
    <form id="linkForm" class="row"><select name="channel" class="fit" style="width:160px"><option value="whatsapp">WhatsApp</option><option value="call">Call</option><option value="sms">SMS / Text</option></select>
      <input name="label" placeholder="Label e.g. Van QR code"><input name="message" placeholder="Pre-filled message (WhatsApp/SMS)"><button class="btn primary">Create link</button></form>
    <div class="table-wrap" style="margin-top:12px"><table><tr><th>Channel</th><th>Label</th><th>Tracking URL</th><th>Clicks (30d)</th></tr>
      ${links.map((t) => `<tr><td><span class="chip">${t.channel}</span></td><td>${esc(t.label)}</td><td><code>${esc(t.url)}</code> <button class="btn small" data-copy="${esc(t.url)}">Copy</button></td><td><b>${fmt(t.clicks_30d)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No links yet.</td></tr>'}</table></div></div>
  <div class="card" style="margin-top:16px"><h2>Review request link</h2><p class="small muted">Send after every job by SMS/WhatsApp. More fresh reviews = higher prominence.</p>
    <code>https://search.google.com/local/writereview?placeid=${esc(l.place_id || 'YOUR_PLACE_ID')}</code></div>`;
  $('#linkForm').onsubmit = (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); act(e.submitter, async () => { await api(`/locations/${l.id}/tracking-links`, { method: 'POST', body: f }); route(); }, 'Tracking link created'); };
  document.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('Copied'); }));
};

VIEWS.autopilot = async () => {
  const l = (await api(`/locations/${state.locId}`));
  const ap = l.autopilot;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const w = await api('/billing/estimate', { method: 'POST', body: { posts_per_week: ap.posts_per_week, keywords: ap.scan_keywords, grid_size: ap.grid_size, scans_per_month: ap.weekly_scan ? 4 : 0, citations_per_month: 0 } });
  $('#view').innerHTML = `
  <div class="page-head"><div><h1>Autopilot</h1><div class="muted">${esc(l.name)} · runs every few hours: sync → keywords → posts → review replies → geo-grid → audit.</div></div><div class="spacer"></div>
    <button class="btn" id="runNow">Run now</button></div>
  <form id="apForm" class="grid g2">
    <div class="card"><h2>Content & engagement</h2><div class="list">
      <label><span><input type="checkbox" name="enabled" ${ap.enabled ? 'checked' : ''} style="width:auto"> Autopilot enabled</span></label>
      <label>Posts per week<input type="number" name="posts_per_week" min="0" max="7" value="${ap.posts_per_week}"></label>
      <label>Posting days<div class="row">${days.map((d, i) => `<span class="fit"><input type="checkbox" name="day" value="${i}" ${ap.post_weekdays.includes(i) ? 'checked' : ''} style="width:auto"> ${d}</span>`).join('')}</div></label>
      <label>Post time (UTC hour)<input type="number" name="post_hour_utc" min="0" max="23" value="${ap.post_hour_utc}"></label>
      <label>Post button sends leads to<select name="post_cta_channel">${['whatsapp', 'call', 'sms', 'website'].map((c) => `<option ${c === ap.post_cta_channel ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label><span><input type="checkbox" name="approval_required" ${ap.approval_required ? 'checked' : ''} style="width:auto"> Require my approval before posts go live</span></label>
      <label><span><input type="checkbox" name="auto_reply_reviews" ${ap.auto_reply_reviews ? 'checked' : ''} style="width:auto"> Auto-reply to reviews</span></label>
      <label>Auto-publish replies for ratings ≥<select name="auto_reply_min_rating">${[1, 2, 3, 4, 5].map((r) => `<option ${r === ap.auto_reply_min_rating ? 'selected' : ''}>${r}</option>`).join('')}</select></label></div></div>
    <div class="card"><h2>Rank tracking</h2><div class="list">
      <label><span><input type="checkbox" name="weekly_scan" ${ap.weekly_scan ? 'checked' : ''} style="width:auto"> Weekly geo-grid scans</span></label>
      <label>Keywords scanned weekly<input type="number" name="scan_keywords" min="1" max="20" value="${ap.scan_keywords}"></label>
      <label>Grid size<input type="number" name="grid_size" min="3" max="15" step="2" value="${ap.grid_size}"></label>
      <label>Radius (km)<input type="number" name="radius_km" min="1" max="30" value="${ap.radius_km}"></label>
      <div class="item"><b>Estimated autopilot spend: ${fmt(w.workload.total_credits)} credits/month</b><div class="meta">${w.workload.lines.filter((x) => x.qty).map((x) => `<span>${esc(x.label.split('(')[0])}: ${fmt(x.credits)}</span>`).join('')}</div></div>
      <button class="btn primary" type="submit">Save autopilot settings</button></div></div>
  </form>`;
  $('#runNow').onclick = (e) => act(e.target, () => api(`/locations/${l.id}/autopilot/run`, { method: 'POST' }), (r) => `Autopilot ran: ${r.posts ?? 0} posts queued, audit score ${r.audit ?? '—'}`);
  $('#apForm').onsubmit = (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = {
      enabled: fd.has('enabled'), approval_required: fd.has('approval_required'), auto_reply_reviews: fd.has('auto_reply_reviews'), weekly_scan: fd.has('weekly_scan'),
      posts_per_week: Number(fd.get('posts_per_week')), post_weekdays: fd.getAll('day').map(Number), post_hour_utc: Number(fd.get('post_hour_utc')),
      post_cta_channel: fd.get('post_cta_channel'), auto_reply_min_rating: Number(fd.get('auto_reply_min_rating')),
      scan_keywords: Number(fd.get('scan_keywords')), grid_size: Number(fd.get('grid_size')), radius_km: Number(fd.get('radius_km')),
    };
    act(e.submitter, async () => { await api(`/locations/${l.id}/autopilot`, { method: 'PUT', body }); route(); }, 'Autopilot saved');
  };
};

VIEWS.billing = async () => {
  const b = await api('/billing');
  const ok = new URLSearchParams(location.hash.split('?')[1] || '').get('ok');
  if (ok) toast('Payment received — credits added');
  const plans = Object.entries(b.plans).filter(([, p]) => p.priceMonthly);
  $('#view').innerHTML = `
  <div class="page-head"><div><h1>Billing & value</h1><div class="muted">Plan: <b>${esc(b.plans[b.plan]?.name || b.plan)}</b> (${b.plan_status}) · ${fmt(b.balance)} credits · renews ${when(b.renews_at)}</div></div></div>
  <div class="grid g4">${plans.map(([k, p]) => `<div class="card plan ${p.popular ? 'popular' : ''}">${p.popular ? '<span class="badge-pop">Best value</span>' : ''}
    <h2>${p.name}</h2><div class="price">$${p.priceMonthly}<span class="muted small">/mo</span></div><div class="muted small">${fmt(p.credits)} credits · ${p.locations} location${p.locations > 1 ? 's' : ''} · $${(p.priceMonthly / p.credits * 1000).toFixed(2)}/1k credits</div>
    <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    <button class="btn ${b.plan === k ? '' : 'primary'} wide" data-plan="${k}" ${b.plan === k ? 'disabled' : ''}>${b.plan === k ? 'Current plan' : 'Choose ' + p.name}</button></div>`).join('')}</div>
  <div class="card" style="margin-top:16px"><h2>Credit top-ups (never expire while subscribed)</h2><div class="row">${b.topups.map((t) => `<button class="btn" data-topup="${t.id}">${fmt(t.credits)} credits · $${t.priceUsd}</button>`).join('')}</div></div>
  <div class="card" style="margin-top:16px"><h2>Plan finder & ROI calculator</h2><form id="est" class="row">
    <label>Locations<input name="locations" type="number" value="1" min="1"></label><label>Posts / week<input name="posts_per_week" type="number" value="3"></label>
    <label>Keywords tracked<input name="keywords" type="number" value="5"></label><label>Citations / month<input name="citations_per_month" type="number" value="10"></label>
    <label>Avg lead value $<input name="avg_lead_value" type="number" value="150"></label><label>Current leads / mo / loc<input name="baseline_leads" type="number" value="20"></label>
    <button class="btn primary">Calculate</button></form><div id="estOut" style="margin-top:12px"></div></div>
  <div class="card" style="margin-top:16px"><h2>360° value map — what every credit buys</h2><p class="muted small">Real vendor cost vs. what you pay, and which ranking signal each action moves. Higher impact per credit = better ROI.</p>
    <div class="table-wrap"><table><tr><th>Action</th><th>Credits</th><th>Your cost</th><th>Impact</th><th>Moves</th><th>Powered by</th></tr>
    ${b.value_map.filter((v) => v.credits).sort((x, y) => (y.value_per_credit || 0) - (x.value_per_credit || 0)).map((v) => `<tr><td><b>${esc(v.label)}</b><div class="muted small">per ${esc(v.unit)}</div></td><td>${fmt(v.credits)}</td><td>$${v.revenue_usd.toFixed(3)}</td><td>${'●'.repeat(v.impact)}<span class="muted">${'●'.repeat(5 - v.impact)}</span></td><td class="small">${v.drives.map(esc).join(' · ')}</td><td class="muted small">${esc(v.vendor)}</td></tr>`).join('')}</table></div></div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h2>Usage (30 days)</h2>${b.usage_30d.length ? `<table><tr><th>Action</th><th>Runs</th><th>Credits</th></tr>${b.usage_30d.map((u) => `<tr><td>${esc(u.label)}</td><td>${fmt(u.events)}</td><td>${fmt(u.credits)}</td></tr>`).join('')}</table>` : '<div class="muted">No usage yet.</div>'}</div>
    <div class="card"><h2>Credit ledger</h2><div class="table-wrap" style="max-height:320px;overflow:auto"><table><tr><th>When</th><th>Action</th><th>Δ</th><th>Balance</th></tr>${b.ledger.map((x) => `<tr><td class="small">${when(x.created_at)}</td><td class="small">${esc(x.action)}${x.note ? ` <span class="muted">${esc(x.note)}</span>` : ''}</td><td class="${x.delta > 0 ? 'up' : ''}">${x.delta > 0 ? '+' : ''}${fmt(x.delta)}</td><td>${fmt(x.balance_after)}</td></tr>`).join('')}</table></div></div></div>`;
  const go = (btn, body) => act(btn, async () => { const r = await api('/billing/checkout', { method: 'POST', body }); if (r.mode === 'live') location.href = r.url; else route(); return r; }, (r) => (r.mode === 'demo' ? 'Activated (demo billing)' : 'Redirecting to checkout…'));
  document.querySelectorAll('[data-plan]').forEach((x) => (x.onclick = () => go(x, { plan: x.dataset.plan })));
  document.querySelectorAll('[data-topup]').forEach((x) => (x.onclick = () => go(x, { topup: x.dataset.topup })));
  $('#est').onsubmit = (e) => {
    e.preventDefault(); const f = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, Number(v)]));
    act(e.submitter, async () => {
      const r = await api('/billing/estimate', { method: 'POST', body: f });
      $('#estOut').innerHTML = r.recommended ? `<div class="grid g4">
        <div class="kpi"><div class="label">Credits needed / mo</div><div class="value">${fmt(r.credits_needed)}</div></div>
        <div class="kpi"><div class="label">Best plan</div><div class="value">${esc(r.recommended.name)}</div><div class="sub">${money(r.recommended.monthly_total)}/mo${r.recommended.topups_needed ? ` incl. ${r.recommended.topups_needed} top-up` : ''}</div></div>
        <div class="kpi"><div class="label">Projected extra leads</div><div class="value">+${r.roi.extra_leads}</div><div class="sub">/mo at +35% visibility lift</div></div>
        <div class="kpi"><div class="label">Projected ROI</div><div class="value up">${r.roi.roi_multiple}×</div><div class="sub">${money(r.roi.extra_revenue)} extra revenue · pays back after ${r.roi.payback_leads} closed lead(s)</div></div></div>` : '<div class="muted">Contact sales for 40+ locations.</div>';
    });
  };
};

if (state.token) boot(); else { $('#auth').classList.remove('hidden'); }
