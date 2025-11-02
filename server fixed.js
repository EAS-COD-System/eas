// server.js — rebuilt core with analytics fixes and transit finalize
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');

const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'db.json'); // user keeps db.json at root
const PUBLIC_DIR = path.join(ROOT, 'public');

function loadDB(){
  try{ return fs.readJsonSync(DB_FILE); }catch{ return {}; }
}
function saveDB(db){
  fs.writeJsonSync(DB_FILE, db, { spaces: 2 });
}

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/public', express.static(PUBLIC_DIR));

// ---- auth ----
function requireAuth(req,res,next){
  if(req.cookies && req.cookies.auth==='1') return next();
  return res.status(401).json({ error: 'unauthorized' });
}
app.post('/api/auth', (req,res)=>{
  const db = loadDB();
  if((req.body?.password||'') === (db.password||'')){
    res.cookie('auth','1',{ httpOnly:false, sameSite:'lax' });
    return res.json({ ok:true });
  }
  return res.status(403).json({ error:'bad password' });
});
app.get('/api/auth/status', (req,res)=>{
  res.json({ ok: req.cookies && req.cookies.auth==='1' });
});
app.post('/api/logout', (req,res)=>{
  res.clearCookie('auth'); res.json({ ok:true });
});

// ---- meta for client ----
app.get('/api/meta', requireAuth, (req,res)=>{
  const db = loadDB();
  res.json({ countries: db.countries||[], products: db.products||[] });
});

// ===== UTILITIES =====

// Weighted average product cost per piece from China (lifetime, across all China→Kenya shipments for this product)
function productCostPerPiece(db, productId){
  const shipments = (db.shipments||[]).filter(s => s.productId===productId && s.route==='china-kenya');
  let totalQty=0, totalChinaCost=0;
  shipments.forEach(s=>{
    const qty = +s.qty || 0;
    totalQty += qty;
    totalChinaCost += (+s.chinaCost || 0);
  });
  return totalQty>0 ? totalChinaCost / totalQty : 0;
}

// Weighted average ACTUAL shipping cost per piece to a given country
// If country is provided: use inter-country shipments to that country when present; otherwise fall back to China→Kenya average shipping cost.
function shippingCostPerPiece(db, productId, country){
  const all = db.shipments||[];
  let totalQty=0, totalShipCost=0;

  // Prefer inter-country route to the specific country
  if(country){
    all.filter(s => s.productId===productId && s.route==='inter-country' && s.to===country).forEach(s=>{
      const qty = +s.qty || 0;
      const final = (s.finalShipCost!=null ? +s.finalShipCost : (+s.estShipCost||0));
      // Only count if paid or final cost is set
      if(final>0 && (s.paymentStatus==='paid' || s.paymentStatus==='finalized' || s.paymentStatus==='settled')){
        totalQty += qty;
        totalShipCost += final;
      }
    });
  }

  // Fallback: China→Kenya shipping spread over pieces (when nothing above)
  if(totalQty===0){
    all.filter(s => s.productId===productId && s.route==='china-kenya').forEach(s=>{
      const qty = +s.qty || 0;
      const final = (s.finalShipCost!=null ? +s.finalShipCost : (+s.estShipCost||0));
      if(final>0){
        totalQty += qty;
        totalShipCost += final;
      }
    });
  }

  return totalQty>0 ? totalShipCost / totalQty : 0;
}

