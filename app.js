/* ═══════════════════════════════════════════════════════
   CHAAM RetailOS — Application Logic
   Spec: CHAAM_mobile_uiux_claude_spec_AUDITED_FINAL.json
   ═══════════════════════════════════════════════════════ */

// ═══ CONFIG ═══
const CONFIG = {
  API_BASE: localStorage.getItem('chaam_api') ||
    (location.protocol.startsWith('http') ? location.origin + '/api' : 'http://localhost:8787/api'),
  TOKEN: localStorage.getItem('chaam_token') || '',
  ROLE: localStorage.getItem('chaam_role') || 'store',  // store | brand | system (از سرور تعیین می‌شود)
  TIMEOUT: 6000,
};

let ONLINE = false;
let STATE = {
  invoice: { items: [], no: 'F-00001' },
  products: [],
  personnel: [],
  kpi: null,
  okr: null,
  warnings: [],
  invoices: JSON.parse(localStorage.getItem('chaam_invoices') || '[]'),
};

// ═══════════════════════════════════════════════════════
// MOCK DATA (fallback when connector offline)
// ═══════════════════════════════════════════════════════
const MOCK = {
  products: [
    {sku:'SKU-0001',barcode:'CHSHLSNDCR1',name:'شلوار لینن سندبادی کرم ۱',category:'شلوار',unitPrice:3490000,unitCost:1590000,stock:8},
    {sku:'SKU-0002',barcode:'CHSHLSNDBK1',name:'شلوار لینن سندبادی مشکی ۱',category:'شلوار',unitPrice:3490000,unitCost:1590000,stock:3},
    {sku:'SKU-0003',barcode:'CHSMSYHWH1',name:'شومیز سایه سفید ۱',category:'شومیز',unitPrice:1680000,unitCost:760000,stock:12},
    {sku:'SKU-0004',barcode:'CHSMGPRYL FR',name:'شومیز گیپور زرد فری',category:'شومیز',unitPrice:2100000,unitCost:950000,stock:0},
    {sku:'SKU-0005',barcode:'CHKTLNNBKFR',name:'کت لینن مشکی فری',category:'کت',unitPrice:3780000,unitCost:1720000,stock:5},
    {sku:'SKU-0006',barcode:'CHSHNKLBK1',name:'شلوار نیکول مشکی ۱',category:'شلوار',unitPrice:2800000,unitCost:1270000,stock:2},
    {sku:'SKU-0007',barcode:'CHSMJNACR1',name:'شومیز جانا کرم ۱',category:'شومیز',unitPrice:2400000,unitCost:1090000,stock:9},
    {sku:'SKU-0008',barcode:'CHSHKTRBK1',name:'شلوار کاترین مشکی ۱',category:'شلوار',unitPrice:2900000,unitCost:1320000,stock:1},
    {sku:'SKU-0009',barcode:'CHDMLDYBKFR',name:'دامن لیدی مشکی فری',category:'دامن',unitPrice:2200000,unitCost:1000000,stock:7},
    {sku:'SKU-0010',barcode:'CHTPMYARD1',name:'تاپ مایا قرمز ۱',category:'تاپ',unitPrice:1400000,unitCost:640000,stock:0},
    {sku:'SKU-0011',barcode:'CHVSDPLBKFR',name:'وست دیپلمات مشکی فری',category:'وست',unitPrice:3200000,unitCost:1450000,stock:4},
    {sku:'SKU-0012',barcode:'CHSTSMRRD1',name:'ست سامر آجری ۱',category:'ست',unitPrice:4800000,unitCost:2180000,stock:6},
    {sku:'SKU-0013',barcode:'CHKSKLJBK38',name:'کالج مشکی ۳۸',category:'کفش',unitPrice:1800000,unitCost:820000,stock:3},
    {sku:'SKU-0014',barcode:'CHKFKIF4095',name:'کیف ۴۰۹۵',category:'کیف',unitPrice:1500000,unitCost:680000,stock:11},
    {sku:'SKU-0015',barcode:'CHSMPRLMU1',name:'شومیز پارال سرمه‌ای ۱',category:'شومیز',unitPrice:2000000,unitCost:910000,stock:5},
  ],
  personnel: [
    {id:'0',name:'فروشگاه',role:'امور فروشگاه',commissionRate:0,active:true},
    {id:'1',name:'دریا کریمی',role:'فروشنده',commissionRate:0.02,active:true},
    {id:'2',name:'ماحی حمیدپور',role:'فروشنده+vm',commissionRate:0.02,active:true},
  ],
  settings: {
    monthlyTarget: 800000000,
    monthlyProfitTarget: 360000000,
    ATV_Target: 5500000,
    UPT_Target: 2.2,
    Upsell_Target: 0.25,
    Conversion_Target: 0.35,
    Max_Return_Rate: 0.03,
    monthlyVipTarget: 120000000,
  },
};

