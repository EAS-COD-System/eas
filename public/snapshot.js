/* ===========================================================
   Product Page Logic (runs after /public/app.js gate())
   =========================================================== */

(function(){
  const params = new URLSearchParams(location.search);
  const productId = params.get('id');

  if (!productId) return;

  // wait for gate() to preload; poll briefly if needed
  const ready = () => window.state && state.products && state.products.length>=0;
  const wait = async () => { if (ready()) return; await new Promise(r=>setTimeout(r,50)); return wait(); };

  (async function init(){
    await wait();
    const p = state.products.find(x=>x.id===productId);
    if (!p) { document.body.innerHTML = '<div class="container"><h2>Product not found</h2></div>'; return; }
    Q('#pTitle').textContent = p.name;

    // Fill selects (countries exclude China by default)
    QA('select.input[data-exclude="china"]').forEach(fillCountrySelect);
    const infSel = Q('#isInf');
    infSel.innerHTML = state.influencers.map(i=>`<option value="${i.id}">${i.name}</option>`).join('');

    // Influencer add
    Q('#infAdd')?.addEventListener('click', async ()=>{
      const name=(Q('#infName').value||'').trim();
      if (!name) return alert('Name required');
      const social=Q('#infSocial').value||'';
      const country=Q('#infCountry').value||'';
      const r=await api('/api/influencers', { method:'POST', body: JSON.stringify({ name, social, country })});
      state.influencers.push(r.influencer);
      Q('#infName').value=''; Q('#infSocial').value='';
      Q('#infCountry').selectedIndex=0;
      Q('#isInf').innerHTML = state.influencers.map(i=>`<option value="${i.id}">${i.name}</option>`).join('');
      drawInfluencerSpends();
    });

    // Influencer spend add (for this product)
    Q('#isAdd')?.addEventListener('click', async ()=>{
      const date=Q('#isDate').value||new Date().toISOString().slice(0,10);
      const influencerId=Q('#isInf').value;
      const country=Q('#isCountry').value;
      const amount=+Q('#isAmt').value||0;
      if (!influencerId) return alert('Pick influencer');
      await api('/api/influencers/spend',{ method:'POST', body: JSON.stringify({ date, influencerId, country, productId, amount })});
      const r = await api('/api/influencers/spend');
      state.influencerSpends = r.spends||[];
      Q('#isAmt').value='';
      drawInfluencerSpends();
    });

    // table actions (delete spend / delete influencer)
    Q('#isTable')?.addEventListener('click', async e=>{
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const id = tr.dataset.id;
      if (e.target.matches('[data-del-spend]')){
        await api(`/api/influencers/spend/${id}`, { method:'DELETE' });
        state.influencerSpends = (await api('/api/influencers/spend')).spends||[];
        drawInfluencerSpends();
      }
    });

    // stock & adspend (product)
    const countries = state.countries.filter(c=>c.toLowerCase()!=='china');
    const map = new Map(countries.map(c=>[c,{stock:0,ad:0}]));
    // arrived shipments affect stock per product
    state.shipments.filter(s=>s.productId===productId && s.arrivedAt).forEach(s=>{
      if (map.has(s.fromCountry)) map.get(s.fromCountry).stock -= (+s.qty||0);
      if (map.has(s.toCountry))   map.get(s.toCountry).stock   += (+s.qty||0);
    });
    // adspend per product
    state.adspend.filter(a=>a.productId===productId && a.country.toLowerCase()!=='china').forEach(a=>{
      if (map.has(a.country)) map.get(a.country).ad += (+a.amount||0);
    });
    let tS=0,tA=0;
    Q('#pStockBody').innerHTML = countries.map(c=>{
      const m = map.get(c)||{stock:0,ad:0}; tS+=m.stock; tA+=m.ad;
      return `<tr><td>${c}</td><td>${fmt(m.stock)}</td><td>${fmt(m.ad)}</td></tr>`;
    }).join('') || `<tr><td colspan="3" class="muted">No countries</td></tr>`;
    Q('#pStockT').textContent = fmt(tS); Q('#pAdT').textContent = fmt(tA);

    // transit (this product only)
    const body = Q('#pShipBody');
    const rows = state.shipments.filter(s=>s.productId===productId).map(s=>{
      const days = s.arrivedAt ? Math.max(1, Math.ceil((new Date(s.arrivedAt)-new Date(s.departedAt))/(24*3600*1000))) : '—';
      return `<tr data-id="${s.id}">
        <td>${s.id.slice(0,8)}…</td>
        <td>${s.fromCountry} → ${s.toCountry}</td>
        <td><input class="mini" data-edit="qty" value="${s.qty||0}"></td>
        <td><input class="mini" data-edit="shipCost" value="${s.shipCost||0}"></td>
        <td><input class="mini" data-edit="departedAt" type="date" value="${s.departedAt||''}"></td>
        <td>${s.arrivedAt ? s.arrivedAt : `<input class="mini" data-edit="arrivedAt" type="date">`}</td>
        <td>${days}</td>
        <td>
          ${s.arrivedAt ? '' : '<button class="btn xs" data-act="arrive">Mark Arrived</button>'}
          <button class="btn xs danger outline" data-act="delete">Delete</button>
        </td>
      </tr>`;
    });
    body.innerHTML = rows.join('') || `<tr><td colspan="8" class="muted">No shipments</td></tr>`;

    body.onclick = async e=>{
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const id = tr.dataset.id;
      if (e.target.dataset.act==='delete'){
        if (!confirm('Delete this shipment?')) return;
        await api(`/api/shipments/${id}`, { method:'DELETE' });
        state.shipments = (await api('/api/shipments')).shipments||[];
        location.replace(location.href); // stay on product page
        return;
      }
      if (e.target.dataset.act==='arrive'){
        const v = tr.querySelector('input[data-edit="arrivedAt"]')?.value || new Date().toISOString().slice(0,10);
        await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify({ arrivedAt:v })});
        state.shipments = (await api('/api/shipments')).shipments||[];
        location.replace(location.href); // stay on page and refresh
        return;
      }
      if (e.target.matches('input[data-edit]')){
        e.target.addEventListener('change', async ()=>{
          const payload={}; payload[e.target.dataset.edit] = e.target.type==='number' ? +e.target.value : e.target.value;
          await api(`/api/shipments/${id}`, { method:'PUT', body: JSON.stringify(payload) });
          state.shipments = (await api('/api/shipments')).shipments||[];
        }, { once:true });
      }
    };

    // influencer spends table (this product)
    function drawInfluencerSpends(){
      const tb = Q('#isTable tbody');
      const nameOf = Object.fromEntries(state.influencers.map(i=>[i.id,i.name]));
      const rows = (state.influencerSpends||[])
        .filter(s=>s.productId===productId)
        .sort((a,b)=> b.date.localeCompare(a.date))
        .map(s=>`<tr data-id="${s.id}">
          <td>${s.date}</td><td>${nameOf[s.influencerId]||'—'}</td><td>${s.country||''}</td><td>${fmt(s.amount)}</td>
          <td><button class="btn xs danger outline" data-del-spend>Delete</button></td>
        </tr>`);
      tb.innerHTML = rows.join('') || `<tr><td colspan="5" class="muted">No spends</td></tr>`;
    }
    drawInfluencerSpends();

    // lifetime table (this product, by country)
    const bodyL = Q('#plifeBody');
    const byC = {};
    state.remittances.filter(r=>r.productId===productId && r.country.toLowerCase()!=='china').forEach(r=>{
      const c=r.country;
      if (!byC[c]) byC[c]={rev:0,ad:0,ship:0,base:0,pieces:0,profit:0};
      const base = (+p.cost_china||0) + (+p.ship_china_to_kenya||0);
      const extra = (+r.extraPerPiece||0) * (+r.pieces||0);
      const prodCost = base * (+r.pieces||0);
      byC[c].rev += (+r.revenue||0);
      byC[c].ad  += (+r.adSpend||0);
      byC[c].base+= prodCost;
      byC[c].pieces += (+r.pieces||0);
      byC[c].profit += (+r.revenue||0) - (+r.adSpend||0) - prodCost - extra;
    });
    let tR=0,tA=0,tS=0,tB=0,tP=0,tPr=0;
    bodyL.innerHTML = Object.entries(byC).map(([c,v])=>{
      tR+=v.rev; tA+=v.ad; tB+=v.base; tP+=v.pieces; tPr+=v.profit;
      return `<tr><td>${c}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pieces)}</td><td>${fmt(v.profit)}</td></tr>`;
    }).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
    Q('#plRevT').textContent=fmt(tR);
    Q('#plAdT').textContent =fmt(tA);
    Q('#plShipT').textContent=fmt(tS);
    Q('#plBaseT').textContent=fmt(tB);
    Q('#plPiecesT').textContent=fmt(tP);
    Q('#plProfitT').textContent=fmt(tPr);
  })();
})();
