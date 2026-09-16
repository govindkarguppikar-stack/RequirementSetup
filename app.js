/* =========================================================================
   Requirement Builder — frontend
   The form + live state live here in the browser, same as before.
   The actual requirement JSON is now built by the Flask backend
   (see /api/build and /api/download in app.py) — this file only
   collects state and renders the UI.
   ========================================================================= */

/* ============================= STATE ============================= */
const defaultState = () => ({
  basic:{ name:'', shortname:'', version:0, categorySelect:'Attestation', categoryCustom:'', active:true, required:true },
  guidelines:{
    studentHTML:'', instructorHTML:'', reviewerHTML:'',
    templates:{ collectionId:'', files:[] },
    samples:{ collectionId:'', useFiles:false, files:[] }
  },
  behavior:{
    standard:{
      requiredTop:false, enabledTop:true, label:'', formId:'', instructorFormId:'',
      text:{required:true,enabled:true,label:'Notes'},
      src:{required:false,enabled:false,label:'Upload Files'},
      resultDate:{required:true,enabled:true,label:'Start Date'},
      expiryType:'none', expiryDays:365,
      expiryLogic:{required:false,enabled:false,label:'Expiration Date'},
      fixedDate:{day:1,month:1,year:2027}
    },
    tb:{
      useCustomsKey:false,
      bloodTest:{ enabled:false, label:'Blood Test Details', formId:'tbBloodTest',
        expiryType:'period', expiryDays:10, fixedDate:{day:1,month:1,year:2027},
        expiryLogic:{required:false,enabled:true,label:'Expiration Date'},
        resultDate:{required:true,enabled:true,label:'Result Date'},
        src:{required:true,enabled:true,label:'Upload'},
        text:{required:false,enabled:true,label:'Notes'},
        testType:{required:true,enabled:true,label:'Test Type'} },
      chestXray:{ enabled:false, label:'Chest X-Ray Details', formId:'tbChestXRay',
        expiryType:'period', expiryDays:20, fixedDate:{day:1,month:1,year:2027},
        expiryLogic:{required:false,enabled:true,label:'Expiration Date'},
        resultDate:{required:true,enabled:true,label:'Chest X-Ray date'},
        src:{required:true,enabled:true,label:'Upload'},
        text:{required:false,enabled:true,label:'Notes'} },
      symptomScrn:{ enabled:false, label:'TB Symptom Screening', formId:'tbSymptomScrn',
        expiryType:'userEntered', expiryDays:0, fixedDate:{day:1,month:1,year:2027},
        expiryLogic:{required:true,enabled:true,label:'Expiration Date'},
        resultDate:{required:true,enabled:true,label:'Date questionnaire completed'},
        src:{required:true,enabled:true,label:'Upload Files'},
        text:{required:true,enabled:true,label:'Notes'} },
      vaccine:{ enabled:false, label:'Skin Test Details', formId:'tbVaccine',
        expiryType:'period', expiryDays:15, fixedDate:{day:1,month:1,year:2027},
        expiryLogic:{required:false,enabled:true,label:'Expiration Date'},
        src:{required:true,enabled:true,label:'Upload'},
        text:{required:false,enabled:true,label:'Notes'},
        doses:[
          {date:{required:true,enabled:true,label:'Step 1 Test Date'}, induration:{required:true,enabled:true,label:'Step 1 Induration (mm)'}},
          {date:{required:false,enabled:true,label:'Step 2 Test Date'}, induration:{required:false,enabled:true,label:'Step 2 Induration (mm)'}},
          {date:{required:false,enabled:false,label:'Step 3 Test Date'}, induration:{required:false,enabled:false,label:'Step 3 Induration'}}
        ] }
    }
  },
  tags:{
    preset:'ongoing',
    activity:'',
    dueOn:{ days:14, direction:'before', type:'before or after', phase:'start' },
    usePublishOn:false,
    publishOn:{ days:7, direction:'before', type:'before or after', phase:'start' },
    userTypes:[]
  },
  workflow:{ keep:true },
  carryForward:{ required:false, type:'indefinite', days:0 }
});
let state = null;

