// --------- utilities ----------
const state = { view:'home', products:[], countries:[] };

async function api(path, opts={}) {
const res = await fetch(path, {
credentials:'include',
headers:{'Content-Type':'application/json'},
...opts
});
if (!res.ok) {
// Try to parse error body to surface something useful in alerts
let t; try { t = await res.text(); } catch {}
throw new Error(t || ('HTTP '+res.status));
}
return res.json();
}
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
function setView(v){
state.view=v;
['home','products','performance','finance','settings'].forEach(id=>{
const el = document.getElementById(id);
if (el) el.style.display = id===v ? '' : 'none';
});
$$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view===v));
}
function weekdayName(dateStr){ return new Date(dateStr).toLocaleDateString(undefined,{weekday:'long'}); }
const sum = (arr) => arr.reduce((a,b)=>a+(+b||0),0);

// --------- bootstrap/auth ----------
async function ensureMeta(){
try{
const m = await api('/api/meta');
state.countries = m.countries || [];
await loadProducts();
const login = $('#login'); if (login) login.style.display='none';
setView(state.view);
fillSelects();
await refreshHome();
}catch(e){
// Show login if backend still expects it
const login = $('#login'); if (login) login.style.display='';
setView('home');
}
}
async function loadProducts(){ try{ const r = await api('/api/products'); state.products = r.products||[]; }catch{/* backend may not have endpoint yet */} }
function fillSelects(){
// countries
const countrySel = '#delivCountry, #adCountry, #mvFrom, #mvTo, #sp1From, #sp1To, #sp2From, #sp2To, #pfCountry, #rCountry';
$$(countrySel).forEach(s => {
if (!s) return;
s.innerHTML = state.countries.map(c=>`<option value="${c}">${c}</option>`).join('');
});
// products
const productSel = '#adProduct, #mvProduct, #sp1Product, #sp2Product, #rProduct, #lpProduct';
$$(productSel).forEach(s => {
if (!s) return;
s.innerHTML = state.products.map(p=>`<option value="${p.id}">${p.name} (${p.sku||p.id})</option>`).join('');
});
}

// --------- HOME ----------
async function refreshHome(){
// KPIs
$('#kpiProducts') && ($('#kpiProducts').textContent = state.products.length);
$('#kpiCountries') && ($('#kpiCountries').textContent = state.countries.length);

try {
const shipAll = await api('/api/shipments');
$('#kpiTransit') && ($('#kpiTransit').textContent = shipAll.shipments.length);
} catch {
$('#kpiTransit') && ($('#kpiTransit').textContent = '—');
}

try {
// optional; if backend lacks GET /api/adspend, this falls back
const ads = await api('/api/adspend');
$('#kpiAdSpend') && ($('#kpiAdSpend').textContent = Intl.NumberFormat().format(sum(ads.adSpends.map(a=>a.amount))) + ' USD');
} catch {
$('#kpiAdSpend') && ($('#kpiAdSpend').textContent = '—');
}

// Delivered this week
try {
const cw = await api('/api/deliveries/current-week');
const weekTotal = Object.values(cw.days).reduce((a,b)=>a+(+b||0),0);
$('#kpiDelivered') && ($('#kpiDelivered').textContent = weekTotal);
} catch {
$('#kpiDelivered') && ($('#kpiDelivered').textContent = '—');
}

// Stock by country + ad spend per country
await renderStockByCountry();

// Delivered table default
await filterDeliveries();

// Shipments tables
await renderShipments('china-kenya', '#shipCKTable tbody');
await renderShipments('intercountry', '#shipICTable tbody');
}

