import { useState, useRef, useCallback } from "react";

// ── Constants ──────────────────────────────────────────────────────────────────
const BASE = "https://data.alpaca.markets";
const SCREENER = `${BASE}/v1beta1/screener/stocks/most-actives?by=volume&top=100`;
const BARS_URL  = (syms, tf, start, end) =>
  `${BASE}/v2/stocks/bars?symbols=${syms}&timeframe=${tf}&start=${start}&end=${end}&feed=iex&adjustment=raw&limit=1000`;

const C = {
  bg:"#030b06", bgPanel:"#040d07",
  border:"#0d2a12", border2:"#071209",
  green:"#00ff88", green2:"#5ab87a", green3:"#4a8a5a", green4:"#2a6a3a",
  red:"#ff4466", red2:"#b85a7a",
  amber:"#f59e0b",
  text:"#aaffcc", textDim:"#7acc8e", textMid:"#4a8a5a", textFar:"#2a5a38", textMin:"#1a3a22",
};

const fmt  = (n, d=2) => n==null ? "—" : Number(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtP = (n) => n==null ? "—" : (n*100).toFixed(1)+"%";

// ── ATR calculation (Wilder, 14-period) ───────────────────────────────────────
function calcATR(dailyBars, period=14) {
  if (!dailyBars || dailyBars.length < period+1) return null;
  const trs = [];
  for (let i=1; i<dailyBars.length; i++) {
    const curr = dailyBars[i], prev = dailyBars[i-1];
    const tr = Math.max(
      curr.h - curr.l,
      Math.abs(curr.h - prev.c),
      Math.abs(curr.l - prev.c)
    );
    trs.push(tr);
  }
  if (trs.length < period) return null;
  // Initial ATR = simple average of first `period` TRs
  let atr = trs.slice(0, period).reduce((a,b)=>a+b,0) / period;
  // Wilder smoothing for remaining
  for (let i=period; i<trs.length; i++) {
    atr = (atr*(period-1) + trs[i]) / period;
  }
  return atr;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getOpeningWindow() {
  // Returns ISO strings for 9:30 and 9:45 AM ET today
  const now = new Date();
  // Use date in ET (UTC-4 or UTC-5 depending on DST — approximate)
  const etOffset = -4; // EDT (summer). Change to -5 for EST winter.
  const utc = now.getTime() + now.getTimezoneOffset()*60000;
  const et  = new Date(utc + etOffset*3600000);
  const dateStr = et.toISOString().slice(0,10);
  const start = `${dateStr}T13:30:00Z`; // 9:30 AM ET = 13:30 UTC (EDT)
  const end   = `${dateStr}T13:45:00Z`; // 9:45 AM ET = 13:45 UTC
  return { start, end, dateStr };
}

function getPriorDaysStart(dateStr, days=20) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0,10);
}

// Chunk array into groups of n
function chunk(arr, n) {
  const out = [];
  for (let i=0; i<arr.length; i+=n) out.push(arr.slice(i,i+n));
  return out;
}