/* ============================= HELPERS ============================= */
function getState(path){ return path.split('.').reduce((o,k)=> (o==null?undefined:o[k]), state); }
function setState(path, value){
  const keys = path.split('.');
  let obj = state;
  for(let i=0;i<keys.length-1;i++){ obj = obj[keys[i]]; }
  obj[keys[keys.length-1]] = value;
}
function escapeAttr(str){
  return String(str==null?'':str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
/* Renders a True/False radio pair bound to a boolean state path.
   opts: { rerender, requiredFor, disabled } mirror the old checkbox's
   data-rerender / data-required-for / disabled behavior. */
function boolRadio(path, value, opts){
  opts = opts || {};
  const name = 'r_' + path.replace(/[^a-zA-Z0-9]/g, '_');
  const attrs = (opts.rerender ? ` data-rerender="${escapeAttr(opts.rerender)}"` : '') +
    (opts.requiredFor ? ` data-required-for="${escapeAttr(opts.requiredFor)}"` : '') +
    (opts.disabled ? ' disabled' : '');
  return `<span class="bool-radio">
    <label class="rlabel"><input type="radio" name="${name}" data-path="${path}" value="true" ${value ? 'checked' : ''}${attrs}/>True</label>
    <label class="rlabel"><input type="radio" name="${name}" data-path="${path}" value="false" ${!value ? 'checked' : ''}${attrs}/>False</label>
  </span>`;
}
function deepMerge(base, override){
  if(Array.isArray(base) || Array.isArray(override) || typeof base !== 'object' || base===null || typeof override !== 'object' || override===null){
    return override===undefined ? base : override;
  }
  const result = {};
  Object.keys(base).forEach(k=>{ result[k] = base[k]; });
  Object.keys(override).forEach(k=>{
    if(k in result && typeof result[k]==='object' && result[k]!==null && !Array.isArray(result[k]) &&
       typeof override[k]==='object' && override[k]!==null && !Array.isArray(override[k])){
      result[k] = deepMerge(result[k], override[k]);
    } else {
      result[k] = override[k];
    }
  });
  return result;
}

/* ============================= TABS (multiple requirements) ============================= */
const TABS_STORAGE_KEY = 'reqBuilderTabs';
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;
function genTabId(){ return 'tab_' + Date.now().toString(36) + '_' + (tabIdCounter++); }

function saveTabs(){
  try{
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({
      tabs: tabs.map(t=>({id:t.id, state:t.state})),
      activeTabId
    }));
  }catch(err){ /* storage unavailable or full — ignore, in-memory state still works */ }
}
function loadTabs(){
  try{
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    if(!raw) return false;
    const parsed = JSON.parse(raw);
    if(!parsed || !Array.isArray(parsed.tabs) || !parsed.tabs.length) return false;
    tabs = parsed.tabs.map(t=>({ id: t.id || genTabId(), state: deepMerge(defaultState(), t.state || {}) }));
    activeTabId = (parsed.activeTabId && tabs.some(t=>t.id===parsed.activeTabId)) ? parsed.activeTabId : tabs[0].id;
    state = tabs.find(t=>t.id===activeTabId).state;
    return true;
  }catch(err){ return false; }
}
function tabTitle(t){
  return (t.state.basic.name || t.state.basic.shortname || 'Untitled requirement');
}
function renderTabsBar(){
  const bar = document.getElementById('tabsBar');
  if(!bar) return;
  bar.innerHTML = tabs.map(t=>{
    const active = t.id === activeTabId ? ' active' : '';
    return `<div class="tab-item${active}" onclick="switchTab('${t.id}')" title="${escapeAttr(tabTitle(t))}">
      <span class="tab-title">${escapeAttr(tabTitle(t))}</span>
      <button type="button" class="tab-dup" onclick="event.stopPropagation(); duplicateTab('${t.id}')" title="Duplicate this tab">Copy</button>
      <button type="button" class="tab-close" onclick="event.stopPropagation(); closeTab('${t.id}')" title="Close tab">&times;</button>
    </div>`;
  }).join('') + `<button type="button" class="tab-add" onclick="addTab()" title="New requirement">+</button>`;
}
function addTab(initialState){
  const t = { id: genTabId(), state: initialState || defaultState() };
  tabs.push(t);
  activeTabId = t.id;
  state = t.state;
  fullRender();
  saveTabs();
}
function duplicateTab(id){
  const t = tabs.find(t=>t.id===id);
  if(!t) return;
  const cloned = JSON.parse(JSON.stringify(t.state));
  if(cloned.basic.name) cloned.basic.name = cloned.basic.name + ' (copy)';
  addTab(cloned);
}
function switchTab(id){
  if(id === activeTabId) return;
  const t = tabs.find(t=>t.id===id);
  if(!t) return;
  activeTabId = id;
  state = t.state;
  fullRender();
  saveTabs();
}
function closeTab(id){
  const idx = tabs.findIndex(t=>t.id===id);
  if(idx === -1) return;
  if(tabs.length === 1){
    if(!confirm('This is the last tab — reset it instead of closing?')) return;
    tabs[0].state = defaultState();
    state = tabs[0].state;
    fullRender();
    saveTabs();
    return;
  }
  const wasActive = id === activeTabId;
  tabs.splice(idx, 1);
  if(wasActive){
    const next = tabs[idx] || tabs[idx-1];
    activeTabId = next.id;
    state = next.state;
  }
  fullRender();
  saveTabs();
}
// Client-side only needs to know TB-or-not to switch which panel is shown.
// The canonical JSON (and its own copy of this same rule) is built server-side.
function getCategory(){
  return state.basic.categorySelect === 'Other' ? (state.basic.categoryCustom||'').trim() : state.basic.categorySelect;
}
function isTB(){ return getCategory().trim().toLowerCase() === 'tb'; }

/* ============================= FIELD PAIR (req/enabled/label) ============================= */
function reqEnabledPair(basePath, name, cfg, opts){
  opts = opts || {};
  return `
  <div class="pair">
    <div class="pair-head">
      <span class="name">${name}${opts.badge ? '<span class="req-badge">'+opts.badge+'</span>' : ''}</span>
    </div>
    <div class="pair-boxes">
      <span class="f-label">Required</span>${boolRadio(`${basePath}.required`, cfg.required, {requiredFor:`${basePath}.enabled`, rerender:opts.rerender})}
      <span class="f-label">Enabled</span>${boolRadio(`${basePath}.enabled`, cfg.enabled, {disabled: cfg.required})}
    </div>
    <input type="text" data-path="${basePath}.label" value="${escapeAttr(cfg.label)}" placeholder="Field label" />
  </div>`;
}

function expiryTypeBlock(basePath, cfg, opts){
  opts = opts || {};
  let extra = '';
  if(cfg.expiryType === 'period'){
    extra = `<div class="field" style="margin-top:8px;">
      <label class="f-label">Days until expiry</label>
      <input type="number" data-path="${basePath}.expiryDays" value="${cfg.expiryDays}" />
      ${opts.periodNote ? '<div class="hint">'+opts.periodNote+'</div>' : ''}
    </div>`;
  } else if(cfg.expiryType === 'fixedDate'){
    extra = `<div class="grid2" style="margin-top:8px;">
      <div class="field"><label class="f-label">Day</label><input type="number" min="1" max="31" data-path="${basePath}.fixedDate.day" value="${cfg.fixedDate.day}"/></div>
      <div class="field"><label class="f-label">Month</label><input type="number" min="1" max="12" data-path="${basePath}.fixedDate.month" value="${cfg.fixedDate.month}"/></div>
      <div class="field"><label class="f-label">Year</label><input type="number" data-path="${basePath}.fixedDate.year" value="${cfg.fixedDate.year}"/></div>
    </div>`;
  } else if(cfg.expiryType === 'userEntered'){
    extra = `<div class="hint" style="margin-top:6px;">The user enters the expiry date themselves. Expiry Logic below is forced on and required.</div>`;
  } else {
    extra = `<div class="hint" style="margin-top:6px;">No expiry logic applied to this item.</div>`;
  }
  return `
    <div class="field" style="margin-top:4px;">
      <label class="f-label">Expiry type</label>
      <select class="type-select" data-path="${basePath}.expiryType" data-rerender="${opts.rerender}">
        <option value="none" ${cfg.expiryType==='none'?'selected':''}>No expiry</option>
        <option value="period" ${cfg.expiryType==='period'?'selected':''}>Fixed days from result date</option>
        <option value="userEntered" ${cfg.expiryType==='userEntered'?'selected':''}>Date entered by user</option>
        <option value="fixedDate" ${cfg.expiryType==='fixedDate'?'selected':''}>Predefined fixed date</option>
      </select>
      ${extra}
    </div>`;
}

/* ============================= STEP 3: BEHAVIOR PANEL ============================= */
function renderBehaviorPanel(){
  if(isTB()) return renderTBPanel();
  return renderStandardPanel();
}

function renderStandardPanel(){
  const s = state.behavior.standard;
  return `
    <div class="card">
      <div class="card-title">Form basics</div>
      <div class="switch-row">
        ${boolRadio('behavior.standard.requiredTop', s.requiredTop, {requiredFor:'behavior.standard.enabledTop', rerender:'behaviorPanel'})}
        <span class="switch-label">Required<small>Whether the whole form must be completed</small></span>
      </div>
      <div class="switch-row">
        ${boolRadio('behavior.standard.enabledTop', s.enabledTop, {disabled: s.requiredTop})}
        <span class="switch-label">Enabled<small>Whether this form is shown at all</small></span>
      </div>
      <div class="field">
        <label class="f-label">Label</label>
        <input type="text" data-path="behavior.standard.label" value="${escapeAttr(s.label)}" placeholder="${escapeAttr(state.basic.name || 'Form label')}"/>
      </div>
      ${state.tags.userTypes.includes('clinicalinstructor') ? `
      <div class="grid2">
        <div class="field">
          <label class="f-label">FAAS form ID &mdash; Student <span style="font-weight:400;color:var(--ink-faint);">(optional)</span></label>
          <input type="text" class="mono" data-path="behavior.standard.formId" value="${escapeAttr(s.formId)}" placeholder="e.g. 9721ebcc-c16b-41a1-9efa-b1f8a00df5d1"/>
        </div>
        <div class="field">
          <label class="f-label">FAAS form ID &mdash; Clinical Instructor <span style="font-weight:400;color:var(--ink-faint);">(optional)</span></label>
          <input type="text" class="mono" data-path="behavior.standard.instructorFormId" value="${escapeAttr(s.instructorFormId)}" placeholder="e.g. 5c1f0a2e-...  (used for the clinicalInstructor variant)"/>
        </div>
      </div>` : `
      <div class="field">
        <label class="f-label">FAAS form ID <span style="font-weight:400;color:var(--ink-faint);">(optional)</span></label>
        <input type="text" class="mono" data-path="behavior.standard.formId" value="${escapeAttr(s.formId)}" placeholder="e.g. 9721ebcc-c16b-41a1-9efa-b1f8a00df5d1"/>
      </div>`}
    </div>

    <div class="card">
      <div class="card-title">Fields</div>
      ${reqEnabledPair('behavior.standard.text','Notes (text)', s.text, {rerender:'behaviorPanel'})}
      ${reqEnabledPair('behavior.standard.src','Upload files', s.src, {rerender:'behaviorPanel'})}
      ${reqEnabledPair('behavior.standard.resultDate','Result / start date', s.resultDate, {rerender:'behaviorPanel'})}
    </div>

    <div class="card">
      <div class="card-title">Expiry logic</div>
      ${expiryTypeBlock('behavior.standard', s, {rerender:'behaviorPanel', periodNote:'Result date above is automatically set to required + enabled for this type.'})}
      ${reqEnabledPair('behavior.standard.expiryLogic','Expiry logic field', s.expiryLogic, {rerender:'behaviorPanel'})}
    </div>
  `;
}

function tbSectionMarkup(key, title, cfg, opts){
  opts = opts || {};
  let extraFields = '';
  if(opts.hasTestType){
    extraFields += reqEnabledPair(`behavior.tb.${key}.testType`,'Test type', cfg.testType, {rerender:'behaviorPanel'});
  }
  if(opts.hasResultDate){
    extraFields += reqEnabledPair(`behavior.tb.${key}.resultDate`,'Result date', cfg.resultDate, {rerender:'behaviorPanel'});
  }
  extraFields += reqEnabledPair(`behavior.tb.${key}.src`,'Upload', cfg.src, {rerender:'behaviorPanel'});
  extraFields += reqEnabledPair(`behavior.tb.${key}.text`,'Notes', cfg.text, {rerender:'behaviorPanel'});

  let dosesBlock = '';
  if(opts.hasDoses){
    dosesBlock = `<div class="pair"><div class="pair-head"><span class="name">Doses / steps</span></div>` +
      cfg.doses.map((d,i)=>`
        <div style="border:1px solid var(--line-soft); border-radius:6px; padding:10px; margin-bottom:8px;">
          <div class="hint" style="margin:0 0 6px; font-weight:600; color:var(--ink-soft);">Step ${i+1}</div>
          ${reqEnabledPair(`behavior.tb.${key}.doses.${i}.date`,'Date', d.date, {rerender:'behaviorPanel'})}
          ${reqEnabledPair(`behavior.tb.${key}.doses.${i}.induration`,'Induration', d.induration, {rerender:'behaviorPanel'})}
        </div>
      `).join('') + `</div>`;
  }

  return `
  <div class="tb-section">
    <div class="tb-section-head">
      ${boolRadio(`behavior.tb.${key}.enabled`, cfg.enabled, {rerender:'behaviorPanel'})}
      <span class="name">${title}</span>
      <input class="formid-mini mono" type="text" data-path="behavior.tb.${key}.formId" value="${escapeAttr(cfg.formId)}" placeholder="FAAS form ID"/>
    </div>
    <div class="tb-section-body ${cfg.enabled?'':'collapsed'}">
      <div class="field" style="margin-top:14px;">
        <label class="f-label">Section label</label>
        <input type="text" data-path="behavior.tb.${key}.label" value="${escapeAttr(cfg.label)}"/>
      </div>
      ${extraFields}
      ${dosesBlock}
      <div class="pair">
        <div class="pair-head"><span class="name">Expiry</span></div>
        ${expiryTypeBlock(`behavior.tb.${key}`, cfg, {rerender:'behaviorPanel'})}
        ${reqEnabledPair(`behavior.tb.${key}.expiryLogic`,'Expiry logic field', cfg.expiryLogic, {rerender:'behaviorPanel'})}
      </div>
    </div>
  </div>`;
}

function renderTBPanel(){
  const t = state.behavior.tb;
  return `
    <div class="tb-banner">TB category selected &mdash; toggle any combination of the four TB test panels below. Each keeps its own FAAS form ID.</div>
    <div class="chk" style="margin-bottom:16px; display:inline-flex; align-items:center;">
      ${boolRadio('behavior.tb.useCustomsKey', t.useCustomsKey, {})}
      <span style="margin-left:8px;">Output these sections as a separate top-level <span style="font-family:var(--mono); margin:0 2px;">customs</span> object instead of <span style="font-family:var(--mono); margin:0 2px;">custom</span></span>
    </div>
    ${tbSectionMarkup('bloodTest','Blood Test Details', t.bloodTest, {hasTestType:true, hasResultDate:true})}
    ${tbSectionMarkup('chestXray','Chest X-Ray Details', t.chestXray, {hasResultDate:true})}
    ${tbSectionMarkup('symptomScrn','TB Symptom Screening', t.symptomScrn, {hasResultDate:true})}
    ${tbSectionMarkup('vaccine','Skin Test Details (TB vaccine)', t.vaccine, {hasDoses:true})}
  `;
}

/* ============================= STEP 2 file lists ============================= */
function fileRowsMarkup(basePath, files){
  return files.map((f,i)=>`
    <div class="row-line">
      <input type="text" class="mono" placeholder="fileId" data-path="${basePath}.${i}.fileId" value="${escapeAttr(f.fileId)}"/>
      <input type="text" placeholder="fileName" data-path="${basePath}.${i}.fileName" value="${escapeAttr(f.fileName)}"/>
      <button type="button" class="icon-btn" onclick="removeFile('${basePath}', ${i})" title="Remove">&times;</button>
    </div>
  `).join('');
}
function renderTemplatesFiles(){
  return fileRowsMarkup('guidelines.templates.files', state.guidelines.templates.files) +
    `<button type="button" class="btn-ghost" onclick="addFile('guidelines.templates.files')">+ Add file</button>`;
}
function renderSamplesFiles(){
  if(!state.guidelines.samples.useFiles) return '<div class="hint">Samples files: null</div>';
  return fileRowsMarkup('guidelines.samples.files', state.guidelines.samples.files) +
    `<button type="button" class="btn-ghost" onclick="addFile('guidelines.samples.files')">+ Add file</button>`;
}
function addFile(path){
  getState(path).push({fileId:'', fileName:''});
  rerenderSection(path.includes('templates') ? 'filesTemplates' : 'filesSamples');
  updatePreview();
}
function removeFile(path, idx){
  getState(path).splice(idx,1);
  rerenderSection(path.includes('templates') ? 'filesTemplates' : 'filesSamples');
  updatePreview();
}

/* ============================= STEP 4: TAGS ============================= */
const TAG_PRESETS = {
  onboarding:{ activity:'', dueOn:{days:14,direction:'before',type:'before or after',phase:'start'}, usePublishOn:false, publishOn:{days:7,direction:'before',type:'before or after',phase:'start'}, userTypes:[]},
  offboarding:{ activity:'offboarding', dueOn:{days:0,direction:'before',type:'same day',phase:'end'}, usePublishOn:true, publishOn:{days:7,direction:'before',type:'before or after',phase:'end'}, userTypes:['student'] },
  ongoing:{ activity:'onboarding', dueOn:{days:7,direction:'after',type:'before or after',phase:'start'}, usePublishOn:true, publishOn:{days:0,direction:'before',type:'same day',phase:'start'}, userTypes:['student']  }
};
function applyTagPreset(name){
  const p = TAG_PRESETS[name];
  state.tags = JSON.parse(JSON.stringify({ preset:name, ...p }));
  rerenderSection('tagsPanel');
  updatePreview();
}
function renderTagsPanel(){
  const t = state.tags;
  const presetBtn = (key,label) => `<button type="button" class="preset-btn ${t.preset===key?'active':''}" onclick="applyTagPreset('${key}')">${label}</button>`;
  return `
    <div class="preset-row">
      ${presetBtn('onboarding','Onboarding')}
      ${presetBtn('offboarding','Off-boarding')}
      ${presetBtn('ongoing','On-going')}
    </div>
    <div class="card">
      <div class="card-title">Activity</div>
      <select data-path="tags.activity">
        <option value="" ${t.activity===''?'selected':''}>None</option>
        <option value="onboarding" ${t.activity==='onboarding'?'selected':''}>onboarding</option>
        <option value="offboarding" ${t.activity==='offboarding'?'selected':''}>offboarding</option>
      </select>
    </div>
    <div class="card">
      <div class="card-title">Due on</div>
      <div class="grid2">
        <div class="field"><label class="f-label">Days</label><input type="number" data-path="tags.dueOn.days" value="${t.dueOn.days}"/></div>
        <div class="field"><label class="f-label">Direction</label>
          <select data-path="tags.dueOn.direction">
            <option value="before" ${t.dueOn.direction==='before'?'selected':''}>before</option>
            <option value="after" ${t.dueOn.direction==='after'?'selected':''}>after</option>
          </select>
        </div>
      </div>
      <div class="grid2">
        <div class="field"><label class="f-label">Type</label>
          <select data-path="tags.dueOn.type">
            <option value="before or after" ${t.dueOn.type==='before or after'?'selected':''}>before or after</option>
            <option value="same day" ${t.dueOn.type==='same day'?'selected':''}>same day</option>
          </select>
        </div>
        <div class="field"><label class="f-label">Phase</label>
          <select data-path="tags.dueOn.phase">
            <option value="start" ${t.dueOn.phase==='start'?'selected':''}>start</option>
            <option value="end" ${t.dueOn.phase==='end'?'selected':''}>end</option>
          </select>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Publish on</div>
      <div class="chk" style="margin-bottom:10px;">${boolRadio('tags.usePublishOn', t.usePublishOn, {rerender:'tagsPanel'})}<span style="margin-left:8px;">Include a publish-on condition</span></div>
      ${t.usePublishOn ? `
      <div class="grid2">
        <div class="field"><label class="f-label">Days</label><input type="number" data-path="tags.publishOn.days" value="${t.publishOn.days}"/></div>
        <div class="field"><label class="f-label">Direction</label>
          <select data-path="tags.publishOn.direction">
            <option value="before" ${t.publishOn.direction==='before'?'selected':''}>before</option>
            <option value="after" ${t.publishOn.direction==='after'?'selected':''}>after</option>
          </select>
        </div>
      </div>
      <div class="grid2">
        <div class="field"><label class="f-label">Type</label>
          <select data-path="tags.publishOn.type">
            <option value="before or after" ${t.publishOn.type==='before or after'?'selected':''}>before or after</option>
            <option value="same day" ${t.publishOn.type==='same day'?'selected':''}>same day</option>
          </select>
        </div>
        <div class="field"><label class="f-label">Phase</label>
          <select data-path="tags.publishOn.phase">
            <option value="start" ${t.publishOn.phase==='start'?'selected':''}>start</option>
            <option value="end" ${t.publishOn.phase==='end'?'selected':''}>end</option>
          </select>
        </div>
      </div>` : ''}
    </div>
    <div class="hint" style="margin:-6px 2px 0;">User types (Student / Clinical Instructor) are now set from the Audience card in Step 2 &mdash; Guidelines.</div>
  `;
}
function toggleUserType(val, checked){
  const arr = state.tags.userTypes;
  const i = arr.indexOf(val);
  if(checked && i===-1) arr.push(val);
  if(!checked && i>-1) arr.splice(i,1);
  updateGuidelinesEditors();
  rerenderSection('behaviorPanel');
  updatePreview();
}
/* Shows a second, dedicated editor for Clinical Instructor guidelines only
   when both audiences are selected, so its text can differ from Student's.
   With a single audience selected, the one editor's text is used for
   whichever key that audience maps to (unchanged from before). */
function updateGuidelinesEditors(){
  const types = state.tags.userTypes;
  const hasStudent = types.includes('student');
  const hasInstructor = types.includes('clinicalinstructor');
  const both = hasStudent && hasInstructor;
  const label = document.getElementById('primaryGuidelinesLabel');
  if(label){
    label.textContent = both ? 'Student guidelines'
      : hasInstructor ? 'Clinical Instructor guidelines'
      : hasStudent ? 'Student guidelines'
      : 'Student / Clinical Instructor guidelines';
  }
  const card = document.getElementById('instructorGuidelinesCard');
  if(card) card.hidden = !both;
}

/* ============================= STEP 6: CARRY FORWARD ============================= */
function renderCarryPanel(){
  const c = state.carryForward;
  return `
    <div class="switch-row">
      ${boolRadio('carryForward.required', c.required, {rerender:'carryPanel'})}
      <span class="switch-label">Carry-forward required<small>On writes disabled: false. Off writes disabled: true.</small></span>
    </div>
    ${c.required ? `
    <div class="field" style="max-width:260px;">
      <label class="f-label">Type</label>
      <select data-path="carryForward.type" data-rerender="carryPanel">
        <option value="indefinite" ${c.type==='indefinite'?'selected':''}>indefinite</option>
        <option value="days" ${c.type==='days'?'selected':''}>fixed number of days</option>
      </select>
    </div>
    ${c.type==='days' ? `
    <div class="field" style="max-width:260px;">
      <label class="f-label">Days</label>
      <input type="number" data-path="carryForward.days" value="${c.days}"/>
    </div>` : ''}` : ''}
  `;
}

/* ============================= RE-RENDER DISPATCH ============================= */
const sectionRenderers = {
  behaviorPanel: renderBehaviorPanel,
  tagsPanel: renderTagsPanel,
  carryPanel: renderCarryPanel,
  filesTemplates: renderTemplatesFiles,
  filesSamples: renderSamplesFiles
};
function rerenderSection(id){
  if(id === 'behaviorPanelNoop') return;
  const fn = sectionRenderers[id];
  if(!fn) return;
  const el = document.getElementById(id);
  if(el) el.innerHTML = fn();
  if(id === 'behaviorPanel'){
    document.getElementById('categoryCustomWrap').style.display = state.basic.categorySelect === 'Other' ? 'block' : 'none';
  }
}

/* ============================= SYNTAX HIGHLIGHT ============================= */
function highlight(json){
  const esc = json.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return esc.replace(/("(\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(\.\d+)?)/g, function(match, str, _q, colon, bool, num){
    if(str){ return colon ? '<span class="jk">'+match.replace(':','')+'</span>:' : '<span class="js">'+match+'</span>'; }
    if(bool){ return '<span class="jb">'+match+'</span>'; }
    if(num){ return '<span class="jn">'+match+'</span>'; }
    return match;
  });
}

/* ============================= CLIENT-SIDE VALIDATION HINTS ============================= */
function validateState(){
  const issues = [];
  if(!state.basic.name.trim()) issues.push('Name is empty.');
  if(!state.basic.shortname.trim()) issues.push('Short name is empty.');
  if(isTB()){
    const t = state.behavior.tb;
    if(!t.bloodTest.enabled && !t.chestXray.enabled && !t.symptomScrn.enabled && !t.vaccine.enabled){
      issues.push('TB category selected but no TB panel is enabled.');
    }
  }
  return issues;
}
function renderValidation(){
  const issues = validateState();
  const box = document.getElementById('validationBox');
  if(issues.length){
    box.classList.remove('ok');
    box.innerHTML = '&#9888; ' + issues.join(' &nbsp;&middot;&nbsp; ');
  } else {
    box.classList.add('ok');
    box.innerHTML = '';
  }
}

/* ============================= SERVER-BACKED PREVIEW / DOWNLOAD ============================= */
let previewTimer = null;
let lastBuilt = null; // last JSON object returned by the server

function updatePreview(){
  // Debounced: batches rapid typing into a single request to /api/build.
  if(previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(fetchPreview, 250);
  renderValidation();
  renderTabsBar();
  saveTabs();
}

async function fetchPreview(){
  try{
    const res = await fetch('/api/build', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(state)
    });
    if(!res.ok) throw new Error('Server returned ' + res.status);
    const data = await res.json();
    lastBuilt = data;
    const json = JSON.stringify(data, null, 2);
    document.getElementById('jsonOut').innerHTML = highlight(json);
  }catch(err){
    document.getElementById('jsonOut').textContent = 'Preview error: ' + err.message +
      '\n\nIs the Flask server running? (python app.py)';
  }
}

async function copyJSON(){
  const btn = event.target;
  const old = btn.textContent;
  try{
    if(!lastBuilt) await fetchPreview();
    await navigator.clipboard.writeText(JSON.stringify(lastBuilt, null, 2));
    btn.textContent = 'Copied';
  }catch(err){
    btn.textContent = 'Failed';
  }
  setTimeout(()=>btn.textContent = old, 1200);
}

async function downloadJSON(){
  try{
    const res = await fetch('/api/download', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(state)
    });
    if(!res.ok) throw new Error('Server returned ' + res.status);
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/.exec(cd);
    const filename = match ? match[1] : 'requirement.json';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }catch(err){
    alert('Download failed: ' + err.message);
  }
}