async function renderStockByCountry(){
const wrap = $('#stockByCountry'); if (!wrap) return;
const perCountry = {};
state.countries.forEach(c=> perCountry[c] = { stock:0, ad:0 });

// Approx stock: arrived shipments add to 'to', remittances pieces subtract
try{
const ship = await api('/api/shipments');
ship.shipments.filter(s=>s.arrivedAt).forEach(s=>{
perCountry[s.to] = perCountry[s.to] || {stock:0, ad:0};
perCountry[s.to].stock += (+s.qty||0);
});
}catch{}

try{
const rem = await api('/api/remittances');
rem.remittances.forEach(r=>{
perCountry[r.country] = perCountry[r.country] || {stock:0, ad:0};
perCountry[r.country].stock -= (+r.pieces||0);
});
}catch{}

try{
const ads = await api('/api/adspend');
ads.adSpends.forEach(a=>{
perCountry[a.country] = perCountry[a.country] || {stock:0, ad:0};
perCountry[a.country].ad += (+a.amount||0);
});
}catch{}

const rows = Object.entries(perCountry).map(([c,v]) =>
`<tr><td>${c}</td><td>${v.stock}</td><td>${(v.ad||0).toFixed(2)} USD</td></tr>`
).join('');
wrap.innerHTML = `<table class="table"><thead><tr><th>Country</th><th>Approx. Stock</th><th>Total Ad Spend</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function filterDeliveries(){
const s = $('#delivStart')?.value || '';
const e = $('#delivEnd')?.value || '';
const tbody = $('#delivTable tbody'); if (!tbody) return;

try{
const res = await api(`/api/deliveries${s||e ? `?start=${s}&end=${e}`:''}`);
tbody.innerHTML = res.deliveries.map(d =>
`<tr><td>${d.date}</td><td>${weekdayName(d.date)}</td><td>${d.country}</td><td>${d.delivered}</td></tr>`
).join('');
$('#delivTotal') && ($('#delivTotal').textContent = res.deliveries.reduce((a,b)=>a+(+b.delivered||0),0));
}catch{
tbody.innerHTML = '';
$('#delivTotal') && ($('#delivTotal').textContent = '—');
}
}

// Add delivered
$('#delivAdd') && ($('#delivAdd').onclick = async ()=>{
const date = $('#delivDate').value, country=$('#delivCountry').value, delivered=+$('#delivCount').value||0;
if(!date || !country) return alert('Pick date & country');
await api('/api/deliveries',{ method:'POST', body: JSON.stringify({ date, country, delivered })});
await filterDeliveries(); await refreshHome();
});
$('#delivFilter') && ($('#delivFilter').onclick = filterDeliveries);

// Ad spend add/replace
$('#adAdd') && ($('#adAdd').onclick = async ()=>{
const payload = {
date: $('#adDate').value,
platform: $('#adPlatform').value,
productId: $('#adProduct').value,
country: $('#adCountry').value,
amount: +$('#adAmount').value||0
};
if(!payload.date || !payload.productId || !payload.country) return alert('Missing fields');
await api('/api/adspend',{ method:'POST', body: JSON.stringify(payload) });
alert('Saved'); await refreshHome();
});

// Movement
$('#mvAdd') && ($('#mvAdd').onclick = async ()=>{
const payload = {
productId: $('#mvProduct').value,
fromCountry: $('#mvFrom').value,
toCountry: $('#mvTo').value,
qty: +$('#mvQty').value||0,
shippingCost: +$('#mvShip').value||0
};
if(!payload.productId) return alert('Select product');
await api('/api/stock/move',{ method:'POST', body: JSON.stringify(payload) });
alert('Movement saved'); await refreshHome();
});

// Shipments table helpers
async function renderShipments(type, sel){
const body = $(sel); if (!body) return;
try{
const r = await api('/api/shipments?type='+encodeURIComponent(type));
const productsById = Object.fromEntries((state.products||[]).map(p=>[p.id,p]));
body.innerHTML = r.shipments.map(sp=>`
<tr>
<td>${sp.id}</td>
<td>${productsById[sp.productId]?.name || sp.productId}</td>
<td>${sp.from} → ${sp.to}</td>
<td>${sp.qty}</td>
<td>${sp.shipCost}</td>
<td>${sp.departedAt||''}</td>
<td>${sp.arrivedAt||''}</td>
<td>
<button class="btn outline" data-mark="${sp.id}">Mark Arrived</button>
<button class="btn outline" data-del="${sp.id}">Delete</button>
</td>
</tr>`).join('');

body.querySelectorAll('[data-mark]').forEach(b => b.onclick = async ()=>{
const d = prompt('Arrival date YYYY-MM-DD'); if(!d) return;
await api('/api/shipments/'+b.dataset.mark, { method:'PUT', body: JSON.stringify({ arrivedAt: d })});
await renderShipments(type, sel);
});
body.querySelectorAll('[data-del]').forEach(b => b.onclick = async ()=>{
if(!confirm('Delete shipment?')) return;
await api('/api/shipments/'+b.dataset.del, { method:'DELETE' });
await renderShipments(type, sel);
});
}catch{
body.innerHTML = '';
}
}

// Profit by country (remittances)
$('#pcRun') && ($('#pcRun').onclick = async ()=>{
const s=$('#pcStart').value, e=$('#pcEnd').value;
const tbody = $('#profitCountryTable tbody'); if (!tbody) return;
try{
const r = await api(`/api/remittances${s||e?`?start=${s}&end=${e}`:''}`);
const byC = {};
r.remittances.forEach(x=>{
byC[x.country] = byC[x.country] || { revenue:0, ad:0, cpd:0, pieces:0 };
byC[x.country].revenue += +x.revenue||0;
byC[x.country].ad += +x.adSpend||0;
byC[x.country].cpd += (+x.costPerDelivery||0) * (+x.pieces||0);
byC[x.country].pieces += +x.pieces||0;
});
tbody.innerHTML = Object.entries(byC).map(([c,v])=>{
const profit = v.revenue - v.ad - v.cpd;
return `<tr><td>${c}</td><td>${v.revenue.toFixed(2)}</td><td>${v.ad.toFixed(2)}</td><td>${v.cpd.toFixed(2)}</td><td>${v.pieces}</td><td>${profit.toFixed(2)}</td></tr>`;
}).join('');
}catch{
tbody.innerHTML = '';
}
});

// To-Do (local only)
function loadTodos(){ return JSON.parse(localStorage.getItem('todos')||'[]'); }
function saveTodos(x){ localStorage.setItem('todos', JSON.stringify(x)); }
function renderTodos(){
const items = loadTodos();
const list = $('#todoList'); if (!list) return;
list.innerHTML = items.map(it=>`
<div class="flex">
<span>${it.done ? '✅ ' : ''}${it.text}</span>
<button class="btn outline" data-tgl="${it.id}">${it.done?'Undo':'Done'}</button>
<button class="btn outline" data-del="${it.id}">Delete</button>
</div>`).join('');
const add = $('#todoAdd');
add && (add.onclick = ()=>{ const t = $('#todoText').value.trim(); if(!t) return;
items.push({id: Math.random().toString(36).slice(2), text:t, done:false}); saveTodos(items); renderTodos(); });
list.querySelectorAll('[data-tgl]').forEach(b=> b.onclick=()=>{ const it=items.find(x=>x.id===b.dataset.tgl); it.done=!it.done; saveTodos(items); renderTodos(); });
list.querySelectorAll('[data-del]').forEach(b=> b.onclick=()=>{ const i=items.findIndex(x=>x.id===b.dataset.del); items.splice(i,1); saveTodos(items); renderTodos(); });
}
function renderWeekly(){
const key='weeklyTodos'; const data=JSON.parse(localStorage.getItem(key)||'{}'); const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const wrap = $('#weeklyWrap'); if (!wrap) return;
wrap.innerHTML='';
days.forEach(day=>{
const items=data[day]||[];
const card = document.createElement('div'); card.className='card';
card.innerHTML = `<div class="h">${day}</div>
<div class="flex"><input id="w_${day}" class="input" placeholder="Task"><button class="btn">Add</button></div>
<div class="list">${items.map(it=>`<div class="flex"><span>${it.done?'✅ ':''}${it.text}</span>
<button class="btn outline" data-wtgl="${day}|${it.id}">${it.done?'Undo':'Done'}</button>
<button class="btn outline" data-wdel="${day}|${it.id}">Delete</button></div>`).join('')}</div>`;
wrap.appendChild(card);
card.querySelector('button.btn').onclick = ()=>{ const v=card.querySelector(`#w_${day}`).value.trim(); if(!v) return;
items.push({id:Math.random().toString(36).slice(2), text:v, done:false}); data[day]=items; localStorage.setItem(key, JSON.stringify(data)); renderWeekly(); };
});
wrap.querySelectorAll('[data-wtgl]').forEach(b=> b.onclick=()=>{ const [d,id]=b.dataset.wtgl.split('|'); const data=JSON.parse(localStorage.getItem(key)||'{}'); const it=(data[d]||[]).find(x=>x.id===id); it.done=!it.done; localStorage.setItem(key, JSON.stringify(data)); renderWeekly(); });
wrap.querySelectorAll('[data-wdel]').forEach(b=> b.onclick=()=>{ const [d,id]=b.dataset.wdel.split('|'); const data=JSON.parse(localStorage.getItem(key)||'{}'); const arr=(data[d]||[]); const i=arr.findIndex(x=>x.id===id); arr.splice(i,1); data[d]=arr; localStorage.setItem(key, JSON.stringify(data)); renderWeekly(); });
}