// ---- Logic 2 (used by Remittance Analytics, Profit by Country, Product pages) ----
// IMPORTANT FIX: Product Cost China and Total Shipping Cost are derived as *per-piece* costs (lifetime averages)
// multiplied by Delivered Pieces IN THE SELECTED PERIOD.
function calculateProfitMetricsLogic2(db, productId=null, country=null, startDate='2000-01-01', endDate='2100-01-01'){
  const remittances = db.remittances||[];
  const refunds     = db.refunds||[];
  const inflSpends  = db.influencerSpends||[];

  let totalRevenue=0, totalAdSpend=0, totalBoxleoFees=0;
  let totalDeliveredPieces=0, totalDeliveredOrders=0;
  let totalRefundedOrders=0, totalRefundedAmount=0, totalInfluencerSpend=0;
  let totalOrders=0;

  remittances.forEach(r=>{
    if ((productId? r.productId===productId : true)
      && (country? r.country===country : true)
      && (!startDate || (r.start||'') >= startDate)
      && (!endDate   || (r.end||'')   <= endDate)) {
        totalRevenue += +r.revenue || 0;
        totalAdSpend += +r.adSpend || 0;
        totalBoxleoFees += +r.boxleoFees || 0;
        totalDeliveredPieces += +r.pieces || 0;
        totalDeliveredOrders += +r.orders || 0;
        totalOrders += +r.orders || 0;
    }
  });

  refunds.forEach(f=>{
    if ((productId? f.productId===productId : true)
      && (country? f.country===country : true)
      && (!startDate || (f.date||'') >= startDate)
      && (!endDate   || (f.date||'') <= endDate)) {
        totalRefundedOrders += +f.orders || 0;
        totalRefundedAmount += +f.amount || 0;
    }
  });

  inflSpends.forEach(s=>{
    if ((productId? s.productId===productId : true)
      && (country? s.country===country : true)
      && (!startDate || (s.date||'') >= startDate)
      && (!endDate   || (s.date||'') <= endDate)) {
        totalInfluencerSpend += +s.amount || 0;
    }
  });

  const netDeliveredOrders = Math.max(0, totalDeliveredOrders - totalRefundedOrders);
  // LIFETIME per-piece cost baselines (do NOT filter by date; that was the bug #1 causing zeros)
  // If productId is null (aggregate by country), we average across all products weighted by their delivered pieces in the period.
  let totalProductChinaCost=0, totalShippingCost=0;

  if(productId){
    const ppp = productCostPerPiece(db, productId);
    const spp = shippingCostPerPiece(db, productId, country);
    totalProductChinaCost = ppp * totalDeliveredPieces;
    totalShippingCost     = spp * totalDeliveredPieces;
  }else{
    // Aggregate by country across items delivered in the period
    // Build per-product delivered pieces for weighting
    const deliveredByProduct = {};
    remittances.forEach(r=>{
      if ((country? r.country===country:true)
        && (!startDate || (r.start||'') >= startDate)
        && (!endDate   || (r.end||'')   <= endDate)){
          deliveredByProduct[r.productId] = (deliveredByProduct[r.productId]||0) + (+r.pieces||0);
      }
    });
    Object.entries(deliveredByProduct).forEach(([pid,pieces])=>{
      const ppp = productCostPerPiece(db, pid);
      const spp = shippingCostPerPiece(db, pid, country);
      totalProductChinaCost += ppp * pieces;
      totalShippingCost     += spp * pieces;
    });
  }

  const adjustedRevenue = Math.max(0, totalRevenue - totalRefundedAmount);
  const totalCost = totalProductChinaCost + totalShippingCost + totalBoxleoFees + totalAdSpend + totalInfluencerSpend;
  const profit = adjustedRevenue - totalCost;

  const deliveryRate = (totalOrders>0) ? Math.max(0, (netDeliveredOrders/totalOrders)*100) : 0;
  const costPerDeliveredOrder = (netDeliveredOrders>0) ? totalCost / netDeliveredOrders : 0;
  const costPerDeliveredPiece = (totalDeliveredPieces>0) ? totalCost / totalDeliveredPieces : 0;
  const adCostPerDeliveredOrder = (netDeliveredOrders>0) ? totalAdSpend / netDeliveredOrders : 0;
  const adCostPerDeliveredPiece = (totalDeliveredPieces>0) ? totalAdSpend / totalDeliveredPieces : 0;
  const boxleoPerDeliveredOrder = (netDeliveredOrders>0) ? totalBoxleoFees / netDeliveredOrders : 0;
  const boxleoPerDeliveredPiece = (totalDeliveredPieces>0) ? totalBoxleoFees / totalDeliveredPieces : 0;
  const influencerPerDeliveredOrder = (netDeliveredOrders>0) ? totalInfluencerSpend / netDeliveredOrders : 0;
  const averageOrderValue = (netDeliveredOrders>0) ? adjustedRevenue / netDeliveredOrders : 0;
  const profitPerOrder = (netDeliveredOrders>0) ? profit / netDeliveredOrders : 0;
  const profitPerPiece = (totalDeliveredPieces>0) ? profit / totalDeliveredPieces : 0;

  return {
    totalRevenue: adjustedRevenue,
    totalBoxleoFees, totalProductChinaCost, totalShippingCost,
    totalAdSpend, totalInfluencerSpend, totalRefundedAmount, totalRefundedOrders,
    totalCost, profit, totalDeliveredPieces, totalDeliveredOrders: netDeliveredOrders,
    totalOrders, deliveryRate, costPerDeliveredOrder, costPerDeliveredPiece,
    adCostPerDeliveredOrder, adCostPerDeliveredPiece,
    boxleoPerDeliveredOrder, boxleoPerDeliveredPiece, influencerPerDeliveredOrder,
    averageOrderValue, profitPerOrder, profitPerPiece,
    isProfitable: profit>0, hasData: (totalDeliveredPieces>0 || adjustedRevenue>0)
  };
}