async function downloadAllTabs(){
  try{
    const res = await fetch('/api/download-all', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ tabs: tabs.map(t=>t.state) })
    });
    if(!res.ok) throw new Error('Server returned ' + res.status);
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/.exec(cd);
    const filename = match ? match[1] : 'requirements.zip';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }catch(err){
    alert('Download all failed: ' + err.message);
  }
}

/* ============================= EVENT DELEGATION ============================= */
const formRoot = document.getElementById('formRoot');
function handleFieldEvent(e){
  const el = e.target;
  const path = el.dataset ? el.dataset.path : null;
  if(!path) return;
  let value;
  if(el.isContentEditable){ value = el.innerHTML; }
  else if(el.type === 'checkbox'){ value = el.checked; }
  else if(el.type === 'radio'){ if(!el.checked) return; value = el.value === 'true'; }
  else { value = el.value; }
  setState(path, value);

  if(el.dataset.requiredFor && ((el.type === 'checkbox' && el.checked) || (el.type === 'radio' && value === true))){
    setState(el.dataset.requiredFor, true);
  }
  if(el.dataset.rerender){
    rerenderSection(el.dataset.rerender);
  }
  updatePreview();
}
formRoot.addEventListener('input', handleFieldEvent);
formRoot.addEventListener('change', handleFieldEvent);