// ═══════════════════════════════════════════════════════
// API ADAPTER — real connector with mock fallback
// ═══════════════════════════════════════════════════════
const api = {
  async call(path, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CONFIG.TIMEOUT);
    try {
      const res = await fetch(CONFIG.API_BASE + path, {
        ...opts,
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.TOKEN}`,
          ...(opts.headers || {})
        }
      });
      clearTimeout(t);
      if (res.status === 401 && !path.startsWith('/auth/login')) { onUnauthorized(); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  },

  async health() {
    if (location.protocol === 'file:') return false;   // no server when opened directly
    try { await this.call('/health'); return true; }
    catch { return false; }
  },

  async getProducts(q = '') {
    try {
      const d = await this.call(`/products?query=${encodeURIComponent(q)}`);
      return d.products || d;
    } catch {
      return MOCK.products.filter(p =>
        !q || p.name.includes(q) || p.sku.includes(q) ||
        (p.barcode||'').toLowerCase().includes(q.toLowerCase())
      );
    }
  },

  async getPersonnel() {
    try {
      const d = await this.call('/personnel?active=true');
      return d.personnel || d;
    } catch { return MOCK.personnel; }
  },

  async previewInvoice(draft) {
    try { return await this.call('/invoice/preview', {method:'POST',body:JSON.stringify(draft)}); }
    catch { return localPreview(draft); }
  },

  async registerInvoice(draft) {
    try {
      return await this.call('/invoice/register', {method:'POST',body:JSON.stringify(draft)});
    } catch (e) {
      // offline: save locally to queue
      const prev = localPreview(draft);
      const rec = {...draft, ...prev, _offline:true, ts:Date.now()};
      STATE.invoices.unshift(rec);
      localStorage.setItem('chaam_invoices', JSON.stringify(STATE.invoices));
      return {success:true, offline:true, invoiceNo:draft.invoiceNo, netTotal:prev.netTotal};
    }
  },

  async getKPIs(period = 'month') {
    try {
      const d = await this.call(`/dashboard/kpis?period=${period}`);
      return d;
    } catch { return localKPIs(); }
  },

  async getWarnings() {
    try {
      const d = await this.call('/warnings');
      return d.warnings || d;
    } catch { return localWarnings(); }
  },

  async getClosure(date) {
    try { return await this.call(`/daily-closure?date=${encodeURIComponent(date)}`); }
    catch { return localClosure(date); }
  },

  async nextInvoiceNo() {
    try {
      const d = await this.call('/invoice/next');
      return d.invoiceNo;
    } catch {
      const n = parseInt(localStorage.getItem('chaam_offline_next') || '1');
      return 'F-' + String(n).padStart(5, '0');
    }
  },

  async getTrend(months = 6, year = '') {
    try {
      return await this.call(`/dashboard/trend?months=${months}${year ? '&year='+year : ''}`);
    } catch { return localTrend(months, year); }
  },

  async getTodayKPI(date) {
    try { return await this.call(`/kpi/today?date=${encodeURIComponent(date)}`); }
    catch { return localTodayKPI(date); }
  },
};

// ═══════════════════════════════════════════════════════
// LOCAL COMPUTATION (offline mode)
// ═══════════════════════════════════════════════════════
function localPreview(draft) {
  let gross = 0, disc = 0, cost = 0, qty = 0;
  const items = draft.items.map(it => {
    const p = STATE.products.find(x => x.sku === it.sku) || {};
    const price = p.unitPrice || 0;
    const uc = p.unitCost || 0;
    const line = it.qty * price - (it.discount || 0);
    gross += it.qty * price;
    disc += it.discount || 0;
    cost += it.qty * uc;
    qty += it.qty;
    const stockAfter = (p.stock || 0) - it.qty;
    return {
      sku: it.sku, productName: p.name || '—', category: p.category || '',
      qty: it.qty, unitPrice: price, unitCost: uc,
      netLine: line, stockAfter,
      status: stockAfter < 0 ? 'NEGATIVE' : stockAfter <= 3 ? 'LOW' : 'OK'
    };
  });
  const net = gross - disc;
  return {
    invoiceNo: draft.invoiceNo,
    grossTotal: gross, discountTotal: disc, netTotal: net,
    costTotal: cost, grossProfit: net - cost,
    itemsQty: qty,
    balance: (draft.receivedAmount || 0) - net,
    items,
    warnings: items.filter(i => i.status !== 'OK').map(i =>
      `${i.productName}: موجودی ${i.stockAfter < 0 ? 'کافی نیست' : 'کم است'}`)
  };
}

function localKPIs() {
  const invs = STATE.invoices;
  const netSales = invs.reduce((s, i) => s + (i.netTotal || 0), 0);
  const grossProfit = invs.reduce((s, i) => s + (i.grossProfit || 0), 0);
  const invoiceCount = invs.length;
  const itemsQty = invs.reduce((s, i) => s + (i.itemsQty || 0), 0);
  const target = MOCK.settings.monthlyTarget;

  // trend: last 7 pseudo-days
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const day = invs.filter(x => {
      const d = new Date(x.ts || Date.now());
      const diff = Math.floor((Date.now() - d) / 86400000);
      return diff === i;
    });
    trend.push(day.reduce((s, x) => s + (x.netTotal || 0), 0));
  }

  // top products
  const pMap = {};
  invs.forEach(inv => (inv.items || []).forEach(it => {
    if (!pMap[it.sku]) pMap[it.sku] = {name: it.productName, qty: 0, sales: 0};
    pMap[it.sku].qty += it.qty;
    pMap[it.sku].sales += it.netLine || 0;
  }));
  const topProducts = Object.values(pMap).sort((a,b)=>b.sales-a.sales).slice(0,5);

  // top personnel
  const sMap = {};
  invs.forEach(inv => {
    const k = inv.personnelName || inv.personnelId || '—';
    if (!sMap[k]) sMap[k] = {name: k, sales: 0, count: 0};
    sMap[k].sales += inv.netTotal || 0;
    sMap[k].count++;
  });
  const topPersonnel = Object.values(sMap).sort((a,b)=>b.sales-a.sales).slice(0,5);

  return {
    netSales, grossProfit,
    marginPercent: netSales > 0 ? grossProfit / netSales : 0,
    achievementPercent: target > 0 ? netSales / target : 0,
    invoiceCount, itemsQty,
    ATV: invoiceCount > 0 ? netSales / invoiceCount : 0,
    UPT: invoiceCount > 0 ? itemsQty / invoiceCount : 0,
    returnRate: 0.018,
    upsellRate: 0.21,
    conversionRate: 0.31,
    negativeStockCount: STATE.products.filter(p => p.stock < 0).length,
    reorderCriticalCount: STATE.products.filter(p => p.stock > 0 && p.stock <= 3).length,
    returningCustomerSalesShare: 0.38,
    vipCustomerSales: netSales * 0.15,
    topProducts, topPersonnel, trend,
  };
}

function localWarnings() {
  const w = [];
  STATE.products.forEach(p => {
    if (p.stock < 0) w.push({severity:'critical',type:'negative_stock',title:'موجودی منفی',
      detail:`${p.name} — موجودی: ${p.stock}`, count:1, action:'inventory'});
    else if (p.stock === 0) w.push({severity:'critical',type:'out_of_stock',title:'اتمام موجودی',
      detail:`${p.name} — نیاز به سفارش فوری`, count:1, action:'inventory'});
    else if (p.stock <= 3) w.push({severity:'warning',type:'reorder',title:'سفارش مجدد',
      detail:`${p.name} — موجودی: ${p.stock}`, count:1, action:'inventory'});
  });
  const bal = STATE.invoices.filter(i => (i.balance || 0) < 0);
  if (bal.length) w.push({severity:'warning',type:'payment_balance',title:'مانده پرداختی',
    detail:`${bal.length} فاکتور با مانده منفی`, count:bal.length, action:'invoices'});
  return w;
}

function localClosure(date) {
  const list = STATE.invoices.filter(i => !date || i.date === date);
  const netSales = list.reduce((s,i)=>s+(i.netTotal||0),0);
  const payMap = {};
  list.forEach(i => { const k=i.paymentMethod||'—'; payMap[k]=(payMap[k]||0)+(i.netTotal||0); });
  return {
    date, netSales,
    invoiceCount: list.length,
    itemsQty: list.reduce((s,i)=>s+(i.itemsQty||0),0),
    grossProfit: list.reduce((s,i)=>s+(i.grossProfit||0),0),
    paymentBreakdown: Object.entries(payMap).map(([method,amount])=>({method,amount})),
    invoices: list,
  };
}

// ═══════════════════════════════════════════════════════
// OKR ENGINE — per spec formula
// ═══════════════════════════════════════════════════════
const OKR_DEF = [
  {id:'O1',title:'رشد فروش و سلامت درآمد',weight:0.35,keyResults:[
    {id:'KR1',title:'تحقق ۱۰۰٪ هدف فروش',metric:'achievementPercent',target:1.0,weight:0.5,dir:'higher'},
    {id:'KR2',title:'سود ناخالص ماهانه',metric:'grossProfit',target:MOCK.settings.monthlyProfitTarget,weight:0.3,dir:'higher'},
    {id:'KR3',title:'حاشیه سود ۴۵٪',metric:'marginPercent',target:0.45,weight:0.2,dir:'higher'},
  ]},
  {id:'O2',title:'افزایش کیفیت فروش پرسنل',weight:0.25,keyResults:[
    {id:'KR1',title:'ATV هدف',metric:'ATV',target:MOCK.settings.ATV_Target,weight:0.35,dir:'higher'},
    {id:'KR2',title:'UPT هدف',metric:'UPT',target:MOCK.settings.UPT_Target,weight:0.35,dir:'higher'},
    {id:'KR3',title:'نرخ اپ‌سل',metric:'upsellRate',target:MOCK.settings.Upsell_Target,weight:0.3,dir:'higher'},
  ]},
  {id:'O3',title:'کنترل انبار و کاهش ریسک',weight:0.25,keyResults:[
    {id:'KR1',title:'صفر موجودی منفی',metric:'negativeStockCount',target:0,weight:0.4,dir:'lower'},
    {id:'KR2',title:'صفر سفارش بحرانی',metric:'reorderCriticalCount',target:0,weight:0.3,dir:'lower'},
    {id:'KR3',title:'نرخ مرجوعی زیر ۳٪',metric:'returnRate',target:MOCK.settings.Max_Return_Rate,weight:0.3,dir:'lower'},
  ]},
  {id:'O4',title:'رشد CRM و وفاداری مشتری',weight:0.15,keyResults:[
    {id:'KR1',title:'سهم مشتری بازگشتی ۴۵٪',metric:'returningCustomerSalesShare',target:0.45,weight:0.4,dir:'higher'},
    {id:'KR2',title:'فروش VIP',metric:'vipCustomerSales',target:MOCK.settings.monthlyVipTarget,weight:0.3,dir:'higher'},
    {id:'KR3',title:'نرخ تبدیل هدف',metric:'conversionRate',target:MOCK.settings.Conversion_Target,weight:0.3,dir:'higher'},
  ]},
];

function krProgress(actual, target, dir) {
  if (dir === 'lower') {
    if (actual <= target) return 1;
    return Math.max(0, 1 - ((actual - target) / Math.max(actual, 1)));
  }
  if (target === 0) return actual === 0 ? 1 : 0;
  return Math.min(actual / target, 1);
}

function computeOKR(kpi) {
  const objectives = OKR_DEF.map(o => {
    const krs = o.keyResults.map(kr => {
      const actual = kpi[kr.metric] ?? 0;
      const progress = krProgress(actual, kr.target, kr.dir);
      return {...kr, actual, progress};
    });
    const score = krs.reduce((s,kr)=>s + kr.progress*kr.weight, 0);
    const status = score >= 0.75 ? 'on_track' : score >= 0.45 ? 'risk' : 'off_track';
    return {...o, keyResults: krs, score, status};
  });
  const total = objectives.reduce((s,o)=>s + o.score*o.weight, 0);
  return {
    period: '۱۴۰۴/۰۶',
    objectives,
    totalScore: total,
    status: total >= 0.75 ? 'on_track' : total >= 0.45 ? 'risk' : 'off_track',
  };
}

// ═══════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════
const fa = n => Math.round(n||0).toLocaleString('fa-IR');
const pct = n => (Math.round((n||0)*1000)/10).toLocaleString('fa-IR') + '٪';
const money = n => fa(n);

function toast(msg, kind='ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast on ${kind}`;
  setTimeout(()=>t.classList.remove('on'), 3000);
}

function ringDraw(canvasId, value, color) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height, r = w/2 - 9;
  ctx.clearRect(0,0,w,h);
  // track
  ctx.beginPath();
  ctx.arc(w/2,h/2,r,0,Math.PI*2);
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 8; ctx.stroke();
  // progress
  const end = -Math.PI/2 + Math.PI*2*Math.min(value,1);
  const g = ctx.createLinearGradient(0,0,w,h);
  g.addColorStop(0, color); g.addColorStop(1, '#E8D39A');
  ctx.beginPath();
  ctx.arc(w/2,h/2,r,-Math.PI/2,end);
  ctx.strokeStyle = g; ctx.lineWidth = 8; ctx.lineCap='round'; ctx.stroke();
}

function sparkline(canvasId, data, color='#C6A15B') {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  c.width = rect.width * dpr; c.height = rect.height * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0,0,w,h);
  if (!data || data.length < 2) return;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v,i)=>({
    x: (i/(data.length-1))*(w-8)+4,
    y: h - 6 - ((v-min)/range)*(h-16)
  }));
  // fill
  const grad = ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0, color+'33'); grad.addColorStop(1, color+'00');
  ctx.beginPath(); ctx.moveTo(pts[0].x, h);
  pts.forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.lineTo(pts[pts.length-1].x, h); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  // line
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin='round'; ctx.stroke();
  // last dot
  const last = pts[pts.length-1];
  ctx.beginPath(); ctx.arc(last.x,last.y,3.5,0,Math.PI*2);
  ctx.fillStyle = color; ctx.fill();
}

