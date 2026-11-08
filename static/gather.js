/* =========================================================================
   Database connection + Requirements Gathering views
   The connection string is sent to the Flask server only, which saves it in the
   OS credential store when "Remember" is on — it is never stored in the browser.
   Only harmless UI state (last tab, last site searched) uses localStorage.
   ========================================================================= */
function lsGet(key){ try{ return JSON.parse(localStorage.getItem(key)); }catch(e){ return null; } }
function lsSet(key, value){ try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){ /* storage unavailable */ } }

function esc(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
async function api(url, body){
  const res = await fetch(url, body === undefined ? {} : {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  let data = {};
  try{ data = await res.json(); }catch(e){ /* non-JSON error page */ }
  if(!res.ok) throw new Error(data.error || ('Server returned ' + res.status));
  return data;
}

/* ============================= VIEW SWITCHING ============================= */
function showView(name){
  document.body.dataset.view = name;
  ['builder','database','gather'].forEach(v=>{
    document.getElementById('view-' + v).hidden = (v !== name);
  });
  document.querySelectorAll('.nav-btn').forEach(b=> b.classList.toggle('active', b.dataset.view === name));
  lsSet('rsView', name);
  if(name === 'gather') maybeRestoreSite();
}

/* ============================= DATABASE ============================= */
let dbConnected = false;
function setConnected(on){
  dbConnected = on;
  document.getElementById('connDot').classList.toggle('on', on);
  document.getElementById('dbDisconnectBtn').hidden = !on;
}
function setMsg(id, text, kind){
  const el = document.getElementById(id);
  el.textContent = text || '';
  el.className = 'conn-msg' + (kind ? ' ' + kind : '');
}
/* Shows whether a connection is saved on this computer (password masked). */
function renderSaved(d){
  const el = document.getElementById('dbSaved');
  const input = document.getElementById('mongoUri');
  // Hosted mode: the server owns the connection, so hide every connect control.
  const managed = !!d.managed;
  [input.closest('.field'), document.getElementById('dbRemember').closest('.remember-row'),
   document.getElementById('dbConnectBtn'), document.getElementById('dbDisconnectBtn')]
    .forEach(n=>{ if(n) n.style.display = managed ? 'none' : ''; });
  if(managed){
    el.hidden = false;
    el.innerHTML = '&#128274; The database connection is managed by the server (read-only): <code>' + esc(d.masked) + '</code>';
    return;
  }
  if(d.saved){
    el.hidden = false;
    el.innerHTML = '&#128274; Saved connection: <code>' + esc(d.masked) + '</code>';
    input.placeholder = 'Leave empty to use the saved connection, or paste a new one';
  }else{
    el.hidden = true;
    input.placeholder = 'mongodb+srv://user:password@cluster.mongodb.net/';
  }
}
async function dbConnect(){
  const input = document.getElementById('mongoUri');
  const btn = document.getElementById('dbConnectBtn');
  btn.disabled = true;
  setMsg('dbMsg', 'Connecting…');
  try{
    const data = await api('/api/db/connect', { uri: input.value, remember: document.getElementById('dbRemember').checked });
    input.value = '';   // don't leave the credentials sitting in the page
    setConnected(true);
    renderSaved(data);
    renderChecks(data.checks || []);
    if(data.warning) setMsg('dbMsg', data.warning, 'err');
    else setMsg('dbMsg', data.saved ? 'Connected and saved.' : 'Connected.', 'ok');
    maybeRestoreSite();
  }catch(err){
    setMsg('dbMsg', err.message, 'err');
  }finally{
    btn.disabled = false;
  }
}
async function dbDisconnect(){
  try{ await api('/api/db/disconnect', {}); }catch(e){ /* ignore */ }
  setConnected(false);
  renderSaved({ saved:false });
  setMsg('dbMsg', 'Disconnected and saved connection removed.');
  document.getElementById('dbChecks').hidden = true;
}
function renderChecks(checks){
  const box = document.getElementById('dbChecks');
  box.hidden = false;
  box.innerHTML = '<div class="card-title">Expected databases &amp; collections</div>' + checks.map(c=>`
    <div class="check-db">${esc(c.database)}${c.error ? ' <span class="flag-chip">' + esc(c.error) + '</span>' : ''}</div>
    ${c.collections.map(x=>`<div class="check-item ${x.found?'ok':'bad'}">${x.found?'&#10003;':'&#10007;'} ${esc(x.name)}${x.found?'':' — not found'}</div>`).join('')}
  `).join('');
}
/* On every page load: ask the server whether it is (re)connected — it reconnects from the saved connection itself. */
api('/api/db/status').then(d=>{
  setConnected(!!d.connected);
  renderSaved(d);
  if(d.connected){
    renderChecks(d.checks || []);
    setMsg('dbMsg', d.saved ? 'Connected (using saved connection).' : 'Connected.', 'ok');
    maybeRestoreSite();
  }else if(d.error){
    setMsg('dbMsg', d.error, 'err');
  }
}).catch(()=>{});

/* ============================= GATHERING ============================= */
async function searchSites(){
  const q = document.getElementById('siteQuery').value.trim();
  document.getElementById('gatherOut').innerHTML = '';
  document.getElementById('siteResults').innerHTML = '';
  if(!q){ setMsg('gatherMsg', 'Enter a site name or ID.', 'err'); return; }
  setMsg('gatherMsg', 'Searching…');
  try{
    const data = await api('/api/gather/search', { q });
    const list = data.results || [];
    if(!list.length){ setMsg('gatherMsg', 'No sites found.', 'err'); return; }
    if(list.length === 1){ setMsg('gatherMsg', ''); loadSite(list[0].id); return; }
    setMsg('gatherMsg', list.length + ' sites match — pick one:');
    document.getElementById('siteResults').innerHTML = list.map(s=>
      `<button type="button" class="site-pick" onclick="loadSite('${esc(s.id)}')">${esc(s.name)}<small>${esc(s.id)}</small></button>`).join('');
  }catch(err){
    setMsg('gatherMsg', err.message, 'err');
  }
}

/* After a refresh, reopen the last site once the gather tab is visible and the DB is connected. */
let siteRestored = false;
function maybeRestoreSite(){
  if(siteRestored || !dbConnected || document.body.dataset.view !== 'gather') return;
  const last = lsGet('rsLastSite');
  if(!last || !last.id) return;
  siteRestored = true;
  document.getElementById('siteQuery').value = last.q || '';
  loadSite(last.id);
}

async function loadSite(id){
  document.getElementById('siteResults').innerHTML = '';
  setMsg('gatherMsg', 'Loading requirements…');
  try{
    const data = await api('/api/gather/site/' + encodeURIComponent(id));
    setMsg('gatherMsg', '');
    renderGather(data);
    lsSet('rsLastSite', { id, q: document.getElementById('siteQuery').value.trim() || data.site.name });
  }catch(err){
    document.getElementById('gatherOut').innerHTML = '';
    setMsg('gatherMsg', err.message, 'err');
  }
}

async function copyReqId(btn, id){
  const old = btn.textContent;
  try{
    await navigator.clipboard.writeText(id);
    btn.textContent = 'Copied';
  }catch(err){
    // clipboard API unavailable (e.g. non-secure context) — fall back to a temp textarea
    const ta = document.createElement('textarea');
    ta.value = id; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); btn.textContent = 'Copied'; }catch(e){ btn.textContent = 'Failed'; }
    ta.remove();
  }
  setTimeout(()=> btn.textContent = old, 1200);
}

/* Fetches a requirement from the DB and opens it in a new Requirement Builder tab. */
async function loadRequirementById(id){
  const json = await api('/api/gather/requirement/' + encodeURIComponent(id.trim()));
  addTab(importRequirementJSON(json));
}
async function loadRequirementFromDb(){
  const input = document.getElementById('dbReqId');
  const id = input.value.trim();
  if(!id){ input.focus(); return; }
  try{
    await loadRequirementById(id);
    input.value = '';
  }catch(err){
    alert('Could not load requirement: ' + err.message);
  }
}
async function openInBuilder(id){
  try{
    await loadRequirementById(id);
    showView('builder');
  }catch(err){
    alert('Could not load requirement: ' + err.message);
  }
}

function hasGroups(phases){ return phases.some(p=> p.groups.length); }

const PHASE_CLASS = { Onboarding:'ph-onboarding', Ongoing:'ph-ongoing', Offboarding:'ph-offboarding' };

function flagChips(o){
  return (o.inactive ? '<span class="flag-chip">inactive/deleted</span>' : '') + (o.found === false ? '<span class="flag-chip">missing</span>' : '');
}

function phasesMarkup(phases){
  const filled = phases.filter(p=> p.groups.length);   // empty phases are not shown
  if(!filled.length) return '<div class="phase-none">No groups assigned.</div>';
  return filled.map(p=>{
    const reqCount = p.groups.reduce((n,g)=> n + g.requirements.length, 0);
    const groups = p.groups.map(g=>`
      <div class="ggroup" data-gname="${esc(g.name.toLowerCase())}">
        <div class="ggroup-head" title="Group ID: ${esc(g.groupId)}">
          <span class="gname">${esc(g.name)}</span><span class="role-chip">${esc(g.role)}</span>${flagChips(g)}
        </div>
        ${g.requirements.length ? `<ul class="greqs">${g.requirements.map(r=>`
          <li data-rname="${esc(r.name.toLowerCase())}">
            <span class="rname">${esc(r.name)}${flagChips(r)}</span>
            ${r.found ? `<span class="rbtns"><button type="button" class="mini-btn" title="Copy requirement ID" onclick="copyReqId(this,'${esc(r.id)}')">Copy ID</button><button type="button" class="mini-btn" title="Open in Requirement Builder" onclick="openInBuilder('${esc(r.id)}')">Open in Builder</button></span>` : ''}
          </li>`).join('')}</ul>`
          : '<div class="phase-none">No requirements in this group.</div>'}
      </div>`).join('');
    return `<div class="phase ${PHASE_CLASS[p.label] || ''}">
      <div class="phase-head"><span class="phase-pill">${esc(p.label)}</span><span class="phase-count">${p.groups.length} group${p.groups.length===1?'':'s'} &middot; ${reqCount} req</span></div>
      ${groups}
    </div>`;
  }).join('');
}

function miniCounts(phases){
  return phases.filter(p=> p.groups.length).map(p=>
    `<span class="mini-count ${PHASE_CLASS[p.label] || ''}" title="${esc(p.label)}: ${p.groups.length} group${p.groups.length===1?'':'s'}">${p.groups.length}</span>`).join('');
}

function entityListMarkup(items, emptyText){
  if(!items.length) return `<div class="gempty">${esc(emptyText)}</div>`;
  const openByDefault = items.length <= 2;
  return items.map(it=>`
    <details class="entity"${openByDefault ? ' open' : ''}>
      <summary><span class="entity-name" title="${esc(it.name)}">${esc(it.name)}</span>${it.extra ? `<span class="entity-extra">${esc(it.extra)}</span>` : ''}${flagChips(it)}<span class="mini-counts">${miniCounts(it.phases)}</span></summary>
      ${phasesMarkup(it.phases)}
    </details>`).join('');
}

/* Excel report: Site / Locations / Disciplines / Programs sheets for the loaded site. */
function toggleReportChecks(btn, on){
  btn.closest('.report-pop').querySelectorAll('input[type=checkbox]').forEach(c=> c.checked = on);
}
async function downloadReport(btn, siteId){
  const menu = btn.closest('.report-menu');
  const picked = [...menu.querySelectorAll('input[type=checkbox]:checked')].map(c=> c.value);
  if(!picked.length){ alert('Choose at least one report.'); return; }
  const old = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Preparing…';
  try{
    // All four selected = default report (no query string needed).
    const qs = picked.length === 4 ? '' : '?sheets=' + picked.join(',');
    const res = await fetch('/api/gather/report/' + encodeURIComponent(siteId) + qs);
    if(!res.ok){
      let msg = 'Server returned ' + res.status;
      try{ msg = (await res.json()).error || msg; }catch(e){ /* not JSON */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = match ? match[1] : 'requirements-report.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }catch(err){
    alert('Report failed: ' + err.message);
  }finally{
    btn.disabled = false; btn.innerHTML = old;
    menu.open = false;
  }
}
// Close the report menu when clicking elsewhere.
document.addEventListener('click', e=>{
  document.querySelectorAll('details.report-menu[open]').forEach(m=>{ if(!m.contains(e.target)) m.open = false; });
});

function toggleAllEntities(open){
  document.querySelectorAll('#gatherOut details.entity').forEach(d=> d.open = open);
}

/* Live filter on requirement / group names across all four cards. */
function filterGather(q){
  q = q.trim().toLowerCase();
  const root = document.getElementById('gatherOut');
  root.querySelectorAll('.ggroup').forEach(gr=>{
    const groupHit = !q || gr.dataset.gname.includes(q);
    let any = groupHit;
    gr.querySelectorAll('li[data-rname]').forEach(li=>{
      const hit = groupHit || li.dataset.rname.includes(q);
      li.hidden = !hit;
      if(hit) any = true;
    });
    gr.hidden = !any;
  });
  root.querySelectorAll('.phase').forEach(ph=>{
    ph.hidden = q && !ph.querySelector('.ggroup:not([hidden])');
  });
  root.querySelectorAll('details.entity').forEach(d=>{
    const visible = !q || d.querySelector('.phase:not([hidden])');
    d.hidden = !visible;
    if(q && visible) d.open = true;
  });
}

function renderGather(d){
  // Only keep locations / disciplines / programs that actually have groups.
  d.locations = d.locations.filter(x=> hasGroups(x.phases));
  d.disciplines = d.disciplines.filter(x=> hasGroups(x.phases));
  d.programs = d.programs.filter(x=> hasGroups(x.phases));

  // Unique group / requirement totals for the banner.
  const groupIds = new Set(), reqIds = new Set();
  const scan = phases => phases.forEach(p=> p.groups.forEach(g=>{ groupIds.add(g.groupId); g.requirements.forEach(r=> reqIds.add(r.id)); }));
  scan(d.siteLevel);
  [d.locations, d.disciplines, d.programs].forEach(list=> list.forEach(it=> scan(it.phases)));

  const card = (cls, title, count, inner) => `
    <section class="gcard ${cls}">
      <div class="gcard-head"><span class="lvl-badge">${title.charAt(0)}</span><span>${title}</span>${count == null ? '' : `<span class="count">${count}</span>`}</div>
      <div class="gcard-body">${inner}</div>
    </section>`;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  document.getElementById('gatherOut').innerHTML = `
    <div class="site-banner">
      <h2>${esc(d.site.name)}</h2>
      <span class="id-chip" title="Site ID">${esc(d.site.id)}<button type="button" class="mini-btn" onclick="copyReqId(this,'${esc(d.site.id)}')">Copy</button></span>
      <span class="stat-chip"><b>${groupIds.size}</b> groups</span>
      <span class="stat-chip"><b>${reqIds.size}</b> unique requirements</span>
      <span class="banner-spacer"></span>
      <input type="text" class="filter-input" placeholder="Filter requirements…" oninput="filterGather(this.value)" />
      <button type="button" class="banner-btn" onclick="toggleAllEntities(true)">Expand all</button>
      <button type="button" class="banner-btn" onclick="toggleAllEntities(false)">Collapse all</button>
      <details class="report-menu">
        <summary class="btn-primary btn-sm">&#8681; Download report <span class="caret">&#9662;</span></summary>
        <div class="report-pop">
          <div class="report-pop-title">Choose reports <span>(Excel sheets)</span></div>
          <label class="rep-opt"><input type="checkbox" value="site" checked><span class="lvl-dot lvl-site"></span>Site level</label>
          <label class="rep-opt"><input type="checkbox" value="locations" checked><span class="lvl-dot lvl-location"></span>Location level</label>
          <label class="rep-opt"><input type="checkbox" value="disciplines" checked><span class="lvl-dot lvl-discipline"></span>Discipline level</label>
          <label class="rep-opt"><input type="checkbox" value="programs" checked><span class="lvl-dot lvl-program"></span>Program level</label>
          <div class="report-pop-actions">
            <button type="button" class="link-btn" onclick="toggleReportChecks(this, true)">All</button>
            <button type="button" class="link-btn" onclick="toggleReportChecks(this, false)">None</button>
            <button type="button" class="btn-primary btn-sm" onclick="downloadReport(this, '${esc(d.site.id)}')">Download</button>
          </div>
        </div>
      </details>
    </div>
    <div class="gather-grid">
      ${card('lvl-site', 'Site level', null, phasesMarkup(d.siteLevel))}
      ${card('lvl-location', 'Location level', plural(d.locations.length, 'location'),
          entityListMarkup(d.locations, 'No locations found for this site.'))}
      ${card('lvl-discipline', 'Discipline level', plural(d.disciplines.length, 'discipline'),
          entityListMarkup(d.disciplines, 'No discipline-level requirements found.'))}
      ${card('lvl-program', 'Program level', plural(d.programs.length, 'program'),
          entityListMarkup(d.programs, 'No program-level requirements found.'))}
    </div>`;
}

/* ============================= STEP RAIL (builder) ============================= */
// Highlights the step currently in view; clicking a link scrolls to it.
(function initStepRail(){
  const links = [...document.querySelectorAll('.rail-link')];
  if(!links.length || !('IntersectionObserver' in window)) return;
  const byId = {};
  links.forEach(a=>{ byId[a.getAttribute('href').slice(1)] = a; });
  const setActive = id => links.forEach(a=> a.classList.toggle('active', a === byId[id]));
  const obs = new IntersectionObserver(entries=>{
    const visible = entries.filter(e=> e.isIntersecting).sort((a,b)=> a.boundingClientRect.top - b.boundingClientRect.top);
    if(visible.length) setActive(visible[0].target.id);
  }, { rootMargin:'-90px 0px -60% 0px', threshold:0 });
  Object.keys(byId).forEach(id=>{ const el = document.getElementById(id); if(el) obs.observe(el); });
  links.forEach(a=> a.addEventListener('click', e=>{
    e.preventDefault();
    const el = document.getElementById(a.getAttribute('href').slice(1));
    if(el) el.scrollIntoView({ behavior:'smooth', block:'start' });
    setActive(a.getAttribute('href').slice(1));
  }));
})();

/* Reopen the tab that was open before the refresh. */
(function restoreView(){
  const v = lsGet('rsView');
  if(v === 'database' || v === 'gather') showView(v);
})();