/* rich text helpers */
function formatDoc(cmd, editorId){
  const editor = document.getElementById(editorId);
  editor.focus();
  document.execCommand(cmd, false, null);
  setState(editor.dataset.path, editor.innerHTML);
  updatePreview();
}
function formatLink(editorId){
  const editor = document.getElementById(editorId);
  const url = prompt('Link URL:');
  if(!url) return;
  editor.focus();
  document.execCommand('createLink', false, url);
  setState(editor.dataset.path, editor.innerHTML);
  updatePreview();
}

/* Tab / Shift+Tab inside an editor nests or un-nests the current list item */
document.querySelectorAll('.rte').forEach(editor=>{
  editor.addEventListener('keydown', function(e){
    if(e.key !== 'Tab') return;
    e.preventDefault();
    document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, null);
    setState(editor.dataset.path, editor.innerHTML);
    updatePreview();
  });
});

/* mobile preview toggle */
function toggleMobilePreview(){
  const col = document.getElementById('previewCol');
  const open = col.classList.toggle('open');
  document.getElementById('mobileToggle').textContent = open ? 'Close' : 'View JSON';
}

/* reset (current tab only) */
function resetAll(){
  if(!confirm('Reset this tab\'s form?')) return;
  const t = tabs.find(t=>t.id===activeTabId);
  t.state = defaultState();
  state = t.state;
  fullRender();
  saveTabs();
}