// ═══════════════════════════════════════════════════════
// CANVAS CHARTS — line / donut / radar (no external libs)
// ═══════════════════════════════════════════════════════
function setupCanvasHiDPI(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.width, h = rect.height || canvas.height;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return {ctx, w, h};
}

function drawLineChart(canvasId, labels, values, color='#C6A15B') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const {ctx, w, h} = setupCanvasHiDPI(canvas);
  ctx.clearRect(0,0,w,h);
  if (!values.length) return;

  const padL = 44, padR = 10, padT = 14, padB = 26;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = (max - min) || 1;

  // y gridlines + labels
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.fillStyle = 'rgba(203,213,225,.55)';
  ctx.font = '10px Vazirmatn, sans-serif';
  ctx.textAlign = 'left';
  const steps = 4;
  for (let i=0; i<=steps; i++) {
    const val = min + (range * i/steps);
    const y = padT + plotH - (plotH * i/steps);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w-padR, y); ctx.stroke();
    const label = val >= 1e7 ? (val/1e7).toFixed(1)+'کر' : val >= 1000 ? Math.round(val/1000)+'K' : Math.round(val);
    ctx.fillText(String(label), 2, y+3);
  }

  // points
  const pts = values.map((v,i) => ({
    x: padL + (plotW * i/(values.length-1||1)),
    y: padT + plotH - ((v-min)/range)*plotH
  }));

  // fill area
  const grad = ctx.createLinearGradient(0,padT,0,padT+plotH);
  grad.addColorStop(0, color+'40'); grad.addColorStop(1, color+'00');
  ctx.beginPath(); ctx.moveTo(pts[0].x, padT+plotH);
  pts.forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.lineTo(pts[pts.length-1].x, padT+plotH); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // line
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach((p,i)=>{
    if (i>0) {
      const prev = pts[i-1];
      const cx = (prev.x+p.x)/2;
      ctx.bezierCurveTo(cx,prev.y,cx,p.y,p.x,p.y);
    }
  });
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin='round'; ctx.stroke();

  // points + x labels
  ctx.textAlign = 'center';
  pts.forEach((p,i)=>{
    ctx.beginPath(); ctx.arc(p.x,p.y,3.5,0,Math.PI*2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#0B0B0C'; ctx.lineWidth = 1.5; ctx.stroke();
    if (labels[i]) {
      ctx.fillStyle = 'rgba(203,213,225,.6)';
      ctx.font = '10px Vazirmatn, sans-serif';
      ctx.fillText(labels[i], p.x, h - 6);
    }
  });
}

const DONUT_COLORS = ['#C6A15B','#3B82F6','#8B5CF6','#22C55E','#F59E0B','#06B6D4',
                       '#EC4899','#F97316','#84CC16','#A855F7','#64748B'];

function drawDonut(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  const total = data.reduce((s,d)=>s+d.amount,0) || 1;
  const cx = w/2, cy = h/2, r = Math.min(w,h)/2 - 6, inner = r*0.6;
  let start = -Math.PI/2;
  data.forEach((d,i)=>{
    const angle = (d.amount/total) * Math.PI*2;
    ctx.beginPath();
    ctx.arc(cx,cy,r,start,start+angle);
    ctx.arc(cx,cy,inner,start+angle,start,true);
    ctx.closePath();
    ctx.fillStyle = DONUT_COLORS[i % DONUT_COLORS.length];
    ctx.fill();
    start += angle;
  });
}

function drawRadarChart(canvasId, axisLabels, actualPct, targetPct) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const {ctx, w, h} = setupCanvasHiDPI(canvas);
  ctx.clearRect(0,0,w,h);
  const cx = w/2, cy = h/2 - 6, R = Math.min(w,h)/2 - 34;
  const n = axisLabels.length;
  const angleFor = i => -Math.PI/2 + (Math.PI*2*i/n);

  // grid rings
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  for (let ring=1; ring<=4; ring++) {
    ctx.beginPath();
    for (let i=0;i<=n;i++) {
      const a = angleFor(i%n), rad = R*ring/4;
      const x = cx+Math.cos(a)*rad, y = cy+Math.sin(a)*rad;
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
  // axis lines + labels
  ctx.fillStyle = 'rgba(203,213,225,.75)';
  ctx.font = '11px Vazirmatn, sans-serif';
  ctx.textAlign = 'center';
  for (let i=0;i<n;i++) {
    const a = angleFor(i);
    ctx.beginPath(); ctx.moveTo(cx,cy);
    ctx.lineTo(cx+Math.cos(a)*R, cy+Math.sin(a)*R);
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.stroke();
    const lx = cx+Math.cos(a)*(R+18), ly = cy+Math.sin(a)*(R+18);
    ctx.fillText(axisLabels[i], lx, ly+4);
  }

  const plot = (arr, color, dashed, fill) => {
    ctx.beginPath();
    arr.forEach((v,i)=>{
      const a = angleFor(i), rad = R*Math.max(0,Math.min(1,v));
      const x = cx+Math.cos(a)*rad, y = cy+Math.sin(a)*rad;
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.closePath();
    if (dashed) ctx.setLineDash([4,4]); else ctx.setLineDash([]);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    if (fill) { ctx.fillStyle = color+'22'; ctx.fill(); }
    ctx.setLineDash([]);
    if (!dashed) {
      arr.forEach((v,i)=>{
        const a = angleFor(i), rad = R*Math.max(0,Math.min(1,v));
        const x = cx+Math.cos(a)*rad, y = cy+Math.sin(a)*rad;
        ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2);
        ctx.fillStyle = color; ctx.fill();
      });
    }
  };
  plot(targetPct, '#38BDF8', true, false);
  plot(actualPct, '#C6A15B', false, true);
}

// ═══════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════
const TITLES = {
  home:'خانه فرماندهی', pos:'ثبت فاکتور', dash:'داشبورد مدیریتی',
  okr:'OKR هوشمند', warn:'مرکز هشدار', close:'گزارش پایان روز'
};

function go(screen) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on'));
  document.getElementById('scr-'+screen)?.classList.add('on');
  document.querySelectorAll('.nav-b,.side-item').forEach(b=>{
    b.classList.toggle('on', b.dataset.nav === screen);
  });
  document.getElementById('page-title').textContent = TITLES[screen] || '';
  const isPos = screen === 'pos';
  document.getElementById('total-bar').classList.toggle('on', isPos);
  document.querySelector('.content').classList.toggle('pos-mode', isPos);
  window.scrollTo({top:0, behavior:'instant'});

  if (screen==='dash') { renderDashboard(); refreshThenRender('dash'); }
  if (screen==='okr')  { renderOKR();       refreshThenRender('okr'); }
  if (screen==='warn') renderWarnings();
  if (screen==='close') loadClosure();
  if (screen==='home') renderHome();
}

document.querySelectorAll('.side-item').forEach(el=>{
  el.onclick = ()=>go(el.dataset.nav);
});

async function refreshThenRender(screen) {
  if (!ONLINE) return;
  try {
    STATE.kpi = await api.getKPIs();
    if (screen === 'dash') renderDashboard();
    if (screen === 'okr')  renderOKR();
  } catch {}
}

// ═══════════════════════════════════════════════════════
// ROLE
// ═══════════════════════════════════════════════════════
const ROLES = {
  store:{label:'فروشگاه',icon:'🧑‍💼',canViewProfit:false,canViewOKR:false},
  brand:{label:'مالک برند',icon:'👤',canViewProfit:true,canViewOKR:true},
  system:{label:'مالک سیستم',icon:'👑',canViewProfit:true,canViewOKR:true},
};

function applyRole() {
  const r = ROLES[CONFIG.ROLE] || ROLES.store;
  document.getElementById('role-chip').textContent = `${r.icon} ${r.label}`;
  const hide = !r.canViewProfit;
  document.querySelectorAll('.mgr-only').forEach(el=>{
    el.style.display = hide ? 'none' : '';
  });
  // hide OKR nav for cashier
  document.querySelectorAll('[data-nav="okr"]').forEach(el=>{
    el.style.display = r.canViewOKR ? '' : 'none';
  });
}

// نقش دیگر با لمس عوض نمی‌شود — فقط با رمز. لمس چیپ = خروج
function cycleRole() {
  if (confirm(`خروج از حساب «${(ROLES[CONFIG.ROLE]||ROLES.store).label}»؟`)) logout();
}

// ═══════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════
let _loginResolve = null;
function setSession(token, role) {
  CONFIG.TOKEN = token || ''; CONFIG.ROLE = ROLES[role] ? role : 'store';
  if (token) localStorage.setItem('chaam_token', token); else localStorage.removeItem('chaam_token');
  localStorage.setItem('chaam_role', CONFIG.ROLE);
  applyRole();
}
function logout() { setSession('', 'store'); showLogin(); }
function onUnauthorized() { if (CONFIG.TOKEN) { setSession('', 'store'); } showLogin(); }

function showLogin(msg) {
  let el = document.getElementById('login-ov');
  if (!el) {
    el = document.createElement('div');
    el.id = 'login-ov';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,10,12,.96);display:flex;align-items:center;justify-content:center;font-family:inherit';
    el.innerHTML = `
      <form id="login-form" style="width:min(320px,88vw);text-align:center;color:#eee">
        <div style="font-size:26px;font-weight:800;letter-spacing:2px;margin-bottom:6px">FJ COD</div>
        <div style="opacity:.6;font-size:13px;margin-bottom:22px">ورود به CHAAM RetailOS</div>
        <input id="login-pw" type="password" inputmode="text" autocomplete="current-password" placeholder="رمز عبور"
          style="width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:1px solid #444;background:#1b1b1f;color:#fff;font-size:18px;text-align:center;letter-spacing:3px">
        <button type="submit" style="width:100%;margin-top:12px;padding:14px;border:0;border-radius:12px;background:#d4a94e;color:#111;font-weight:700;font-size:16px">ورود</button>
        <div id="login-msg" style="min-height:20px;margin-top:12px;font-size:13px;color:#ff7a7a"></div>
      </form>`;
    document.body.appendChild(el);
    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const pw = document.getElementById('login-pw').value.trim();
      const m = document.getElementById('login-msg');
      if (!pw) return;
      m.style.color = '#aaa'; m.textContent = 'در حال بررسی…';
      try {
        const res = await fetch(CONFIG.API_BASE + '/auth/login', {method:'POST',
          headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: pw})});
        const d = await res.json().catch(()=>({}));
        if (!res.ok || !d.success) { m.style.color='#ff7a7a'; m.textContent = d.error || 'رمز اشتباه است'; return; }
        setSession(d.token, d.role);
        el.style.display = 'none';
        document.getElementById('login-pw').value = '';
        toast(`خوش آمدید — ${d.roleFa}`, 'ok');
        if (_loginResolve) { const r = _loginResolve; _loginResolve = null; r(); }
        else connectBackground();
      } catch {
        m.style.color='#ff7a7a'; m.textContent = 'سرور در دسترس نیست';
      }
    };
  }
  el.style.display = 'flex';
  if (msg) document.getElementById('login-msg').textContent = msg;
  setTimeout(()=>document.getElementById('login-pw')?.focus(), 200);
  return new Promise(r => { _loginResolve = r; });
}

