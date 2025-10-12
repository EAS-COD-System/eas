/* ===========================================================
   Product Page Logic (matches product.html ids: pd*)
   =========================================================== */
(function () {
  const params = new URLSearchParams(location.search);
  const productId = params.get('id');
  if (!productId) return;

  // tiny helpers from app.js are available: Q, QA, api, fmt, todayISO, state
  const waitReady = async () => {
    if (window.state && Array.isArray(state.products)) return;
    await new Promise(r => setTimeout(r, 50));
    return waitReady();
  };

  (async function init() {
    await waitReady();

    // find product
    const p = state.products.find(x => x.id === productId);
    if (!p) {
      document.body.innerHTML =
        '<div class="container"><h2>Product not found</h2></div>';
      return;
    }

    // header
    Q('#pdTitle').textContent = p.name;
    Q('#pdSku').textContent = p.sku ? `SKU: ${p.sku}` : '';

    /* ---------- 1) Stock & Ad Spend by Country (this product) ---------- */
    const countries = state.countries.filter(c => c.toLowerCase() !== 'china');
    const by = new Map(countries.map(c => [c, { stock: 0, ad: 0 }]));

    // arrived shipments affect stock
    state.shipments
      .filter(s => s.productId === productId && s.arrivedAt)
      .forEach(s => {
        if (by.has(s.fromCountry)) by.get(s.fromCountry).stock -= (+s.qty || 0);
        if (by.has(s.toCountry)) by.get(s.toCountry).stock += (+s.qty || 0);
      });

    // ad spend for this product (exclude China)
    state.adspend
      .filter(a => a.productId === productId && a.country.toLowerCase() !== 'china')
      .forEach(a => {
        if (by.has(a.country)) by.get(a.country).ad += (+a.amount || 0);
      });

    let tStock = 0, tAd = 0;
    Q('#pdStockBody').innerHTML = countries.map(c => {
      const v = by.get(c) || { stock: 0, ad: 0 };
      tStock += v.stock; tAd += v.ad;
      return `<tr><td>${c}</td><td>${fmt(v.stock)}</td><td>${fmt(v.ad)}</td></tr>`;
    }).join('') || `<tr><td colspan="3" class="muted">No data</td></tr>`;
    Q('#pdStockTotal').textContent = fmt(tStock);
    Q('#pdAdTotal').textContent = fmt(tAd);

    /* ---------- 2) Profit + Ads Budget (manual per country) ---------- */
    // Fill country select (exclude China)
    (function fillPBCountry() {
      const sel = Q('#pdPBCountry');
      if (!sel) return;
      sel.innerHTML = countries.map(c => `<option value="${c}">${c}</option>`).join('');
    })();

    const budgets = p.budgets || {};
    const drawBudgets = () => {
      const body = Q('#pdPBBBody');
      if (!body) return;
      const rows = Object.keys(budgets).sort().map(c => `
        <tr data-c="${c}">
          <td>${c}</td>
          <td>${fmt(+budgets[c] || 0)}</td>
          <td><button class="btn xs danger outline" data-clear>Clear</button></td>
        </tr>`);
      body.innerHTML = rows.join('') || `<tr><td colspan="3" class="muted">No budgets</td></tr>`;
    };
    drawBudgets();

    Q('#pdPBSave')?.addEventListener('click', async () => {
      const c = Q('#pdPBCountry').value;
      const v = +Q('#pdPBValue').value || 0;
      const payload = { budgets: { ...(p.budgets || {}), [c]: v } };
      await api(`/api/products/${p.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      Object.assign(p, payload);
      drawBudgets();
      Q('#pdPBValue').value = '';
    });

    Q('#pdPBBBody')?.addEventListener('click', async (e) => {
      if (!e.target.matches('[data-clear]')) return;
      const c = e.target.closest('tr')?.dataset.c;
      const clone = { ...(p.budgets || {}) };
      delete clone[c];
      const payload = { budgets: clone };
      await api(`/api/products/${p.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      Object.assign(p, payload);
      drawBudgets();
    });

    /* ---------- 3) Daily Ad Spend (replace per platform+country) ---------- */
    // Fill countries for this section
    (function fillAdCountries() {
      const sel = Q('#pdAdCountry');
      if (sel) sel.innerHTML = countries.map(c => `<option value="${c}">${c}</option>`).join('');
    })();

    const drawAdTable = () => {
      const body = Q('#pdAdBody');
      if (!body) return;
      const rows = (state.adspend || [])
        .filter(a => a.productId === productId && a.country.toLowerCase() !== 'china')
        .map(a => `<tr><td>${a.country}</td><td>${a.platform}</td><td>${fmt(a.amount)}</td></tr>`);
      body.innerHTML = rows.join('') || `<tr><td colspan="3" class="muted">No spends</td></tr>`;
    };
    drawAdTable();

    Q('#pdAdSave')?.addEventListener('click', async () => {
      const platform = Q('#pdAdPlatform').value;
      const country = Q('#pdAdCountry').value;
      const amount = +Q('#pdAdAmount').value || 0;
      await api('/api/adspend', { method: 'POST', body: JSON.stringify({ productId, platform, country, amount }) });
      state.adspend = (await api('/api/adspend')).adSpends || [];
      Q('#pdAdAmount').value = '';
      drawAdTable();
    });

    /* ---------- 5–7) Transit (this product) ---------- */
    const CK = Q('#pdShipCKBody');
    const IC = Q('#pdShipICBody');

    const drawShipments = () => {
      const rows = (state.shipments || []).filter(s => s.productId === productId).map(s => {
        const days = s.arrivedAt
          ? Math.max(1, Math.ceil((new Date(s.arrivedAt) - new Date(s.departedAt)) / (24 * 3600 * 1000)))
          : '—';
        return {
          s,
          ck: s.fromCountry?.toLowerCase() === 'china' && s.toCountry?.toLowerCase() === 'kenya',
          html: `<tr data-id="${s.id}">
            <td>${s.id.slice(0,8)}…</td>
            <td>${s.fromCountry} → ${s.toCountry}</td>
            <td><input class="mini" data-edit="qty" value="${s.qty || 0}"></td>
            <td><input class="mini" data-edit="shipCost" value="${s.shipCost || 0}"></td>
            <td><input class="mini" data-edit="departedAt" type="date" value="${s.departedAt || ''}"></td>
            <td>${s.arrivedAt ? s.arrivedAt : `<input class="mini" data-edit="arrivedAt" type="date">`}</td>
            <td>${days}</td>
            <td>
              ${s.arrivedAt ? '' : '<button class="btn xs" data-act="arrive">Mark Arrived</button>'}
              <button class="btn xs danger outline" data-act="delete">Delete</button>
            </td>
          </tr>`
        };
      });

      CK.innerHTML = rows.filter(r => r.ck).map(r => r.html).join('') || `<tr><td colspan="8" class="muted">No data</td></tr>`;
      IC.innerHTML = rows.filter(r => !r.ck).map(r => r.html).join('') || `<tr><td colspan="8" class="muted">No data</td></tr>`;
    };
    drawShipments();

    function attachShipHandlers(root) {
      root.onclick = async (e) => {
        const tr = e.target.closest('tr[data-id]'); if (!tr) return;
        const id = tr.dataset.id;

        if (e.target.dataset.act === 'delete') {
          if (!confirm('Delete this shipment?')) return;
          await api(`/api/shipments/${id}`, { method: 'DELETE' });
          state.shipments = (await api('/api/shipments')).shipments || [];
          drawShipments();
          return;
        }
        if (e.target.dataset.act === 'arrive') {
          const v = tr.querySelector('input[data-edit="arrivedAt"]')?.value || todayISO();
          await api(`/api/shipments/${id}`, { method: 'PUT', body: JSON.stringify({ arrivedAt: v }) });
          state.shipments = (await api('/api/shipments')).shipments || [];
          drawShipments();
          return;
        }
        if (e.target.matches('input[data-edit]')) {
          e.target.addEventListener('change', async () => {
            const payload = {};
            payload[e.target.dataset.edit] = e.target.type === 'number' ? +e.target.value : e.target.value;
            await api(`/api/shipments/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            state.shipments = (await api('/api/shipments')).shipments || [];
            drawShipments();
          }, { once: true });
        }
      };
    }
    attachShipHandlers(CK);
    attachShipHandlers(IC);

    /* ---------- 8) Lifetime (this product) ---------- */
    const lpBody = Q('#pdLPBody');
    const recalcLifetime = () => {
      const byC = {};
      state.remittances
        .filter(r => r.productId === productId && r.country.toLowerCase() !== 'china')
        .forEach(r => {
          const c = r.country;
          if (!byC[c]) byC[c] = { rev: 0, ad: 0, ship: 0, base: 0, pieces: 0, profit: 0 };
          const basePer = (+p.cost_china || 0) + (+p.ship_china_to_kenya || 0);
          const extra = (+r.extraPerPiece || 0) * (+r.pieces || 0);
          const prodCost = basePer * (+r.pieces || 0);
          byC[c].rev += (+r.revenue || 0);
          byC[c].ad += (+r.adSpend || 0);
          byC[c].base += prodCost;
          byC[c].pieces += (+r.pieces || 0);
          byC[c].profit += (+r.revenue || 0) - (+r.adSpend || 0) - prodCost - extra;
        });

      let tR=0,tA=0,tS=0,tB=0,tP=0,tPr=0;
      lpBody.innerHTML = Object.entries(byC).map(([c,v]) => {
        tR+=v.rev; tA+=v.ad; tB+=v.base; tP+=v.pieces; tPr+=v.profit;
        return `<tr><td>${c}</td><td>${fmt(v.rev)}</td><td>${fmt(v.ad)}</td><td>${fmt(v.ship)}</td><td>${fmt(v.base)}</td><td>${fmt(v.pieces)}</td><td>${fmt(v.profit)}</td></tr>`;
      }).join('') || `<tr><td colspan="7" class="muted">No data</td></tr>`;
      Q('#pdLPRevT').textContent = fmt(tR);
      Q('#pdLPAdT').textContent = fmt(tA);
      Q('#pdLPShipT').textContent = fmt(tS);
      Q('#pdLPBaseT').textContent = fmt(tB);
      Q('#pdLPPcsT').textContent = fmt(tP);
      Q('#pdLPProfitT').textContent = fmt(tPr);
    };
    recalcLifetime();

    /* ---------- 9) Influencers (add, spends, filter) ---------- */
    // fill country selects (exclude China)
    const fillCountrySel = (el) => {
      if (!el) return;
      el.innerHTML = countries.map(c => `<option value="${c}">${c}</option>`).join('');
    };
    fillCountrySel(Q('#pdInfCountry'));
    fillCountrySel(Q('#pdInfFilterCountry'));

    // influencer selects
    const infSelect = Q('#pdInfSelect');
    const fillInfSelects = () => {
      if (infSelect) {
        infSelect.innerHTML = state.influencers.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
      }
    };
    fillInfSelects();

    Q('#pdInfAdd')?.addEventListener('click', async () => {
      const name = (Q('#pdInfName').value || '').trim();
      if (!name) return alert('Name required');
      const social = Q('#pdInfSocial').value || '';
      const country = Q('#pdInfCountry').value || '';
      const r = await api('/api/influencers', { method: 'POST', body: JSON.stringify({ name, social, country }) });
      state.influencers.push(r.influencer);
      Q('#pdInfName').value = ''; Q('#pdInfSocial').value = '';
      fillInfSelects();
      drawSpends();
    });

    Q('#pdInfSpendAdd')?.addEventListener('click', async () => {
      const date = Q('#pdInfDate').value || todayISO();
      const influencerId = Q('#pdInfSelect').value;
      const country = Q('#pdInfCountry').value;
      const amount = +Q('#pdInfAmount').value || 0;
      if (!influencerId) return alert('Pick influencer');
      await api('/api/influencers/spend', { method: 'POST', body: JSON.stringify({ date, influencerId, country, productId, amount }) });
      state.influencerSpends = (await api('/api/influencers/spend')).spends || [];
      Q('#pdInfAmount').value = '';
      drawSpends();
    });

    function drawSpends() {
      const sBody = Q('#pdInfBody');
      const nameOf = Object.fromEntries(state.influencers.map(i => [i.id, i.name]));
      let list = (state.influencerSpends || []).filter(s => s.productId === productId);

      const fs = Q('#pdInfStart')?.value;
      const fe = Q('#pdInfEnd')?.value;
      const fc = Q('#pdInfFilterCountry')?.value;
      if (fs) list = list.filter(x => x.date >= fs);
      if (fe) list = list.filter(x => x.date <= fe);
      if (fc) list = list.filter(x => x.country === fc);

      const total = list.reduce((a, s) => a + (+s.amount || 0), 0);
      Q('#pdInfTotal').textContent = fmt(total);

      sBody.innerHTML = list
        .sort((a,b) => b.date.localeCompare(a.date))
        .map(s => `<tr data-id="${s.id}">
            <td>${s.date}</td><td>${s.country || ''}</td>
            <td>${nameOf[s.influencerId] || '—'}</td><td>${p ? p.name : ''}</td>
            <td>${fmt(s.amount)}</td>
            <td><button class="btn xs danger outline" data-del>Delete</button></td>
          </tr>`).join('') || `<tr><td colspan="6" class="muted">No spends</td></tr>`;
    }
    drawSpends();

    Q('#pdInfRun')?.addEventListener('click', drawSpends);

    Q('#pdInfBody')?.addEventListener('click', async (e) => {
      if (!e.target.matches('[data-del]')) return;
      const id = e.target.closest('tr')?.dataset.id;
      await api(`/api/influencers/spend/${id}`, { method: 'DELETE' });
      state.influencerSpends = (await api('/api/influencers/spend')).spends || [];
      drawSpends();
    });
  })();
})();