// ---------- PRODUCTS ----------
$('#pAdd') && ($('#pAdd').onclick = async ()=>{
const payload = {
name:$('#pName').value, sku:$('#pSku').value,
cost_china:+$('#pCost').value||0,
ship_china_to_kenya:+$('#pShip').value||0,
margin_budget:+$('#pMB').value||0
};
await api('/api/products',{ method:'POST', body: JSON.stringify(payload) });
await renderProducts();
});
async function renderProducts(){
let res; try{ res = await api('/api/products'); }catch{ res = {products:[]} }
state.products = res.products||[];
const tbody = $('#productsTable tbody'); if (!tbody) return;
tbody.innerHTML = state.products.map(p=>`
<tr><td>${p.name}</td><td>${p.sku||'-'}</td>
<td><span class="badge">${p.status||'active'}</span></td>
<td>
<button class="btn outline" data-pause="${p.id}">${p.status==='active'?'Pause':'Run'}</button>
<button class="btn outline" data-del="${p.id}">Delete</button>
</td></tr>`).join('');
tbody.querySelectorAll('[data-pause]').forEach(b=> b.onclick=async ()=>{
const id=b.dataset.pause; const p=state.products.find(x=>x.id===id);
const ns=p.status==='active'?'paused':'active';
await api(`/api/products/${id}/status`, { method:'POST', body: JSON.stringify({ status: ns })});
await renderProducts();
});
tbody.querySelectorAll('[data-del]').forEach(b=> b.onclick=async ()=>{
if(!confirm('Delete product?')) return;
await api('/api/products/'+b.dataset.del,{ method:'DELETE' });
await renderProducts();
});
}