async function ensureLogin() {
  if (CONFIG.TOKEN) {
    try {
      const me = await api.call('/auth/me');
      setSession(CONFIG.TOKEN, me.role);
      return true;
    } catch {}
  }
  await showLogin();
  return true;
}

// ═══════════════════════════════════════════════════════
// PRODUCT SHEET
// ═══════════════════════════════════════════════════════
function openSheet() {
  document.getElementById('sheet-bg').classList.add('on');
  document.getElementById('sheet').classList.add('on');
  renderProducts(STATE.products);
  setTimeout(()=>document.getElementById('sheet-search').focus(), 320);
}

function closeSheet() {
  document.getElementById('sheet-bg').classList.remove('on');
  document.getElementById('sheet').classList.remove('on');
  document.getElementById('sheet-search').value = '';
}

function searchProducts(q) {
  const list = !q ? STATE.products : STATE.products.filter(p =>
    p.name.includes(q) ||
    p.sku.toLowerCase().includes(q.toLowerCase()) ||
    (p.barcode||'').toLowerCase().includes(q.toLowerCase()) ||
    (p.category||'').includes(q)
  );
  renderProducts(list);
}

function renderProducts(list) {
  const el = document.getElementById('sheet-body');
  if (!list.length) {
    el.innerHTML = `<div class="empty"><div class="ic">🔍</div><p>محصولی یافت نشد</p></div>`;
    return;
  }
  el.innerHTML = list.map(p => {
    const st = p.stock <= 0 ? {c:'var(--danger)',t:'ناموجود'}
             : p.stock <= 3 ? {c:'var(--warning)',t:`${fa(p.stock)} عدد`}
             : {c:'var(--success)',t:`${fa(p.stock)} عدد`};
    return `<div class="prod-row" onclick="addItem('${p.sku}')">
      <div class="prod-ic">${catIcon(p.category)}</div>
      <div class="prod-b">
        <div class="prod-n">${p.name}</div>
        <div class="prod-m">
          <span style="font-family:Inter">${p.sku}</span>
          <span style="color:${st.c}">● ${st.t}</span>
        </div>
      </div>
      <div class="prod-p">${money(p.unitPrice)}<small>تومان</small></div>
    </div>`;
  }).join('');
}

function catIcon(c) {
  const m = {'شلوار':'👖','شومیز':'👚','کت':'🧥','وست':'🦺','دامن':'👗',
             'تاپ':'🎽','کیف':'👜','کفش':'👠','ست':'✨','شلوارک':'🩳','تیشرت':'👕'};
  return m[c] || '🏷️';
}

// ═══════════════════════════════════════════════════════
// INVOICE ITEMS
// ═══════════════════════════════════════════════════════
function addItem(sku) {
  const p = STATE.products.find(x=>x.sku===sku);
  if (!p) return;
  const ex = STATE.invoice.items.find(i=>i.sku===sku);
  if (ex) { ex.qty++; toast(`${p.name} — تعداد ${fa(ex.qty)}`,'ok'); }
  else {
    if (STATE.invoice.items.length >= 20) { toast('حداکثر ۲۰ قلم','warn'); return; }
    STATE.invoice.items.push({sku, qty:1, discount:0, upsell:false});
    toast(`${p.name} اضافه شد`,'ok');
  }
  closeSheet();
  renderItems();
}

function removeItem(sku) {
  STATE.invoice.items = STATE.invoice.items.filter(i=>i.sku!==sku);
  renderItems();
}

function setQty(sku, v) {
  const it = STATE.invoice.items.find(i=>i.sku===sku);
  if (!it) return;
  it.qty = Math.max(0, parseInt(v)||0);
  if (it.qty === 0) return removeItem(sku);
  renderItems();
}

function bumpQty(sku, d) {
  const it = STATE.invoice.items.find(i=>i.sku===sku);
  if (!it) return;
  setQty(sku, it.qty + d);
}

function setDisc(sku, v) {
  const it = STATE.invoice.items.find(i=>i.sku===sku);
  if (it) { it.discount = Math.max(0, parseFloat(v)||0); recalc(); }
}