// ===== API: Analytics =====
app.get('/api/analytics/remittance', requireAuth, (req,res)=>{
  const db = loadDB();
  const { start='2000-01-01', end='2100-01-01', country='', productId='all', sortBy='totalDeliveredPieces', sortOrder='desc' } = req.query||{};
  let rows = [];
  if(productId && productId!=='all'){
    if(country){
      const m = calculateProfitMetricsLogic2(db, productId, country, start, end);
      rows = [ { productId, productName: (db.products||[]).find(p=>p.id===productId)?.name || productId, country, ...m } ].filter(r=>r.hasData);
    }else{
      const countries = (db.countries||[]).filter(c=>c!=='china');
      rows = countries.map(c=>{
        const m = calculateProfitMetricsLogic2(db, productId, c, start, end);
        return { productId, productName: (db.products||[]).find(p=>p.id===productId)?.name || productId, country:c, ...m };
      }).filter(r=>r.hasData);
    }
  }else{
    const products = (db.products||[]);
    rows = products.map(p=>{
      const m = calculateProfitMetricsLogic2(db, p.id, country||null, start, end);
      return { productId: p.id, productName: p.name, country: country||'All Countries', ...m };
    }).filter(r=>r.hasData);
  }
  const sortKey = (a)=>{
    switch((sortBy||'').toLowerCase()){
      case 'profit': return a.profit;
      case 'totaldeliveredpieces': return a.totalDeliveredPieces;
      case 'totalrevenue': return a.totalRevenue;
      case 'totalorders': return a.totalOrders;
      case 'profitperorder': return a.profitPerOrder;
      case 'profitperpiece': return a.profitPerPiece;
      case 'deliveryrate': return a.deliveryRate;
      default: return a.totalDeliveredPieces;
    }
  };
  rows.sort((x,y)=> (sortOrder==='asc' ? (sortKey(x)-sortKey(y)) : (sortKey(y)-sortKey(x))));
  res.json({ analytics: rows, sortBy, sortOrder });
});

app.get('/api/analytics/profit-by-country', requireAuth, (req,res)=>{
  const db = loadDB();
  const { start='2000-01-01', end='2100-01-01', country='', sortBy='totalDeliveredPieces', sortOrder='desc' } = req.query||{};
  const countries = country ? [country] : (db.countries||[]).filter(c=>c!=='china');
  const rows = countries.map(c=>({ country:c, ...calculateProfitMetricsLogic2(db, null, c, start, end) }))
                        .filter(r=>r.hasData);
  const sortKey = (a)=>{
    switch((sortBy||'').toLowerCase()){
      case 'profit': return a.profit;
      case 'totaldeliveredpieces': return a.totalDeliveredPieces;
      case 'totalrevenue': return a.totalRevenue;
      case 'totalorders': return a.totalOrders;
      case 'profitperorder': return a.profitPerOrder;
      case 'profitperpiece': return a.profitPerPiece;
      case 'deliveryrate': return a.deliveryRate;
      default: return a.totalDeliveredPieces;
    }
  };
  rows.sort((x,y)=> (sortOrder==='asc' ? (sortKey(x)-sortKey(y)) : (sortKey(y)-sortKey(x))));
  res.json({ analytics: rows, sortBy, sortOrder });
});

// ===== API: Shipments (finalize) =====
app.post('/api/shipments/:id/finalize', requireAuth, (req,res)=>{
  const db = loadDB();
  const id = req.params.id;
  const amount = +req.body?.finalShipCost || 0;
  let found = null;
  db.shipments = (db.shipments||[]).map(s=>{
    if(s.id===id){
      found = s;
      s.finalShipCost = amount;
      s.paymentStatus = 'paid';
    }
    return s;
  });
  if(!found) return res.status(404).json({ error:'shipment not found' });
  saveDB(db);
  res.json({ ok:true, shipment: found });
});

// Basic stubs for products so client can render list
app.get('/api/products', requireAuth, (req,res)=>{
  const db = loadDB();
  res.json(db.products||[]);
});

// serve index.html
app.get('/', (req,res)=>{
  res.sendFile(path.join(ROOT, 'index.html'));
});
app.get('/product.html', (req,res)=>{
  res.sendFile(path.join(ROOT, 'product.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('EAS Tracker listening on '+PORT));