/* ============================= JSON IMPORT (duplicate into a new tab) ============================= */
const CATEGORY_OPTIONS = ['Attestation','TB','Immunization','Training','Background Check'];

function importExpiryConfig(expiryDate){
  if(!expiryDate) return { expiryType:'none' };
  if(expiryDate.period) return { expiryType:'period', expiryDays: expiryDate.period.days };
  if(expiryDate['fixed-date']){
    const fd = expiryDate['fixed-date'];
    if(fd['by-user']) return { expiryType:'userEntered' };
    if(fd.day !== undefined){
      return { expiryType:'fixedDate', fixedDate:{ day:fd.day, month:fd.month, year:fd.year } };
    }
    return { expiryType:'none' };
  }
  return { expiryType:'none' };
}
function importFieldPair(obj, fallback){
  obj = obj || {}; fallback = fallback || {};
  return {
    required: !!obj.required,
    enabled: !!obj.enabled,
    label: obj.label !== undefined ? obj.label : (fallback.label || '')
  };
}
function importFiles(files){
  return Array.isArray(files) ? files.map(f=>({ fileId: f.fileId||'', fileName: f.fileName||'' })) : [];
}
function importTBSection(section, fallback, opts){
  opts = opts || {}; section = section || {};
  const out = {
    enabled: !!section.enabled,
    label: section.label !== undefined ? section.label : fallback.label,
    formId: (section.faas && section.faas.formId) || fallback.formId || '',
    ...importExpiryConfig(section.expiryDate),
    expiryLogic: importFieldPair(section.expiryLogic, fallback.expiryLogic),
    src: importFieldPair(section.src, fallback.src),
    text: importFieldPair(section.text, fallback.text)
  };
  if(!out.fixedDate) out.fixedDate = fallback.fixedDate;
  if(opts.hasResultDate) out.resultDate = importFieldPair(section.resultDate, fallback.resultDate);
  if(opts.hasTestType) out.testType = importFieldPair(section.testType, fallback.testType);
  if(opts.hasDoses){
    const doses = Array.isArray(section.doses) ? section.doses : [];
    out.doses = fallback.doses.map((fd,i)=>{
      const d = doses[i] || {};
      return { date: importFieldPair(d.date, fd.date), induration: importFieldPair(d.induration, fd.induration) };
    });
  }
  return out;
}
function importRequirementJSON(json){
  json = json || {};
  const st = defaultState();
  const fb = defaultState();

  const category = json.category || '';
  if(CATEGORY_OPTIONS.includes(category)){
    st.basic.categorySelect = category; st.basic.categoryCustom = '';
  } else if(category){
    st.basic.categorySelect = 'Other'; st.basic.categoryCustom = category;
  }
  st.basic.name = json.name || '';
  st.basic.shortname = json.shortname || '';
  st.basic.version = json.version || 0;
  st.basic.active = json.active !== undefined ? !!json.active : true;
  st.basic.required = json.required !== undefined ? !!json.required : true;

  const g = json.guidelines || {};
  const isInstructorVariant = Array.isArray(g.clinicalInstructor);
  st.guidelines.studentHTML = isInstructorVariant ? (g.clinicalInstructor[0] || '')
    : (Array.isArray(g.student) ? (g.student[0] || '') : '');
  st.guidelines.reviewerHTML = Array.isArray(g.reviewer) ? (g.reviewer[0] || '') : '';
  const templates = g.templates || {};
  st.guidelines.templates.collectionId = templates.collectionId || '';
  st.guidelines.templates.files = importFiles(templates.files);
  const samples = g.samples || {};
  st.guidelines.samples.collectionId = samples.collectionId || '';
  st.guidelines.samples.useFiles = Array.isArray(samples.files);
  st.guidelines.samples.files = importFiles(samples.files);

  const custom = json.custom || {};
  if(st.basic.categorySelect === 'TB'){
    // Either "custom" (default) or, if the customs toggle was on, "customs" holds the sections.
    const tbSource = json.customs || custom;
    st.behavior.tb.useCustomsKey = !!json.customs;
    st.behavior.tb.bloodTest = importTBSection(tbSource.bloodTest, fb.behavior.tb.bloodTest, {hasResultDate:true, hasTestType:true});
    st.behavior.tb.chestXray = importTBSection(tbSource.chestXray, fb.behavior.tb.chestXray, {hasResultDate:true});
    st.behavior.tb.symptomScrn = importTBSection(tbSource.symptomScrn, fb.behavior.tb.symptomScrn, {hasResultDate:true});
    st.behavior.tb.vaccine = importTBSection(tbSource.vaccine, fb.behavior.tb.vaccine, {hasDoses:true});
  } else {
    const s = fb.behavior.standard;
    const incomingFormId = (custom.faas && custom.faas.formId) || '';
    st.behavior.standard = {
      ...s,
      requiredTop: !!custom.required,
      enabledTop: custom.enabled !== undefined ? !!custom.enabled : true,
      label: custom.label || '',
      formId: isInstructorVariant ? '' : incomingFormId,
      instructorFormId: isInstructorVariant ? incomingFormId : '',
      text: importFieldPair(custom.text, s.text),
      src: importFieldPair(custom.src, s.src),
      resultDate: importFieldPair(custom.resultDate, s.resultDate),
      expiryLogic: importFieldPair(custom.expiryLogic, s.expiryLogic),
      ...importExpiryConfig(custom.expiryDate)
    };
    if(!st.behavior.standard.fixedDate) st.behavior.standard.fixedDate = s.fixedDate;
  }

  const tags = json.tags || {};
  st.tags.activity = tags.activity || '';
  if(tags.dueOn && tags.dueOn.dateCondition){
    st.tags.dueOn = {
      days: tags.dueOn.dateCondition.days || 0,
      direction: tags.dueOn.dateCondition.direction || 'before',
      type: tags.dueOn.dateCondition.type || 'before or after',
      phase: tags.dueOn.phase || 'start'
    };
  }
  if(tags.publishOn && tags.publishOn.dateCondition){
    st.tags.usePublishOn = true;
    st.tags.publishOn = {
      days: tags.publishOn.dateCondition.days || 0,
      direction: tags.publishOn.dateCondition.direction || 'before',
      type: tags.publishOn.dateCondition.type || 'before or after',
      phase: tags.publishOn.phase || 'start'
    };
  } else {
    st.tags.usePublishOn = false;
  }
  st.tags.userTypes = Array.isArray(tags.userTypes) ? tags.userTypes.slice() : [];
  st.tags.preset = 'ongoing';

  st.workflow.keep = !!json.workflow;

  const cf = json.carryForwardConfig || {};
  st.carryForward.required = cf.disabled === false;
  st.carryForward.type = cf.type || 'indefinite';
  st.carryForward.days = cf.days || 0;

  return st;
}