function renderItems() {
  const el = document.getElementById('items-list');
  if (!STATE.invoice.items.length) {
    el.innerHTML = `<div class="empty"><div class="ic">🛒</div>
      <p>هنوز محصولی اضافه نشده<br>روی جستجو بزنید یا بارکد اسکن کنید</p></div>`;
    recalc(); return;
  }
  el.innerHTML = STATE.invoice.items.map(it=>{
    const p = STATE.products.find(x=>x.sku===it.sku) || {};
    const line = it.qty*(p.unitPrice||0) - (it.discount||0);
    const after = (p.stock||0) - it.qty;
    const cls = after < 0 ? 'err-stock' : after <= 3 ? 'warn-stock' : '';
    const stTxt = after < 0
      ? `<span style="color:var(--danger)">⛔ موجودی کافی نیست (${fa(after)})</span>`
      : after <= 3
      ? `<span style="color:var(--warning)">⚠️ باقیمانده: ${fa(after)}</span>`
      : `<span style="color:var(--text-2)">باقیمانده: ${fa(after)}</span>`;
    return `<div class="item-c ${cls}">
      <div class="item-top">
        <div>
          <div class="item-nm">${p.name||'—'}</div>
          <div class="item-sku">${it.sku}</div>
        </div>
        <button class="item-del" onclick="removeItem('${it.sku}')">✕</button>
      </div>
      <div class="item-ctrl">
        <div class="qty-box">
          <button class="qty-b" onclick="bumpQty('${it.sku}',-1)">−</button>
          <input class="qty-i" type="number" value="${it.qty}" min="0" inputmode="numeric"
            onchange="setQty('${it.sku}',this.value)">
          <button class="qty-b" onclick="bumpQty('${it.sku}',1)">+</button>
        </div>
        <div class="mini-f">
          <label>قیمت واحد</label>
          <input type="text" value="${money(p.unitPrice)}" readonly>
        </div>
        <div class="mini-f">
          <label>تخفیف</label>
          <input type="number" value="${it.discount||0}" min="0" inputmode="numeric"
            onchange="setDisc('${it.sku}',this.value)">
        </div>
      </div>
      <div class="item-foot">
        <div class="item-stock">${stTxt}</div>
        <div class="item-total">${money(line)} <span style="font-size:10px;font-weight:400;color:var(--text-2)">تومان</span></div>
      </div>
    </div>`;
  }).join('');
  recalc();
}

function recalc() {
  const draft = buildDraft();
  const pv = localPreview(draft);
  document.getElementById('t-qty').textContent  = fa(pv.itemsQty);
  document.getElementById('t-disc').textContent = money(pv.discountTotal);
  document.getElementById('t-net').textContent  = money(pv.netTotal);
  const bal = document.getElementById('t-bal');
  bal.textContent = money(pv.balance);
  bal.style.color = pv.balance < 0 ? 'var(--danger)' : 'var(--success)';
  validateForm();
}

function buildDraft() {
  const sel = document.getElementById('f-personnel');
  const pid = sel.value;
  const pers = STATE.personnel.find(p=>p.id===pid);
  return {
    invoiceNo: STATE.invoice.no,
    date: document.getElementById('pos-date').textContent,
    personnelId: pid,
    personnelName: pers?.name || '',
    shift: document.getElementById('f-shift').value,
    channel: document.getElementById('f-channel').value,
    paymentMethod: document.getElementById('f-payment').value,
    receivedAmount: parseFloat(document.getElementById('f-received').value)||0,
    customerFirst: document.getElementById('f-cust-first').value,
    customerLast: document.getElementById('f-cust-last').value,
    customerPhone: document.getElementById('f-cust-phone').value,
    customerType: document.getElementById('f-cust-type').value,
    birthDay: document.getElementById('f-bday').value,
    birthMonth: document.getElementById('f-bmonth').value,
    items: STATE.invoice.items,
  };
}

function validateForm() {
  const btn = document.getElementById('reg-btn');
  const hasPersonnel = !!document.getElementById('f-personnel').value;
  const hasItems = STATE.invoice.items.length > 0 && STATE.invoice.items.every(i=>i.qty>0);
  const pv = localPreview(buildDraft());
  const stockOK = CONFIG.ROLE !== 'store' || pv.items.every(i=>i.stockAfter >= 0);
  btn.disabled = !(hasPersonnel && hasItems && stockOK);
}

// ═══════════════════════════════════════════════════════
// REGISTER
// ═══════════════════════════════════════════════════════
async function registerInvoice() {
  const btn = document.getElementById('reg-btn');
  const txt = document.getElementById('reg-txt');
  btn.disabled = true; btn.classList.add('loading');
  txt.innerHTML = '<span class="spinner"></span> در حال ثبت...';

  const draft = buildDraft();
  const pv = localPreview(draft);

  // warn if stock issues
  if (pv.warnings.length && CONFIG.ROLE === 'store') {
    toast(pv.warnings[0], 'err');
    btn.disabled = false; btn.classList.remove('loading');
    txt.textContent = 'ثبت سریع فاکتور';
    return;
  }

  try {
    const res = await api.registerInvoice({...draft, ...pv});

    // update local stock
    STATE.invoice.items.forEach(it=>{
      const p = STATE.products.find(x=>x.sku===it.sku);
      if (p) p.stock = Math.max(0, p.stock - it.qty);
    });

    // save locally
    const record = {...draft, ...pv, ts:Date.now(), offline: res.offline};
    if (!res.offline) {
      STATE.invoices.unshift(record);
      localStorage.setItem('chaam_invoices', JSON.stringify(STATE.invoices));
    }

    // شماره فاکتور بعدی — همیشه از سرور خوانده می‌شود (فرمت‌ها متفاوت‌اند: F-00001 یا INV-0151)
    if (ONLINE) {
      STATE.invoice.no = await api.nextInvoiceNo();
    } else {
      // آفلاین: افزایش عددی مستقل از پیشوند فعلی (F- یا INV- یا هرچیز دیگر)
      const m = STATE.invoice.no.match(/^(\D*)(\d+)$/);
      if (m) {
        const prefix = m[1], num = parseInt(m[2], 10) + 1, width = m[2].length;
        STATE.invoice.no = prefix + String(num).padStart(width, '0');
      }
      localStorage.setItem('chaam_offline_next', STATE.invoice.no.replace(/^\D+/, ''));
    }

    // success overlay
    document.getElementById('success-no').textContent = draft.invoiceNo;
    document.getElementById('success-total').textContent = money(pv.netTotal) + ' تومان';
    document.getElementById('success-ov').classList.add('on');

    if (res.offline) toast('ذخیره آفلاین — در صف ارسال','warn');

    // spec successActions: "update dashboard cache"
    refreshCache();

  } catch(e) {
    toast('خطا در ثبت فاکتور: ' + e.message, 'err');
  } finally {
    btn.classList.remove('loading');
    txt.textContent = 'ثبت سریع فاکتور';
    validateForm();
  }
}

async function refreshCache() {
  try {
    const [kpi, warns] = await Promise.all([
      api.getKPIs().catch(() => localKPIs()),
      api.getWarnings().catch(() => localWarnings()),
    ]);
    STATE.kpi = kpi;
    STATE.warnings = warns;
    renderHome();
  } catch (e) {
    STATE.kpi = localKPIs();
    STATE.warnings = localWarnings();
  }
}

function closeSuccess() {
  document.getElementById('success-ov').classList.remove('on');
  // reset form
  STATE.invoice.items = [];
  ['f-cust-first','f-cust-last','f-cust-phone','f-bday','f-received'].forEach(id=>{
    const el = document.getElementById(id); if (el) el.value='';
  });
  document.getElementById('f-bmonth').value='';
  document.getElementById('pos-no').textContent = STATE.invoice.no;
  renderItems();
}

function printReceipt() { window.print(); }
function printA4() { window.print(); }

// ═══════════════════════════════════════════════════════
// RENDER: HOME
// ═══════════════════════════════════════════════════════
function renderHome() {
  const k = STATE.kpi || localKPIs();
  document.getElementById('h-sales').textContent  = money(k.netSales);
  document.getElementById('h-ach').textContent    = pct(k.achievementPercent);
  document.getElementById('h-profit').textContent = money(k.grossProfit);
  document.getElementById('h-inv').textContent    = fa(k.invoiceCount);
  document.getElementById('h-atv').textContent    = money(k.ATV);

  const okr = STATE.okr || computeOKR(k);
  document.getElementById('okr-mini').textContent = 'امتیاز ' + pct(okr.totalScore);

  // insight
  const ins = document.getElementById('home-insight');
  let kind='good', icon='✓', title='عملکرد مطلوب', msg='';
  if (k.achievementPercent < 0.45) {
    kind='bad'; icon='⚠'; title='فروش پایین‌تر از هدف';
    msg = `تا این لحظه ${pct(k.achievementPercent)} هدف ماهانه محقق شده. برای جبران، تمرکز روی اپ‌سل و مشتریان VIP توصیه می‌شود.`;
  } else if (k.achievementPercent < 0.75) {
    kind='warn'; icon='◐'; title='در مسیر هدف با ریسک';
    msg = `${pct(k.achievementPercent)} هدف محقق شده. با حفظ روند فعلی، ${pct(Math.min(k.achievementPercent*1.35,1))} تخمین پایان ماه است.`;
  } else {
    msg = `${pct(k.achievementPercent)} هدف محقق شده. ATV فعلی ${money(k.ATV)} تومان — عملکرد بالای میانگین.`;
  }
  ins.innerHTML = `<div class="insight ${kind}">
    <span class="ic">${icon}</span>
    <div><b>${title}</b>${msg}</div>
  </div>`;

  // recent
  const rec = document.getElementById('home-recent');
  const list = STATE.invoices.slice(0,5);
  rec.innerHTML = list.length ? list.map(i=>`
    <div class="inv-item">
      <div>
        <div class="inv-no">${i.invoiceNo}</div>
        <div class="inv-meta">${i.personnelName||'—'} • ${i.paymentMethod||'—'} • ${fa(i.itemsQty||0)} قلم</div>
      </div>
      <div class="inv-amt">${money(i.netTotal)}</div>
    </div>`).join('')
    : `<div class="empty" style="padding:26px"><div class="ic">📋</div><p>هنوز فاکتوری ثبت نشده</p></div>`;

  // warnings count
  const wn = STATE.warnings.length;
  document.getElementById('cmd-warn-n').textContent = fa(wn);
  document.getElementById('warn-count').textContent = fa(wn);
  const nb = document.getElementById('nav-warn-n');
  nb.textContent = fa(wn); nb.classList.toggle('hidden', wn===0);
}

