import { useState, useRef, useCallback } from "react";

const BASE    = "https://data.alpaca.markets";
const SCREENER = `${BASE}/v1beta1/screener/stocks/most-actives?by=volume&top=100`;
const BARS_URL = (syms, tf, start, end) =>
  `${BASE}/v2/stocks/bars?symbols=${encodeURIComponent(syms)}&timeframe=${tf}&start=${start}&end=${end}&feed=iex&adjustment=raw&limit=1000`;

const C = {
  bg:"#030b06", bgPanel:"#040d07",
  border:"#0d2a12", border2:"#071209",
  green:"#00ff88", green2:"#5ab87a", green3:"#4a8a5a", green4:"#2a6a3a",
  red:"#ff4466", red2:"#b85a7a",
  amber:"#f59e0b",
  text:"#aaffcc", textDim:"#7acc8e", textMid:"#4a8a5a", textFar:"#2a5a38", textMin:"#1a3a22",
};

const fmt   = (n,d=2) => n==null?"—":Number(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtP  = (n)     => n==null?"—":(n*100).toFixed(1)+"%";
const fmtPt = (n)     => n==null?"—":n.toFixed(2);

// ── SMA ───────────────────────────────────────────────────────────────────────
function sma(bars, period) {
  if (!bars || bars.length < period) return null;
  const slice = bars.slice(-period);
  return slice.reduce((s,b) => s + b.c, 0) / period;
}

// ── ATR (Wilder 14) ───────────────────────────────────────────────────────────
function calcATR(bars, period=14) {
  if (!bars || bars.length < period+1) return null;
  const trs = [];
  for (let i=1; i<bars.length; i++) {
    const c=bars[i], p=bars[i-1];
    trs.push(Math.max(c.h-c.l, Math.abs(c.h-p.c), Math.abs(c.l-p.c)));
  }
  if (trs.length < period) return null;
  let atr = trs.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for (let i=period; i<trs.length; i++) atr = (atr*(period-1)+trs[i])/period;
  return atr;
}

// ── Optionable check via Alpaca assets endpoint ───────────────────────────────
async function checkOptionable(syms, headers) {
  // Alpaca assets endpoint returns attributes including options_enabled
  const url = `https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity`;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return {};
    const assets = await res.json();
    const map = {};
    for (const a of assets) {
      if (syms.includes(a.symbol)) {
        map[a.symbol] = Array.isArray(a.attributes) && a.attributes.includes("options_enabled");
      }
    }
    return map;
  } catch { return {}; }
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function getOpeningWindow() {
  const now = new Date();
  const etOffset = isDST(now) ? -4 : -5;
  const utc = now.getTime() + now.getTimezoneOffset()*60000;
  const et  = new Date(utc + etOffset*3600000);
  const dateStr = et.toISOString().slice(0,10);
  const offsetUTC = (-etOffset).toString().padStart(2,"0");
  const start = `${dateStr}T09:30:00-0${offsetUTC}:00`;
  const end   = `${dateStr}T09:45:00-0${offsetUTC}:00`;
  return { start, end, dateStr };
}

function isDST(d) {
  const jan = new Date(d.getFullYear(),0,1).getTimezoneOffset();
  const jul = new Date(d.getFullYear(),6,1).getTimezoneOffset();
  return Math.min(jan,jul) === d.getTimezoneOffset();
}

function daysAgo(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate()-n);
  return d.toISOString().slice(0,10);
}

function chunk(arr,n) {
  const out=[];
  for(let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n));
  return out;
}