function triggerImport(){ document.getElementById('importFileInput').click(); }
async function handleImportFile(e){
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  try{
    const text = await file.text();
    const json = JSON.parse(text);
    const imported = importRequirementJSON(json);
    addTab(imported);
  }catch(err){
    alert('Could not import that file as a requirement JSON: ' + err.message);
  }
}

/* ============================= GENERIC FORM SYNC ============================= */
// Pushes the current tab's state into every static (non re-rendered) [data-path]
// field, so switching tabs / importing actually updates what's on screen.
function syncFormFromState(){
  formRoot.querySelectorAll('[data-path]').forEach(el=>{
    if(el.isContentEditable) return; // rich-text editors are synced separately
    const val = getState(el.dataset.path);
    if(val === undefined) return;
    if(el.type === 'checkbox'){ el.checked = !!val; }
    else if(el.type === 'radio'){ el.checked = (el.value === String(!!val)); }
    else { el.value = val; }
  });
}

/* ============================= INITIAL RENDER ============================= */
function fullRender(){
  renderTabsBar();
  syncFormFromState();
  document.getElementById('categorySelect').value = state.basic.categorySelect;
  document.getElementById('categoryCustomWrap').style.display = state.basic.categorySelect === 'Other' ? 'block' : 'none';
  document.getElementById('studentEditor').innerHTML = state.guidelines.studentHTML;
  document.getElementById('instructorEditor').innerHTML = state.guidelines.instructorHTML;
  document.getElementById('reviewerEditor').innerHTML = state.guidelines.reviewerHTML;
  const hasStudent = state.tags.userTypes.includes('student');
  document.getElementById('audienceStudentChkTrue').checked = hasStudent;
  document.getElementById('audienceStudentChkFalse').checked = !hasStudent;
  const hasInstructor = state.tags.userTypes.includes('clinicalinstructor');
  document.getElementById('audienceInstructorChkTrue').checked = hasInstructor;
  document.getElementById('audienceInstructorChkFalse').checked = !hasInstructor;
  updateGuidelinesEditors();
  rerenderSection('behaviorPanel');
  rerenderSection('tagsPanel');
  rerenderSection('carryPanel');
  rerenderSection('filesTemplates');
  rerenderSection('filesSamples');
  updatePreview();
}

if(!loadTabs()){
  tabs = [{ id: genTabId(), state: defaultState() }];
  activeTabId = tabs[0].id;
  state = tabs[0].state;
}
fullRender();