// ═══════════════════════════════════════════════════════
// RENDER: DASHBOARD
// ═══════════════════════════════════════════════════════
function renderDashboard() {
  const k = STATE.kpi || localKPIs();

  document.getElementById('d-sales').textContent = money(k.netSales);
  document.getElementById('d-ach-n').textContent = pct(k.achievementPercent);
  ringDraw('ach-ring', k.achievementPercent, '#C6A15B');

  document.getElementById('k-profit').textContent = money(k.grossProfit);
  document.getElementById('k-margin').textContent = pct(k.marginPercent);
  document.getElementById('k-inv').textContent    = fa(k.invoiceCount);
  document.getElementById('k-atv').textContent    = money(k.ATV);
  document.getElementById('k-upt').textContent    = (k.UPT||0).toFixed(1);
  document.getElementById('k-conv').textContent   = pct(k.conversionRate);
  document.getElementById('k-upsell').textContent = pct(k.upsellRate);
  document.getElementById('k-return').textContent = pct(k.returnRate);

  // margin indicator
  const mc = document.getElementById('k-profit-c');
  mc.textContent = k.marginPercent >= 0.45 ? '▲ بالای هدف' : '▼ زیر هدف ۴۵٪';
  mc.className = 'kpi-c ' + (k.marginPercent >= 0.45 ? 'up':'dn');
  document.getElementById('k-inv-c').textContent = `${fa(k.itemsQty)} قلم فروخته`;

  // trend chart handled by renderTrendChart() (period-aware)
  renderTrendChart();
  renderCategoryDonut(k.categorySales);
  renderStaffPerformance();
  renderTodayKPI();

  // insight
  const ins = document.getElementById('dash-insight');
  const issues = [];
  if (k.marginPercent < 0.45) issues.push('حاشیه سود زیر هدف ۴۵٪');
  if (k.ATV < MOCK.settings.ATV_Target) issues.push('ATV زیر هدف');
  if (k.UPT < MOCK.settings.UPT_Target) issues.push('UPT پایین — فرصت اپ‌سل');
  if (k.reorderCriticalCount > 0) issues.push(`${fa(k.reorderCriticalCount)} کالا نیاز به سفارش`);

  ins.innerHTML = issues.length
    ? `<div class="insight warn"><span class="ic">◐</span><div>
        <b>نکات تصمیم‌گیری</b>${issues.join(' • ')}</div></div>`
    : `<div class="insight good"><span class="ic">✓</span><div>
        <b>همه شاخص‌ها در محدوده مطلوب</b>عملکرد ماه جاری بالای اهداف تعیین‌شده است.</div></div>`;

  // top products
  const tp = document.getElementById('top-products');
  const prods = k.topProducts || [];
  if (prods.length) {
    const max = Math.max(...prods.map(p=>p.sales), 1);
    tp.innerHTML = prods.map(p=>`
      <div class="bar-row">
        <div class="bar-h"><span>${p.name}</span><span class="v">${money(p.sales)}</span></div>
        <div class="bar"><div class="bar-f" style="width:${(p.sales/max*100)}%;background:linear-gradient(90deg,#C6A15B,#E8D39A)"></div></div>
      </div>`).join('');
  } else {
    tp.innerHTML = `<div class="empty" style="padding:24px"><p>داده‌ای موجود نیست</p></div>`;
  }

}

// ═══════════════════════════════════════════════════════
// TREND CHART (month/year selectable)
// ═══════════════════════════════════════════════════════
let trendPeriod = 6;
function setTrendPeriod(months) {
  trendPeriod = months;
  document.querySelectorAll('#trend-period-tabs .tab').forEach(t=>{
    t.classList.toggle('on', parseInt(t.dataset.m) === months);
  });
  renderTrendChart();
}

async function renderTrendChart() {
  const yearSel = document.getElementById('trend-year');
  const year = yearSel ? yearSel.value : '';
  const t = await api.getTrend(trendPeriod, year);

  if (yearSel && yearSel.options.length <= 1 && t.yearsAvailable?.length) {
    t.yearsAvailable.forEach(y=>{
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y;
      yearSel.appendChild(opt);
    });
  }
  drawLineChart('trend-chart', t.labels, t.values);
}