// ---------- PERFORMANCE ----------
$('#pfRun') && ($('#pfRun').onclick = async ()=>{
const s=$('#pfStart').value, e=$('#pfEnd').value, c=$('#pfCountry').value;
try{
const r = await api(`/api/performance/top-delivered?start=${s||''}&end=${e||''}&country=${c||''}`);
const tbody = $('#pfTable tbody'); if (!tbody) return;
tbody.innerHTML = r.items.map(it=> `<tr><td>${it.productName}</td><td>${it.pieces}</td><td>${it.adSpend.toFixed(2)}</td><td>${it.productCost.toFixed(2)}</td><td>${it.profit.toFixed(2)}</td><td>${it.profitPerPiece.toFixed(2)}</td></tr>`).join('');
}catch{
const tbody = $('#pfTable tbody'); if (tbody) tbody.innerHTML='';
}
});
$('#rAdd') && ($('#rAdd').onclick = async ()=>{
const payload = {
start:$('#rStart').value, end:$('#rEnd').value,
country:$('#rCountry').value, productId:$('#rProduct').value,
orders:+$('#rOrders').value||0, pieces:+$('#rPieces').value||0,
revenue:+$('#rRev').value||0, adSpend:+$('#rAds').value||0, costPerDelivery:+$('#rCPD').value||0
};
if(!payload.start || !payload.end) return alert('Select dates');
await api('/api/remittances',{ method:'POST', body: JSON.stringify(payload) });
alert('Remittance saved');
});

// ---------- FINANCE ----------
async function renderFinanceCats(){
try{
const cats = await api('/api/finance/categories');
$('#fcList') && ($('#fcList').innerHTML = `<div>Debits: ${cats.debits.join(', ')||'-'}</div><div>Credits: ${cats.credits.join(', ')||'-'}</div>`);
}catch{
$('#fcList') && ($('#fcList').innerHTML = `<div>Debits: -</div><div>Credits: -</div>`);
}
}
$('#fcAdd') && ($('#fcAdd').onclick = async ()=>{
await api('/api/finance/categories', { method:'POST', body: JSON.stringify({ type:$('#fcType').value, name:$('#fcName').value }) });
await renderFinanceCats();
});
$('#feAdd') && ($('#feAdd').onclick = async ()=>{
const payload = { date:$('#feDate').value, type:$('#feType').value, category:$('#feCat').value, amount:+$('#feAmt').value||0, note:$('#feNote').value };
await api('/api/finance/entries',{ method:'POST', body: JSON.stringify(payload) });
alert('Entry saved');
});
$('#feRun') && ($('#feRun').onclick = async ()=>{
const s=$('#fes').value, e=$('#fee').value, cats=$('#fef').value;
try{
const r = await api(`/api/finance/entries?start=${s||''}&end=${e||''}&categories=${encodeURIComponent(cats||'')}`);
$('#feBalance') && ($('#feBalance').textContent = 'Balance: ' + r.balance.toFixed(2) + ' USD');
const tbody = $('#feTable tbody'); if (!tbody) return;
tbody.innerHTML = r.entries.map(x=>`<tr><td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${x.amount}</td><td>${x.note}</td></tr>`).join('');
}catch{
$('#feBalance') && ($('#feBalance').textContent = 'Balance: —');
const tbody = $('#feTable tbody'); if (tbody) tbody.innerHTML='';
}
});

