/* ============================================================
   EAS Tracker – app.js (rebuilt & optimized)
   ============================================================ */

/* -------------------------- helpers -------------------------- */
const Q  = (s, r=document) => r.querySelector(s);
const QA = (s, r=document) => Array.from(r.querySelectorAll(s));
const fmt = (n, d=2) => Number(n||0).toLocaleString(undefined, {maximumFractionDigits:d});
const todayISO = () => new Date().toISOString().slice(0,10);
const getParam = (k) => new URLSearchParams(location.search).get(k);

async function api(path, opts={}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...opts
  });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || data || `HTTP ${res.status}`);
  return data;
}

/* -------------------------- global state -------------------------- */
const state = {
  countries: [],
  products: [],
  adspend: [],
  shipments: [],
  remittances: [],
  deliveries: [],
  financeCats: { debit: [], credit: [] },
  productId: getParam("id") || null,
  product: null
};

/* -------------------------- boot/login -------------------------- */
async function boot() {
  try {
    await loadMeta();
    showMain();
    await loadAll();
    initUI();
  } catch {
    showLogin();
  }
}

function showLogin() {
  Q("#login")?.classList.remove("hide");
  Q("#main")?.setAttribute("style","display:none");
  const form = Q("#loginForm");
  const btn  = Q("#loginBtn");
  const inp  = Q("#pw");

  const doLogin = async (e)=>{
    e?.preventDefault();
    const pw = inp.value.trim();
    if(!pw) return alert("Enter password");
    try {
      btn.disabled=true;
      await api("/api/auth",{method:"POST",body:JSON.stringify({password:pw})});
      showMain();
      await loadMeta();
      await loadAll();
      initUI();
    } catch(err) {
      alert(err.message || "Wrong password");
    } finally { btn.disabled=false; }
  };
  form?.addEventListener("submit",doLogin);
  btn?.addEventListener("click",doLogin);
  inp?.addEventListener("keydown",e=>{ if(e.key==="Enter") doLogin(e); });
}
function showMain(){
  Q("#login")?.classList.add("hide");
  Q("#main")?.removeAttribute("style");
}
Q("#logoutLink")?.addEventListener("click",async e=>{
  e.preventDefault();
  await api("/api/auth",{method:"POST",body:JSON.stringify({password:"logout"})});
  location.reload();
});

/* -------------------------- data loading -------------------------- */
async function loadMeta(){
  const meta = await api("/api/countries");
  state.countries = meta.countries || [];
}
async function loadAll(){
  const [p,a,s,r,d,f] = await Promise.all([
    api("/api/products"), api("/api/adspend"), api("/api/shipments"),
    api("/api/remittances"), api("/api/deliveries"), api("/api/finance/categories")
  ]);
  state.products = p.products || [];
  state.adspend  = a.adspend || [];
  state.shipments= s.shipments || [];
  state.remittances=r.remittances || [];
  state.deliveries=d.deliveries || [];
  state.financeCats=f || {debit:[],credit:[]};
}

/* -------------------------- init UI -------------------------- */
async function initUI(){
  fillSelects();
  initNav();
  if(state.productId){ await loadProduct(); renderProductPage(); }
  else { renderDashboard(); initProducts(); initPerformance(); initFinance(); initSettings(); }
}

/* -------------------------- selects -------------------------- */
function fillSelects(){
  const addAll = (arr)=> arr.map(c=>`<option value="${c}">${c}</option>`).join('');
  // all country selects
  QA("select.country").forEach(el=>{
    const name = el.id || "";
    const excludeChina = name.includes("rCountry");
    const list = excludeChina ? state.countries.filter(c=>c!=="china") : state.countries;
    const addAllOption = name==="pfCountry" ? `<option value="">All countries</option>` : "";
    el.innerHTML = addAllOption + addAll(list);
  });
  // product selects
  QA("select.product").forEach(el=>{
    el.innerHTML = state.products.map(p=>`<option value="${p.id}">${p.name}</option>`).join("");
  });
}

/* -------------------------- dashboard -------------------------- */
function renderDashboard(){
  Q("#kpiProducts").textContent = state.products.length;
  Q("#kpiCountries").textContent = state.countries.length;

  const totalAd = state.adspend.reduce((a,b)=>a+(+b.amount||0),0);
  Q("#kpiAdSpend").textContent = fmt(totalAd)+" USD";

  const weekStart = new Date(); weekStart.setDate(weekStart.getDate()-weekStart.getDay());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate()+7);
  const ws = weekStart.toISOString().slice(0,10), we=weekEnd.toISOString().slice(0,10);
  const totalDelivered = state.deliveries.filter(x=>x.date>=ws && x.date<=we)
    .reduce((a,b)=>a+(+b.delivered||0),0);
  Q("#kpiDelivered").textContent = fmt(totalDelivered,0);
}