// ═══════════════════════════════════════════════════════
// CATEGORY DONUT
// ═══════════════════════════════════════════════════════
function renderCategoryDonut(categorySales) {
  const data = (categorySales || []).slice(0, 8);
  drawDonut('cat-donut', data);
  const legend = document.getElementById('cat-legend');
  if (!legend) return;
  if (!data.length) {
    legend.innerHTML = `<div style="font-size:12px;color:var(--text-2)">داده‌ای موجود نیست</div>`;
    return;
  }
  const total = data.reduce((s,d)=>s+d.amount,0) || 1;
  legend.innerHTML = data.map((d,i)=>`
    <div style="display:flex;align-items:center;gap:8px;font-size:12px">
      <span style="width:11px;height:11px;border-radius:3px;background:${DONUT_COLORS[i%DONUT_COLORS.length]};flex-shrink:0"></span>
      <span style="flex:1">${d.category}</span>
      <span style="color:var(--text-2)">${pct(d.amount/total)}</span>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════
// STAFF PERFORMANCE (avatar + progress bar)
// ═══════════════════════════════════════════════════════
async function renderStaffPerformance() {
  const el = document.getElementById('staff-performance');
  if (!el) return;
  const list = STATE.personnel.filter(p => p.active !== false);
  if (!list.length) {
    el.innerHTML = `<div class="empty" style="padding:20px"><p>داده‌ای موجود نیست</p></div>`;
    return;
  }
  el.innerHTML = list.map(p=>{
    const conv = p.conversionRate || 0;
    const invCount = p.invoiceCount || 0;
    return `<div class="staff-mini">
      <div class="staff-avatar">👤</div>
      <div class="staff-info">
        <div class="staff-name">${p.name}</div>
        <div class="staff-role">${p.role || '—'} | نرخ تبدیل: ${pct(conv)}</div>
        <div style="margin-top:7px">
          <div style="height:5px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${Math.min(conv*200,100)}%;background:linear-gradient(90deg,#C6A15B,#E8D39A);border-radius:4px"></div>
          </div>
        </div>
      </div>
      <div style="text-align:left">
        <div style="font-size:13px;font-weight:700;color:var(--gold)">${fa(invCount)}</div>
        <div style="font-size:10px;color:var(--text-2)">فاکتور</div>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// TODAY'S KPI (image7 style)
// ═══════════════════════════════════════════════════════
async function renderTodayKPI() {
  const el = document.getElementById('today-kpi-list');
  if (!el) return;
  const date = todayFa();
  const badgeEl = document.getElementById('today-date-badge');
  if (badgeEl) badgeEl.textContent = date;

  const k = await api.getTodayKPI(date);
  const rows = [
    {label:'فروش روز', val: money(k.sales.actual), target: money(k.sales.target)+' تومان', status:k.sales.status},
    {label:'تعداد فاکتور', val: fa(k.invoices.actual), target: fa(k.invoices.target), status:k.invoices.status},
    {label:'نرخ تبدیل', val: pct(k.conversionRate.actual), target: pct(k.conversionRate.target), status:k.conversionRate.status},
    {label:'مرجوعی', val: fa(k.returns.actual), target: 'حداکثر '+fa(k.returns.target), status:k.returns.status},
    {label:'اپ‌سل', val: fa(k.upsell.actual), target: fa(k.upsell.target), status:k.upsell.status},
  ];
  const badgeMap = {excellent:['✅','عالی'], close:['⚠️','نزدیک'], behind:['❌','بیشتر']};
  el.innerHTML = rows.map(r=>{
    const [icon, txt] = badgeMap[r.status] || badgeMap.close;
    return `<div class="tk-row">
      <div class="tk-left">
        <div class="tk-val">${r.val}</div>
        <span class="tk-badge ${r.status}">${icon} ${txt}</span>
      </div>
      <div class="tk-right">
        <div class="tk-label">${r.label}</div>
        <div class="tk-target">هدف: ${r.target}</div>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// ALL-INVOICES SHEET ("آخرین فاکتورها" → "همه")
// ═══════════════════════════════════════════════════════
function openInvoicesSheet() {
  document.getElementById('inv-sheet-bg').classList.add('on');
  document.getElementById('inv-sheet').classList.add('on');
  renderInvoicesSheet('');
  setTimeout(()=>document.getElementById('inv-sheet-search').focus(), 320);
}
function closeInvoicesSheet() {
  document.getElementById('inv-sheet-bg').classList.remove('on');
  document.getElementById('inv-sheet').classList.remove('on');
  document.getElementById('inv-sheet-search').value = '';
}
function renderInvoicesSheet(q) {
  const el = document.getElementById('inv-sheet-body');
  q = (q||'').trim();
  const list = !q ? STATE.invoices : STATE.invoices.filter(i =>
    (i.invoiceNo||'').includes(q) ||
    ((i.customerFirst||'')+' '+(i.customerLast||'')).includes(q) ||
    (i.personnelName||'').includes(q)
  );
  if (!list.length) {
    el.innerHTML = `<div class="empty"><div class="ic">📋</div><p>فاکتوری یافت نشد</p></div>`;
    return;
  }
  el.innerHTML = list.slice(0,80).map(i=>`
    <div class="inv-item">
      <div>
        <div class="inv-no">${i.invoiceNo}</div>
        <div class="inv-meta">${i.date||'—'} • ${i.personnelName||'—'} • ${fa(i.itemsQty||0)} قلم</div>
      </div>
      <div class="inv-amt">${money(i.netTotal)}</div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════
// LIVE CLOCK
// ═══════════════════════════════════════════════════════
function startLiveClock() {
  const el = document.getElementById('live-clock');
  if (!el) return;
  const tick = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2,'0');
    const mm = String(now.getMinutes()).padStart(2,'0');
    const ss = String(now.getSeconds()).padStart(2,'0');
    el.textContent = `${hh}:${mm}:${ss}`.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
  };
  tick();
  setInterval(tick, 1000);
}

// ═══════════════════════════════════════════════════════
// RENDER: OKR
// ═══════════════════════════════════════════════════════
function renderOKR() {
  const k = STATE.kpi || localKPIs();
  const okr = computeOKR(k);
  STATE.okr = okr;

  // radar: فروش / فاکتور / ATV / تبدیل / مرجوعی↓ / اپ‌سل
  const findKR = (objId, krId) => {
    const o = okr.objectives.find(x=>x.id===objId);
    return o ? o.keyResults.find(x=>x.id===krId) : null;
  };
  const salesKR  = findKR('O1','KR1');
  const invKR    = findKR('O2','KR1');   // ATV به‌عنوان نماینده کیفیت فاکتور
  const atvKR    = findKR('O2','KR1');
  const convKR   = findKR('O4','KR3');
  const returnKR = findKR('O3','KR3');
  const upsellKR = findKR('O2','KR3');
  const radarAxes = ['فروش','فاکتور','ATV','تبدیل','مرجوعی↓','اپ‌سل'];
  const radarActual = [
    salesKR?.progress || 0,
    Math.min(1, (k.invoiceCount||0) / Math.max(1, (MOCK.settings.monthlyTarget/MOCK.settings.ATV_Target))),
    atvKR?.progress || 0,
    convKR?.progress || 0,
    returnKR?.progress || 0,
    upsellKR?.progress || 0,
  ];
  const radarTarget = [1,1,1,1,1,1];
  drawRadarChart('okr-radar', radarAxes, radarActual, radarTarget);
  const periodEl = document.getElementById('okr-radar-period');
  if (periodEl) periodEl.textContent = okr.period;

  document.getElementById('okr-score').textContent =
    okr.totalScore.toLocaleString('fa-IR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const color = okr.status==='on_track' ? '#22C55E' : okr.status==='risk' ? '#F59E0B' : '#EF4444';
  ringDraw('okr-ring', okr.totalScore, color);

  const st = document.getElementById('okr-status');
  const stMap = {on_track:['st-ok','✓ در مسیر هدف'],risk:['st-risk','◐ در معرض ریسک'],off_track:['st-off','✕ خارج از مسیر']};
  st.className = 'okr-status ' + stMap[okr.status][0];
  st.textContent = stMap[okr.status][1];

  // recommendations
  const weak = [];
  okr.objectives.forEach(o=>o.keyResults.forEach(kr=>{
    if (kr.progress < 0.6) weak.push({obj:o.title, kr:kr.title, p:kr.progress});
  }));
  weak.sort((a,b)=>a.p-b.p);
  const rec = document.getElementById('okr-rec');
  rec.innerHTML = weak.length ? `
    <div class="insight ${weak[0].p<0.35?'bad':'warn'}">
      <span class="ic">💡</span>
      <div><b>اقدام پیشنهادی</b>
        ضعیف‌ترین شاخص: «${weak[0].kr}» با ${pct(weak[0].p)} پیشرفت.
        ${weak.length>1?`همچنین «${weak[1].kr}» نیاز به توجه دارد.`:''}
      </div>
    </div>` : `
    <div class="insight good"><span class="ic">✓</span>
      <div><b>عملکرد OKR مطلوب</b>تمام Key Result ها بالای ۶۰٪ پیشرفت دارند.</div></div>`;

  // objectives
  const box = document.getElementById('okr-objectives');
  box.innerHTML = okr.objectives.map(o=>{
    const c = o.status==='on_track'?'#22C55E':o.status==='risk'?'#F59E0B':'#EF4444';
    return `<div class="card obj-card">
      <div class="obj-h">
        <div class="obj-t">${o.title}</div>
        <div style="text-align:left">
          <div class="obj-sc" style="color:${c}">${pct(o.score)}</div>
          <span class="obj-w">وزن ${pct(o.weight)}</span>
        </div>
      </div>
      ${o.keyResults.map(kr=>{
        const kc = kr.progress>=0.75?'#22C55E':kr.progress>=0.45?'#F59E0B':'#EF4444';
        const fmtVal = v => kr.metric.includes('Percent')||kr.metric.includes('Rate')||kr.metric.includes('Share')
          ? pct(v) : kr.metric==='UPT' ? (v||0).toFixed(1) : money(v);
        return `<div class="kr">
          <div class="kr-h">
            <span class="kr-t">${kr.title}</span>
            <span class="kr-v" style="color:${kc}">${fmtVal(kr.actual)} / ${fmtVal(kr.target)}</span>
          </div>
          <div class="kr-bar"><div class="kr-f" style="width:${kr.progress*100}%;background:${kc}"></div></div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// RENDER: WARNINGS
// ═══════════════════════════════════════════════════════
let warnFilter = 'all';
function filterWarn(sev) {
  warnFilter = sev;
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on', t.dataset.sev===sev));
  renderWarnings();
}

function renderWarnings() {
  const list = warnFilter==='all' ? STATE.warnings
    : STATE.warnings.filter(w=>w.severity===warnFilter);
  const el = document.getElementById('warn-list');
  if (!list.length) {
    el.innerHTML = `<div class="empty"><div class="ic">✓</div>
      <p>هیچ هشداری در این دسته نیست</p></div>`;
    return;
  }
  const icons = {critical:'⛔',warning:'⚠️',info:'ℹ️'};
  const cls = {critical:'crit',warning:'warn',info:'info'};
  el.innerHTML = list.map(w=>`
    <div class="alert-c ${cls[w.severity]||'info'}">
      <div class="alert-ic">${icons[w.severity]||'ℹ️'}</div>
      <div class="alert-b">
        <div class="alert-t">${w.title}</div>
        <div class="alert-d">${w.detail}</div>
      </div>
      ${w.count>1?`<div class="alert-n" style="color:${w.severity==='critical'?'var(--danger)':'var(--warning)'}">${fa(w.count)}</div>`:''}
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════
// RENDER: DAILY CLOSURE
// ═══════════════════════════════════════════════════════
async function loadClosure() {
  const date = document.getElementById('close-date').value || todayFa();
  document.getElementById('close-date').value = date;
  const d = await api.getClosure(date);

  document.getElementById('c-sales').textContent  = money(d.netSales);
  document.getElementById('c-inv').textContent    = fa(d.invoiceCount);
  document.getElementById('c-items').textContent  = fa(d.itemsQty);
  document.getElementById('c-profit').textContent = money(d.grossProfit);
  document.getElementById('c-count').textContent  = fa(d.invoiceCount);

  // payments
  const pb = document.getElementById('pay-breakdown');
  const pays = d.paymentBreakdown || [];
  if (pays.length) {
    const max = Math.max(...pays.map(p=>p.amount),1);
    pb.innerHTML = pays.map(p=>`
      <div class="bar-row">
        <div class="bar-h"><span>${p.method}</span><span class="v">${money(p.amount)}</span></div>
        <div class="bar"><div class="bar-f" style="width:${p.amount/max*100}%;background:linear-gradient(90deg,#38BDF8,#7DD3FC)"></div></div>
      </div>`).join('');
  } else pb.innerHTML = `<div class="empty" style="padding:20px"><p>فروشی ثبت نشده</p></div>`;

  // invoices
  const ci = document.getElementById('close-invoices');
  ci.innerHTML = (d.invoices||[]).length ? d.invoices.map(i=>`
    <div class="inv-item">
      <div>
        <div class="inv-no">${i.invoiceNo}</div>
        <div class="inv-meta">${i.personnelName||'—'} • ${i.paymentMethod||'—'} • ${fa(i.itemsQty||0)} قلم</div>
      </div>
      <div class="inv-amt">${money(i.netTotal)}</div>
    </div>`).join('')
    : `<div class="empty" style="padding:26px"><div class="ic">📋</div><p>فاکتوری در این تاریخ نیست</p></div>`;
}

function exportDay() {
  const date = document.getElementById('close-date').value;
  const d = localClosure(date);
  const blob = new Blob([JSON.stringify(d,null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `CHAAM_closure_${date.replace(/\//g,'-')}.json`;
  a.click();
  toast('گزارش دانلود شد','ok');
}

const FA_MONTHS = ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور",
                   "مهر","آبان","آذر","دی","بهمن","اسفند"];

function localTrend(months, year) {
  const monthly = {};
  STATE.invoices.forEach(inv => {
    const parts = (inv.date || '').split('/');
    if (parts.length < 2) return;
    const y = parts[0], m = parts[1];
    if (year && y !== String(year)) return;
    const key = `${y}/${m}`;
    monthly[key] = (monthly[key] || 0) + (inv.netTotal || 0);
  });
  const keys = Object.keys(monthly).sort().slice(-months);
  const labels = [], values = [];
  keys.forEach(k => {
    const m = parseInt(k.split('/')[1]);
    labels.push(FA_MONTHS[m-1] || '');
    values.push(monthly[k]);
  });
  while (values.length < months) { values.unshift(0); labels.unshift(''); }
  const years = [...new Set(STATE.invoices.map(i => (i.date||'').split('/')[0]).filter(Boolean))];
  return {labels, values, yearsAvailable: years, months};
}

function localTodayKPI(date) {
  const list = STATE.invoices.filter(i => i.date === date);
  const sales = list.reduce((s,i)=>s+(i.netTotal||0),0);
  const dailyTarget = MOCK.settings.monthlyTarget / 30;
  const invTarget = Math.max(1, Math.round(dailyTarget / MOCK.settings.ATV_Target));
  const st = (a,t,hi=true) => hi
    ? (a>=t?'excellent':a>=t*0.9?'close':'behind')
    : (a<=t?'excellent':a<=t*1.2?'close':'behind');
  return {
    date,
    sales:{actual:sales, target:dailyTarget, status:st(sales,dailyTarget)},
    invoices:{actual:list.length, target:invTarget, status:st(list.length,invTarget)},
    conversionRate:{actual:0.28, target:MOCK.settings.Conversion_Target, status:'close'},
    returns:{actual:0, target:2, status:'excellent'},
    upsell:{actual:0, target:Math.round(invTarget*2.5), status:'behind'},
  };
}

function todayFa() {
  try {
    return new Intl.DateTimeFormat('fa-IR-u-nu-latn',{year:'numeric',month:'2-digit',day:'2-digit'})
      .format(new Date()).replace(/‏/g,'');
  } catch { return '1404/06/15'; }
}

// ═══════════════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════════════
async function refreshAll() {
  const btn = document.getElementById('refresh-btn');
  btn.style.transform = 'rotate(360deg)';
  btn.style.transition = 'transform .6s';
  setTimeout(()=>{btn.style.transition='none';btn.style.transform='none'},600);

  try { ONLINE = await api.health(); } catch { ONLINE = false; }
  updateConnection();

  const [prods, pers, kpi, warns] = await Promise.all([
    api.getProducts(), api.getPersonnel(), api.getKPIs(), api.getWarnings()
  ]);
  STATE.products = prods;
  STATE.personnel = pers;
  STATE.kpi = kpi;
  STATE.warnings = warns;

  fillPersonnel();
  renderHome();
  const active = document.querySelector('.screen.on')?.id.replace('scr-','');
  if (active==='dash') renderDashboard();
  if (active==='okr') renderOKR();
  if (active==='warn') renderWarnings();

  toast(ONLINE ? 'داده‌ها بروزرسانی شد' : 'حالت آفلاین — داده محلی', ONLINE?'ok':'warn');
}

function updateConnection() {
  const dots = ['conn-dot','side-dot','pos-dot'];
  dots.forEach(id=>{
    const d = document.getElementById(id);
    if (d) d.className = 'dot ' + (ONLINE?'on':'off');
  });
  const txt = ONLINE ? 'متصل به سیستم' : 'حالت آفلاین';
  ['conn-txt','side-status'].forEach(id=>{
    const e = document.getElementById(id); if (e) e.textContent = txt;
  });
  const pc = document.getElementById('pos-conn');
  if (pc) pc.textContent = ONLINE ? 'آنلاین' : 'آفلاین';
}

function fillPersonnel() {
  const sel = document.getElementById('f-personnel');
  const cur = sel.value;
  sel.innerHTML = '<option value="">انتخاب کنید</option>' +
    STATE.personnel.map(p=>`<option value="${p.id}">${p.id} — ${p.name}</option>`).join('');
  if (cur) sel.value = cur;
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// INIT — fail-safe: splash ALWAYS closes
// ═══════════════════════════════════════════════════════
let _splashDone = false;
function hideSplash() {
  if (_splashDone) return;
  _splashDone = true;
  const s = document.getElementById('splash');
  if (s) s.classList.add('hide');
}

// Hard guarantee: splash closes after 3s no matter what
setTimeout(hideSplash, 3000);

// Catch anything that escapes
window.addEventListener('error', e => { console.error('CHAAM error:', e.message); hideSplash(); });
window.addEventListener('unhandledrejection', e => { console.error('CHAAM promise:', e.reason); hideSplash(); });

async function init() {
  // ── Splash hides on its own timer — NEVER blocked by network ──
  setTimeout(() => {
    const sp = document.getElementById('splash');
    if (sp) sp.classList.add('hide');
  }, 1500);

  try {
    // 1) Instant local data so UI is usable immediately
    STATE.products  = MOCK.products;
    STATE.personnel = MOCK.personnel;

    const today = todayFa();
    document.getElementById('pos-date').textContent = today;
    document.getElementById('close-date').value = today;

    const n = parseInt(localStorage.getItem('chaam_offline_next') || '1');
    STATE.invoice.no = 'F-' + String(n).padStart(5, '0');
    document.getElementById('pos-no').textContent = STATE.invoice.no;

    applyRole();
    fillPersonnel();

    STATE.kpi      = localKPIs();
    STATE.warnings = localWarnings();
    renderHome();
    renderItems();

    // clocks
    setInterval(() => {
      const t = document.getElementById('side-time');
      if (t) t.textContent = new Date().toLocaleTimeString('fa-IR');
    }, 1000);
    startLiveClock();

  } catch (e) {
    console.error('init error:', e);
  }

  // 2) Try connector in background — UI already works
  connectBackground();
}

async function connectBackground() {
  try {
    ONLINE = await api.health();
  } catch { ONLINE = false; }
  updateConnection();

  if (!ONLINE) {
    console.log('ℹ️ حالت آفلاین — داده نمونه (فقط سطح فروشگاه)');
    setSession(CONFIG.TOKEN, 'store');
    return;
  }
  await ensureLogin();

  try {
    const [prods, pers, kpi, warns, nextNo] = await Promise.all([
      api.getProducts(), api.getPersonnel(),
      api.getKPIs(), api.getWarnings(), api.nextInvoiceNo()
    ]);
    if (prods && prods.length) STATE.products  = prods;
    if (pers  && pers.length)  STATE.personnel = pers;
    if (kpi)    STATE.kpi      = kpi;
    if (warns)  STATE.warnings = warns;
    if (nextNo) {
      STATE.invoice.no = nextNo;
      document.getElementById('pos-no').textContent = nextNo;
    }
    fillPersonnel();
    renderHome();
    const active = document.querySelector('.screen.on')?.id.replace('scr-','');
    if (active === 'dash') renderDashboard();
    if (active === 'okr')  renderOKR();
    if (active === 'warn') renderWarnings();
    toast('متصل به سیستم', 'ok');
  } catch (e) {
    console.warn('sync failed:', e);
  }
}

// Service worker — only over http/https, never file://
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

document.addEventListener('DOMContentLoaded', init);