// ---------- SETTINGS ----------
$('#ctyAdd') && ($('#ctyAdd').onclick = async ()=>{
const name = $('#cty').value.trim(); if(!name) return;
await api('/api/countries',{ method:'POST', body: JSON.stringify({ name }) });
try{
const list = await api('/api/countries');
state.countries = list.countries; fillSelects(); renderCountries();
}catch{}
});
function renderCountries(){
$('#ctyList') && ($('#ctyList').innerHTML = state.countries.map(c=> `<span class="badge" style="margin-right:6px">${c}</span>`).join(''));
}
$$('.restore').forEach(b=> b.onclick = async ()=>{
try{
const r = await api('/api/restore', { method: 'POST', body: JSON.stringify({ window: b.dataset.win }) });
alert('Restored from '+r.restoredFrom);
}catch(e){
alert('No snapshot in that window');
}
});

// ---------- Lifetime product cost/profit ----------
$('#lpRun') && ($('#lpRun').onclick = async ()=>{
const pid = $('#lpProduct').value || null;
const s=$('#lpStart').value, e=$('#lpEnd').value;
try{
const rem = await api(`/api/remittances${s||e?`?start=${s}&end=${e}`:''}`);
const ship = await api('/api/shipments');
const productsById = Object.fromEntries((state.products||[]).map(p=>[p.id,p]));

const byP = {};
rem.remittances.filter(r=>!pid || r.productId===pid).forEach(r=>{
byP[r.productId] = byP[r.productId] || { revenue:0, ad:0, ship:0, base:0, pieces:0 };
byP[r.productId].revenue += +r.revenue||0;
byP[r.productId].ad += +r.adSpend||0;
byP[r.productId].pieces += +r.pieces||0;
const prod = productsById[r.productId] || { cost_china:0, ship_china_to_kenya:0 };
byP[r.productId].base += (+prod.cost_china||0 + +prod.ship_china_to_kenya||0) * (+r.pieces||0);
});
ship.shipments.filter(sx=>sx.arrivedAt && (!pid || sx.productId===pid)).forEach(sx=>{
byP[sx.productId] = byP[sx.productId] || { revenue:0, ad:0, ship:0, base:0, pieces:0 };
byP[sx.productId].ship += +sx.shipCost||0;
});

const tbody = $('#lifetimeTable tbody'); if (!tbody) return;
tbody.innerHTML = Object.entries(byP).map(([id,v])=>{
const name = productsById[id]?.name || id;
const profit = v.revenue - v.ad - v.ship - v.base;
return `<tr><td>${name}</td><td>${v.revenue.toFixed(2)}</td><td>${v.ad.toFixed(2)}</td><td>${v.ship.toFixed(2)}</td><td>${v.base.toFixed(2)}</td><td>${v.pieces}</td><td>${profit.toFixed(2)}</td></tr>`;
}).join('');
}catch{
const tbody = $('#lifetimeTable tbody'); if (tbody) tbody.innerHTML='';
}
});

// ---------- NAV & LOGIN ----------
$$('.nav a[data-view]').forEach(a=> a.onclick = (e)=>{
e.preventDefault();
setView(a.dataset.view);
if(a.dataset.view==='products') renderProducts();
if(a.dataset.view==='finance') renderFinanceCats();
});
$('#logoutLink') && ($('#logoutLink').onclick = async (e)=>{ e.preventDefault(); try{ await api('/api/logout', { method:'POST' }) }catch{}; location.reload(); });
$('#loginBtn') && ($('#loginBtn').onclick = async ()=>{
const p = $('#pw').value;
try{ await api('/api/auth',{ method:'POST', body: JSON.stringify({ password: p })}); await ensureMeta(); }
catch{ alert('Wrong password'); }
});

// ---------- boot ----------
renderTodos();
renderWeekly();
ensureMeta();