/* -------------------------- products -------------------------- */
function initProducts(){
  const btnAdd = Q("#pAdd");
  btnAdd?.addEventListener("click",async()=>{
    const name=Q("#pName").value.trim();
    if(!name) return alert("Name required");
    const payload={
      name, sku:Q("#pSku").value.trim(),
      cost_china:+Q("#pCost").value||0,
      ship_china_to_kenya:+Q("#pShip").value||0,
      margin_budget:+Q("#pMB").value||0
    };
    await api("/api/products",{method:"POST",body:JSON.stringify(payload)});
    const res = await api("/api/products");
    state.products=res.products; renderProducts();
  });
  renderProducts();
}
function renderProducts(){
  const tb=Q("#productsTable tbody");
  tb.innerHTML = state.products.map(p=>`
    <tr>
      <td>${p.name}</td>
      <td>${p.sku||"-"}</td>
      <td><span class="badge ${p.status==="paused"?"muted":""}">${p.status||"active"}</span></td>
      <td>
        <a class="btn" href="product.html?id=${p.id}">Open</a>
        <button class="btn outline danger" data-del="${p.id}">Delete</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="4" class="muted">No products</td></tr>`;
  tb.onclick=async e=>{
    const id=e.target.dataset.del;
    if(id && confirm("Delete this product from all system data?")){
      await api("/api/products/"+id,{method:"DELETE"});
      state.products=state.products.filter(x=>x.id!==id);
      renderProducts();
    }
  };
}

/* -------------------------- performance -------------------------- */
function initPerformance(){
  const runBtn=Q("#pfRun");
  runBtn?.addEventListener("click",async()=>{
    const c=Q("#pfCountry").value;
    const r=await api("/api/remittances");
    const list=r.remittances||[];
    const byProd={};
    list.forEach(x=>{
      if(c && x.country!==c) return;
      const id=x.productId;
      if(!byProd[id]) byProd[id]={pcs:0,rev:0,ad:0,prod:null};
      const p=state.products.find(p=>p.id===id);
      byProd[id].prod=p?p.name:id;
      byProd[id].pcs+=+x.pieces||0;
      byProd[id].rev+=+x.revenue||0;
      byProd[id].ad+=+x.adSpend||0;
    });
    const tb=Q("#pfTable tbody");
    tb.innerHTML=Object.values(byProd).map(p=>`
      <tr><td>${p.prod}</td><td>${fmt(p.pcs,0)}</td><td>${fmt(p.rev)}</td><td>${fmt(p.ad)}</td></tr>`
    ).join("")||`<tr><td colspan="4" class="muted">No data</td></tr>`;
  });
}

/* -------------------------- finance -------------------------- */
function initFinance(){
  const tb=Q("#feTable tbody");
  const addBtn=Q("#feAdd");
  addBtn?.addEventListener("click",async()=>{
    const d=Q("#feDate").value; const t=Q("#feType").value;
    const c=Q("#feCat").value; const a=+Q("#feAmt").value||0; const n=Q("#feNote").value;
    if(!d||!t||!c) return alert("Fill required fields");
    await api("/api/finance/entries",{method:"POST",body:JSON.stringify({date:d,type:t,category:c,amount:a,note:n})});
    renderFinance();
  });
  renderFinance();
}
async function renderFinance(){
  const r=await api("/api/finance/entries");
  const tb=Q("#feTable tbody");
  tb.innerHTML=(r.entries||[]).map(x=>`
    <tr><td>${x.date}</td><td>${x.type}</td><td>${x.category}</td><td>${fmt(x.amount)}</td><td>${x.note||""}</td></tr>`
  ).join("")||`<tr><td colspan="5" class="muted">No entries</td></tr>`;
}

/* -------------------------- settings -------------------------- */
function initSettings(){
  const ctyAdd=Q("#ctyAdd");
  ctyAdd?.addEventListener("click",async()=>{
    const n=Q("#cty").value.trim();
    if(!n) return;
    await api("/api/countries",{method:"POST",body:JSON.stringify({name:n})});
    const r=await api("/api/countries");
    state.countries=r.countries; renderCountries();
  });
  renderCountries();
  renderSnapshots();
}
function renderCountries(){
  const box=Q("#ctyList");
  box.innerHTML=state.countries.map(c=>`
    <span class="chip">${c}${c!=="china"?` <button class="x" data-del="${c}">×</button>`:""}</span>`
  ).join("")||"—";
  box.onclick=async e=>{
    const n=e.target.dataset.del;
    if(n && confirm(`Delete country "${n}"?`)){
      await api("/api/countries/"+n,{method:"DELETE"});
      const r=await api("/api/countries"); state.countries=r.countries; renderCountries();
    }
  };
}
async function renderSnapshots(){
  const r=await api("/api/snapshots");
  const tb=Q("#snapList");
  tb.innerHTML=(r.snapshots||[]).map(s=>`
    <tr><td>${s.name}</td><td>${s.file}</td>
    <td><button class="btn outline" data-push="${s.file}">Push</button>
    <button class="btn outline danger" data-del="${s.id}">Delete</button></td></tr>`
  ).join("")||`<tr><td colspan="3" class="muted">No snapshots</td></tr>`;
  tb.onclick=async e=>{
    const f=e.target.dataset.push,d=e.target.dataset.del;
    if(f){ await api("/api/snapshots/restore",{method:"POST",body:JSON.stringify({file:f})}); alert("Snapshot restored"); }
    if(d && confirm("Delete snapshot?")){ await api("/api/snapshots/"+d,{method:"DELETE"}); renderSnapshots(); }
  };
}

/* -------------------------- product page -------------------------- */
async function loadProduct(){
  const r=await api("/api/products");
  state.products=r.products;
  state.product=state.products.find(p=>p.id===state.productId);
}
function renderProductPage(){
  const p=state.product; if(!p) return;
  Q("#pdTitle").textContent=p.name;
  Q("#pdSku").textContent=p.sku||"";
}

/* -------------------------- nav -------------------------- */
function initNav(){
  QA(".nav a[data-view]").forEach(a=>{
    a.addEventListener("click",e=>{
      e.preventDefault();
      const v=a.dataset.view;
      ["home","products","performance","finance","settings"].forEach(id=>{
        const el=Q("#"+id);
        if(el) el.style.display=id===v?"":"none";
      });
      QA(".nav a").forEach(x=>x.classList.toggle("active",x===a));
      if(v==="home") renderDashboard();
    });
  });
}

/* -------------------------- start -------------------------- */
boot();