// ── Scanner component ─────────────────────────────────────────────────────────
export default function Scanner({ apiKey, apiSecret }) {
  const [phase,    setPhase]    = useState("idle"); // idle|screening|fetching15|fetchingATR|done|error
  const [progress, setProgress] = useState("");
  const [results,  setResults]  = useState([]);
  const [error,    setError]    = useState("");
  const [sortKey,  setSortKey]  = useState("ratio");
  const [sortDir,  setSortDir]  = useState(-1);

  // Config
  const [minPrice,  setMinPrice]  = useState("20");
  const [maxPrice,  setMaxPrice]  = useState("100");
  const [minVol,    setMinVol]    = useState("1000000");
  const [minRatio,  setMinRatio]  = useState("0.25");
  const abortRef = useRef(false);

  const headers = {
    "APCA-API-KEY-ID":     apiKey,
    "APCA-API-SECRET-KEY": apiSecret,
  };

  const apiFetch = useCallback(async (url) => {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
    return res.json();
  }, [apiKey, apiSecret]);

  const run = useCallback(async () => {
    if (!apiKey || !apiSecret) { setError("No API credentials — connect first"); return; }
    abortRef.current = false;
    setPhase("screening");
    setError("");
    setResults([]);

    try {
      // ── Step 1: Most actives top 100 by volume ──────────────────────────────
      setProgress("Fetching most active stocks...");
      const screenData = await apiFetch(SCREENER);
      const mostActives = screenData.most_actives || [];

      // ── Step 2: Filter by price + volume ───────────────────────────────────
      const pMin = parseFloat(minPrice)||20;
      const pMax = parseFloat(maxPrice)||100;
      const vMin = parseFloat(minVol)||1000000;
      const rMin = parseFloat(minRatio)||0.25;

      const filtered = mostActives.filter(s =>
        s.close >= pMin &&
        s.close <= pMax &&
        s.volume >= vMin
      );

      if (filtered.length === 0) {
        setError("No stocks passed price/volume filter from most-actives list. Try widening filters or run during market hours.");
        setPhase("idle");
        return;
      }

      const syms = filtered.map(s => s.symbol);
      setProgress(`${filtered.length} stocks passed filter. Fetching 15-min opening bars...`);
      setPhase("fetching15");

      // ── Step 3: 15-min opening bar (9:30–9:45) ─────────────────────────────
      const { start, end, dateStr } = getOpeningWindow();
      const priorStart = getPriorDaysStart(dateStr, 20);

      // Fetch in chunks of 25 (API limit per request varies — 25 is safe)
      const symChunks = chunk(syms, 25);
      const barsMap15 = {};

      for (const ch of symChunks) {
        if (abortRef.current) return;
        const url = BARS_URL(ch.join(","), "15Min", start, end);
        const data = await apiFetch(url);
        Object.assign(barsMap15, data.bars || {});
      }

      // ── Step 4: Daily bars for ATR (last 20 trading days) ──────────────────
      setProgress(`Fetching daily bars for ATR calculation...`);
      setPhase("fetchingATR");

      const barsMapDaily = {};
      for (const ch of symChunks) {
        if (abortRef.current) return;
        const url = BARS_URL(ch.join(","), "1Day", priorStart, dateStr);
        const data = await apiFetch(url);
        Object.assign(barsMapDaily, data.bars || {});
      }

      // ── Step 5: Calculate range/ATR ratio and filter ────────────────────────
      setProgress("Calculating ATR and range ratios...");
      const hits = [];

      for (const stock of filtered) {
        const sym   = stock.symbol;
        const bars15 = barsMap15[sym];
        const daily  = barsMapDaily[sym];

        if (!bars15 || bars15.length === 0) continue;

        const bar   = bars15[0]; // first 15-min candle
        const range = bar.h - bar.l;
        const atr   = calcATR(daily);

        if (!atr || atr === 0) continue;

        const ratio = range / atr;
        if (ratio >= rMin) {
          hits.push({
            symbol:  sym,
            close:   stock.close,
            volume:  stock.volume,
            open:    bar.o,
            high:    bar.h,
            low:     bar.l,
            close15: bar.c,
            range,
            atr,
            ratio,
            direction: bar.c >= bar.o ? "bull" : "bear",
          });
        }
      }

      hits.sort((a,b) => b.ratio - a.ratio);
      setResults(hits);
      setPhase("done");
      setProgress(`Scan complete — ${hits.length} stocks matched.`);

    } catch(e) {
      setError(e.message);
      setPhase("error");
    }
  }, [apiKey, apiSecret, minPrice, maxPrice, minVol, minRatio, apiFetch]);

  const stop = () => { abortRef.current = true; setPhase("idle"); setProgress(""); };

  const toggleSort = (k) => { if(sortKey===k) setSortDir(d=>-d); else { setSortKey(k); setSortDir(-1); } };
  const SortBtn = ({k,label}) => (
    <button onClick={()=>toggleSort(k)} style={{background:"none",border:"none",cursor:"pointer",fontFamily:"monospace",fontSize:10,fontWeight:600,letterSpacing:"0.08em",padding:0,textTransform:"uppercase",color:sortKey===k?C.green:C.textMid}}>
      {label}{sortKey===k?(sortDir===1?"▲":"▼"):""}
    </button>
  );

  const sorted = [...results].sort((a,b)=>{
    const av=a[sortKey], bv=b[sortKey];
    if(typeof av==="string") return av.localeCompare(bv)*sortDir;
    return (av-bv)*sortDir;
  });

  const isBusy = ["screening","fetching15","fetchingATR"].includes(phase);

  const bStyle = {background:"none",border:"1px solid #1a5a2a",color:"#4acc6a",cursor:"pointer",fontFamily:"monospace",fontSize:11,padding:"6px 14px",borderRadius:2,letterSpacing:"0.06em"};
  const iStyle = {background:"#06110a",border:"1px solid #1a3a22",color:C.textDim,fontFamily:"monospace",fontSize:11,padding:"5px 8px",borderRadius:2,outline:"none",width:90};

  return (
    <div style={{fontFamily:"monospace",background:C.bg,flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* Config bar */}
      <div style={{background:C.bgPanel,borderBottom:"1px solid "+C.border,padding:"8px 16px",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",flexShrink:0}}>
        <span style={{fontSize:10,color:C.textFar,letterSpacing:"0.1em"}}>OPENING RANGE SCANNER</span>
        <div style={{width:1,height:20,background:C.border}}/>

        <span style={{fontSize:10,color:C.textMid}}>PRICE</span>
        <input style={iStyle} value={minPrice} onChange={e=>setMinPrice(e.target.value)} placeholder="Min $"/>
        <span style={{fontSize:10,color:C.textFar}}>–</span>
        <input style={iStyle} value={maxPrice} onChange={e=>setMaxPrice(e.target.value)} placeholder="Max $"/>

        <div style={{width:1,height:20,background:C.border}}/>
        <span style={{fontSize:10,color:C.textMid}}>MIN VOL</span>
        <input style={{...iStyle,width:110}} value={minVol} onChange={e=>setMinVol(e.target.value)} placeholder="1000000"/>

        <div style={{width:1,height:20,background:C.border}}/>
        <span style={{fontSize:10,color:C.textMid}}>MIN RANGE/ATR</span>
        <input style={{...iStyle,width:70}} value={minRatio} onChange={e=>setMinRatio(e.target.value)} placeholder="0.25"/>

        <div style={{width:1,height:20,background:C.border}}/>
        {!isBusy
          ? <button style={bStyle} onClick={run}>▶ RUN SCAN</button>
          : <button style={{...bStyle,color:C.red2,border:"1px solid #5a1a22"}} onClick={stop}>■ STOP</button>
        }

        {/* Status */}
        <span style={{fontSize:10,color:isBusy?C.amber:phase==="done"?C.green:phase==="error"?C.red:C.textFar,marginLeft:8}}>
          {isBusy && "⟳ "}{progress || (phase==="idle"?"Ready — run after 9:45 AM ET":"") }
        </span>
      </div>

      {/* Error */}
      {error && (
        <div style={{margin:"8px 16px",padding:"8px 12px",background:"#1a0808",border:"1px solid #f43f5e44",borderRadius:2,fontSize:11,color:C.red}}>
          {error}
        </div>
      )}

      {/* Notice */}
      {phase==="idle" && !error && (
        <div style={{padding:"6px 16px",fontSize:9,color:C.textMin,borderBottom:"1px solid "+C.border2}}>
          ⓘ Run after 9:45 AM ET · Scans top 100 most-active stocks · Filters by price + volume · Calculates 15-min opening range vs 14-day ATR (Wilder) · Displays stocks where range &gt; {(parseFloat(minRatio)||0.25)*100}% of ATR
        </div>
      )}

      {/* Results table */}
      <div style={{flex:1,overflowY:"auto",overflowX:"auto"}}>
        {sorted.length > 0 && (
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}>
            <thead>
              <tr style={{borderBottom:"1px solid "+C.border,position:"sticky",top:0,background:C.bg,zIndex:2}}>
                {[["symbol","SYMBOL"],["direction","DIR"],["close","PREV CLOSE"],["volume","VOLUME"],["open","OPEN"],["high","HIGH"],["low","LOW"],["close15","15M CLOSE"],["range","RANGE"],["atr","ATR(14)"],["ratio","RANGE/ATR"]].map(([k,l])=>(
                  <th key={k} style={{padding:"7px 10px",textAlign:k==="symbol"||k==="direction"?"left":"right",fontWeight:"normal",whiteSpace:"nowrap"}}>
                    <SortBtn k={k} label={l}/>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => {
                const bull = r.direction==="bull";
                const ratioColor = r.ratio >= 0.5 ? C.green : r.ratio >= 0.35 ? C.amber : C.textDim;
                return (
                  <tr key={r.symbol} style={{borderBottom:"1px solid "+C.border2}}>
                    <td style={{padding:"8px 10px",fontWeight:700,fontSize:13,color:C.text,letterSpacing:"0.05em"}}>{r.symbol}</td>
                    <td style={{padding:"8px 10px"}}>
                      <span style={{fontSize:10,fontWeight:600,color:bull?C.green:C.red,padding:"2px 6px",border:`1px solid ${bull?C.green4:C.red2}`,borderRadius:2}}>
                        {bull?"BULL":"BEAR"}
                      </span>
                    </td>
                    <td style={{padding:"8px 10px",textAlign:"right",color:C.textDim,  fontSize:12}}>{fmt(r.close)}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",color:C.textFar,  fontSize:11}}>{Number(r.volume).toLocaleString()}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",color:C.textMid,  fontSize:11}}>{fmt(r.open)}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",color:C.green2,   fontSize:11}}>{fmt(r.high)}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",color:C.red2,     fontSize:11}}>{fmt(r.low)}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",color:bull?C.green2:C.red2,fontSize:11}}>{fmt(r.close15)}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",color:C.textDim,  fontSize:11}}>{fmt(r.range,3)}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",color:C.textFar,  fontSize:11}}>{fmt(r.atr,3)}</td>
                    <td style={{padding:"8px 10px",textAlign:"right"}}>
                      <span style={{fontSize:13,fontWeight:700,color:ratioColor}}>{fmtP(r.ratio)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {phase==="done" && sorted.length===0 && (
          <div style={{padding:"60px 0",textAlign:"center",color:C.textMin,fontSize:11,letterSpacing:"0.1em"}}>
            NO STOCKS MATCHED — TRY LOWERING MIN RANGE/ATR OR WIDENING PRICE FILTER
          </div>
        )}
      </div>

      {/* Footer */}
      {sorted.length > 0 && (
        <div style={{borderTop:"1px solid "+C.border,padding:"4px 16px",fontSize:9,color:C.textMin}}>
          {sorted.length} STOCKS · 15-MIN OPENING RANGE · ATR 14-DAY WILDER · NOT FOR TRADING
        </div>
      )}
    </div>
  );
}