// ── Main Scanner ──────────────────────────────────────────────────────────────
export default function Scanner({ apiKey, apiSecret }) {
  const [phase,    setPhase]    = useState("idle");
  const [progress, setProgress] = useState("");
  const [results,  setResults]  = useState([]);
  const [error,    setError]    = useState("");
  const [sortKey,  setSortKey]  = useState("ratio");
  const [sortDir,  setSortDir]  = useState(-1);

  // Filters
  const [minPrice,    setMinPrice]    = useState("20");
  const [maxPrice,    setMaxPrice]    = useState("100");
  const [minVol,      setMinVol]      = useState("1000000");
  const [minRatio,    setMinRatio]    = useState("0.25");
  const [chkOptionable, setChkOptionable] = useState(true);
  const [chkSMA20,    setChkSMA20]    = useState(true);
  const [chkSMA50,    setChkSMA50]    = useState(true);
  const [chkSMA200,   setChkSMA200]   = useState(true);

  const abortRef = useRef(false);

  const authHeaders = {
    "APCA-API-KEY-ID":     apiKey,
    "APCA-API-SECRET-KEY": apiSecret,
  };

  const apiFetch = useCallback(async (url) => {
    const res = await fetch(url, { headers: authHeaders });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url.split("?")[0]}`);
    return res.json();
  }, [apiKey, apiSecret]);

  const run = useCallback(async () => {
    if (!apiKey || !apiSecret) { setError("No API credentials — enter keys first"); return; }
    abortRef.current = false;
    setPhase("screening"); setError(""); setResults([]);

    try {
      // Step 1 — Most actives
      setProgress("Fetching top 100 most-active stocks...");
      const screenData  = await apiFetch(SCREENER);
      const mostActives = screenData.most_actives || [];

      // Step 2 — Price + volume filter
      const pMin = parseFloat(minPrice)||20;
      const pMax = parseFloat(maxPrice)||100;
      const vMin = parseFloat(minVol)||1000000;
      const rMin = parseFloat(minRatio)||0.25;

      const filtered = mostActives.filter(s =>
        s.close >= pMin && s.close <= pMax && s.volume >= vMin
      );

      if (!filtered.length) {
        setError("No stocks passed price/volume filter. Widen filters or run during market hours.");
        setPhase("idle"); return;
      }

      const syms = filtered.map(s=>s.symbol);
      const { start, end, dateStr } = getOpeningWindow();
      const symChunks = chunk(syms, 25);

      // Step 3 — Optionable check (optional)
      let optMap = {};
      if (chkOptionable) {
        setProgress("Checking optionable status...");
        optMap = await checkOptionable(syms, authHeaders);
      }

      // Step 4 — Daily bars for SMA + ATR (need 200+ days for SMA200)
      setProgress("Fetching daily bars for SMA + ATR...");
      const dailyStart = daysAgo(dateStr, 280); // ~280 calendar days ≈ 200 trading days
      const barsMapDaily = {};
      for (const ch of symChunks) {
        if (abortRef.current) return;
        const data = await apiFetch(BARS_URL(ch.join(","), "1Day", dailyStart, dateStr));
        Object.assign(barsMapDaily, data.bars||{});
      }

      // Step 5 — 15-min opening bar
      setProgress("Fetching 15-min opening bars...");
      const barsMap15 = {};
      for (const ch of symChunks) {
        if (abortRef.current) return;
        const data = await apiFetch(BARS_URL(ch.join(","), "15Min", start, end));
        Object.assign(barsMap15, data.bars||{});
      }

      // Step 6 — Calculate + filter
      setProgress("Calculating signals...");
      const hits = [];

      for (const stock of filtered) {
        const sym    = stock.symbol;
        const bars15 = barsMap15[sym];
        const daily  = barsMapDaily[sym];

        if (!bars15 || !bars15.length) continue;

        const bar   = bars15[0];
        const range = bar.h - bar.l;
        const atr   = calcATR(daily);
        if (!atr || atr===0) continue;

        const ratio = range / atr;
        if (ratio < rMin) continue;

        // SMA checks — price must be ABOVE 50 and 200 SMA, BELOW 20 SMA
        const lastClose = stock.close;
        const s20  = sma(daily, 20);
        const s50  = sma(daily, 50);
        const s200 = sma(daily, 200);

        if (chkSMA20  && s20  != null && lastClose >= s20)  continue; // must be BELOW 20 SMA
        if (chkSMA50  && s50  != null && lastClose <= s50)  continue; // must be ABOVE 50 SMA
        if (chkSMA200 && s200 != null && lastClose <= s200) continue; // must be ABOVE 200 SMA

        // Optionable filter
        if (chkOptionable && optMap[sym] === false) continue;

        hits.push({
          symbol:     sym,
          close:      lastClose,
          volume:     stock.volume,
          open:       bar.o,
          high:       bar.h,
          low:        bar.l,
          close15:    bar.c,
          range,
          atr,
          ratio,
          sma20:      s20,
          sma50:      s50,
          sma200:     s200,
          optionable: optMap[sym] ?? null,
          direction:  bar.c >= bar.o ? "bull" : "bear",
        });
      }

      hits.sort((a,b) => b.ratio - a.ratio);
      setResults(hits);
      setPhase("done");
      setProgress(`Done — ${hits.length} stock${hits.length!==1?"s":""} matched all filters`);

    } catch(e) {
      setError(e.message);
      setPhase("error");
    }
  }, [apiKey, apiSecret, minPrice, maxPrice, minVol, minRatio, chkOptionable, chkSMA20, chkSMA50, chkSMA200, apiFetch]);

  const stop = () => { abortRef.current=true; setPhase("idle"); setProgress(""); };

  const toggleSort = (k) => { if(sortKey===k) setSortDir(d=>-d); else {setSortKey(k);setSortDir(-1);} };
  const SortBtn = ({k,label}) => (
    <button onClick={()=>toggleSort(k)} style={{background:"none",border:"none",cursor:"pointer",fontFamily:"monospace",fontSize:10,fontWeight:600,letterSpacing:"0.08em",padding:0,textTransform:"uppercase",color:sortKey===k?C.green:C.textMid}}>
      {label}{sortKey===k?(sortDir===1?"▲":"▼"):""}
    </button>
  );

  const sorted = [...results].sort((a,b)=>{
    const av=a[sortKey], bv=b[sortKey];
    if(av==null&&bv==null) return 0;
    if(av==null) return 1; if(bv==null) return -1;
    if(typeof av==="string") return av.localeCompare(bv)*sortDir;
    return (av-bv)*sortDir;
  });

  const isBusy = ["screening","fetching15","fetchingATR"].includes(phase);

  const iStyle = {background:"#06110a",border:"1px solid #1a3a22",color:C.textDim,fontFamily:"monospace",fontSize:11,padding:"5px 8px",borderRadius:2,outline:"none"};
  const bStyle = {background:"none",border:"1px solid #1a5a2a",color:"#4acc6a",cursor:"pointer",fontFamily:"monospace",fontSize:11,padding:"6px 14px",borderRadius:2,letterSpacing:"0.06em"};
  const chkStyle = {accentColor:C.green,width:13,height:13,cursor:"pointer"};
  const lbStyle  = {fontSize:10,color:C.textMid,cursor:"pointer",letterSpacing:"0.06em"};

  return (
    <div style={{fontFamily:"monospace",background:C.bg,flex:1,display:"flex",flexDirection:"column",overflow:"hidden",fontSize:12}}>

      {/* Config */}
      <div style={{background:C.bgPanel,borderBottom:"1px solid "+C.border,padding:"8px 16px",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",flexShrink:0}}>

        {/* Price + Vol */}
        <span style={{fontSize:10,color:C.textFar,letterSpacing:"0.1em",flexShrink:0}}>OR SCANNER</span>
        <div style={{width:1,height:20,background:C.border}}/>
        <span style={{fontSize:10,color:C.textMid}}>PRICE</span>
        <input style={{...iStyle,width:70}} value={minPrice} onChange={e=>setMinPrice(e.target.value)} placeholder="Min $"/>
        <span style={{fontSize:10,color:C.textFar}}>–</span>
        <input style={{...iStyle,width:70}} value={maxPrice} onChange={e=>setMaxPrice(e.target.value)} placeholder="Max $"/>
        <div style={{width:1,height:20,background:C.border}}/>
        <span style={{fontSize:10,color:C.textMid}}>VOL ≥</span>
        <input style={{...iStyle,width:100}} value={minVol} onChange={e=>setMinVol(e.target.value)} placeholder="1000000"/>
        <div style={{width:1,height:20,background:C.border}}/>
        <span style={{fontSize:10,color:C.textMid}}>RANGE/ATR ≥</span>
        <input style={{...iStyle,width:60}} value={minRatio} onChange={e=>setMinRatio(e.target.value)} placeholder="0.25"/>
        <div style={{width:1,height:20,background:C.border}}/>

        {/* Toggle filters */}
        <label style={{display:"flex",alignItems:"center",gap:5}}>
          <input type="checkbox" style={chkStyle} checked={chkOptionable} onChange={e=>setChkOptionable(e.target.checked)}/>
          <span style={lbStyle}>OPTIONABLE</span>
        </label>
        <label style={{display:"flex",alignItems:"center",gap:5}}>
          <input type="checkbox" style={chkStyle} checked={chkSMA20} onChange={e=>setChkSMA20(e.target.checked)}/>
          <span style={lbStyle}>{"< SMA20"}</span>
        </label>
        <label style={{display:"flex",alignItems:"center",gap:5}}>
          <input type="checkbox" style={chkStyle} checked={chkSMA50} onChange={e=>setChkSMA50(e.target.checked)}/>
          <span style={lbStyle}>{"> SMA50"}</span>
        </label>
        <label style={{display:"flex",alignItems:"center",gap:5}}>
          <input type="checkbox" style={chkStyle} checked={chkSMA200} onChange={e=>setChkSMA200(e.target.checked)}/>
          <span style={lbStyle}>{"> SMA200"}</span>
        </label>
        <div style={{width:1,height:20,background:C.border}}/>
        {!isBusy
          ? <button style={bStyle} onClick={run}>▶ RUN SCAN</button>
          : <button style={{...bStyle,color:C.red2,border:"1px solid #5a1a22"}} onClick={stop}>■ STOP</button>
        }
        <span style={{fontSize:10,marginLeft:4,color:isBusy?C.amber:phase==="done"?C.green:phase==="error"?C.red:C.textFar}}>
          {isBusy&&"⟳ "}{progress||(phase==="idle"?"Run after 9:45 AM ET":"")}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div style={{margin:"8px 16px",padding:"8px 12px",background:"#1a0808",border:"1px solid #f43f5e44",borderRadius:2,fontSize:11,color:C.red}}>
          {error}
        </div>
      )}

      {/* Info bar */}
      <div style={{padding:"4px 16px",fontSize:9,color:C.textMin,borderBottom:"1px solid "+C.border2,flexShrink:0}}>
        ⓘ Scans top 100 most-active stocks · Filters: price ${minPrice}–${maxPrice} · vol ≥{Number(minVol).toLocaleString()} · 15-min OR range/ATR(14) ≥{(parseFloat(minRatio)||0.25)*100}%
        {chkOptionable?" · options-enabled only":""}{chkSMA20?" · close < SMA20":""}{chkSMA50?" · close > SMA50":""}{chkSMA200?" · close > SMA200":""}
      </div>

      {/* Results */}
      <div style={{flex:1,overflowY:"auto",overflowX:"auto"}}>
        {sorted.length > 0 && (
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
            <thead>
              <tr style={{borderBottom:"1px solid "+C.border,position:"sticky",top:0,background:C.bg,zIndex:2}}>
                {[
                  ["symbol","SYMBOL"],["direction","DIR"],["optionable","OPT"],
                  ["close","CLOSE"],["volume","VOLUME"],
                  ["open","OPEN"],["high","HIGH"],["low","LOW"],["close15","15M"],
                  ["range","RANGE"],["atr","ATR14"],["ratio","RNG/ATR"],
                  ["sma20","SMA20"],["sma50","SMA50"],["sma200","SMA200"],
                ].map(([k,l])=>(
                  <th key={k} style={{padding:"6px 8px",textAlign:["symbol","direction","optionable"].includes(k)?"left":"right",fontWeight:"normal",whiteSpace:"nowrap"}}>
                    <SortBtn k={k} label={l}/>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => {
                const bull = r.direction==="bull";
                const rc   = r.ratio>=0.5?C.green:r.ratio>=0.35?C.amber:C.textDim;
                const smaRow = (val, close, above) => {
                  if (val==null) return <span style={{color:C.textMin}}>—</span>;
                  const ok = above ? close>val : close<val;
                  return <span style={{color:ok?C.green2:C.red2}}>{fmtPt(val)}</span>;
                };
                return (
                  <tr key={r.symbol} style={{borderBottom:"1px solid "+C.border2}}>
                    <td style={{padding:"7px 8px",fontWeight:700,fontSize:13,color:C.text,letterSpacing:"0.05em"}}>{r.symbol}</td>
                    <td style={{padding:"7px 8px"}}>
                      <span style={{fontSize:10,fontWeight:600,color:bull?C.green:C.red,padding:"2px 5px",border:`1px solid ${bull?C.green4:C.red2}`,borderRadius:2}}>
                        {bull?"BULL":"BEAR"}
                      </span>
                    </td>
                    <td style={{padding:"7px 8px"}}>
                      {r.optionable===null
                        ? <span style={{color:C.textMin,fontSize:10}}>—</span>
                        : <span style={{fontSize:10,color:r.optionable?C.green:C.textFar}}>{r.optionable?"✓":"✗"}</span>
                      }
                    </td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.textDim,  fontSize:12}}>{fmt(r.close)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.textFar,  fontSize:11}}>{Number(r.volume).toLocaleString()}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.textMid,  fontSize:11}}>{fmt(r.open)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.green2,   fontSize:11}}>{fmt(r.high)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.red2,     fontSize:11}}>{fmt(r.low)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:bull?C.green2:C.red2,fontSize:11}}>{fmt(r.close15)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.textDim,  fontSize:11}}>{fmt(r.range,3)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.textFar,  fontSize:11}}>{fmt(r.atr,3)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right"}}>
                      <span style={{fontSize:13,fontWeight:700,color:rc}}>{fmtP(r.ratio)}</span>
                    </td>
                    <td style={{padding:"7px 8px",textAlign:"right",fontSize:11}}>{smaRow(r.sma20,  r.close, false)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",fontSize:11}}>{smaRow(r.sma50,  r.close, true)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",fontSize:11}}>{smaRow(r.sma200, r.close, true)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {phase==="done" && sorted.length===0 && (
          <div style={{padding:"60px 0",textAlign:"center",color:C.textMin,fontSize:11,letterSpacing:"0.1em"}}>
            NO STOCKS MATCHED ALL FILTERS — TRY RELAXING CONSTRAINTS
          </div>
        )}
      </div>

      {sorted.length>0 && (
        <div style={{borderTop:"1px solid "+C.border,padding:"4px 16px",fontSize:9,color:C.textMin,flexShrink:0}}>
          {sorted.length} STOCKS · 15-MIN OPENING RANGE · ATR14 WILDER · SMA ON DAILY CLOSES · NOT FOR TRADING
        </div>
      )}
    </div>
  );
}
