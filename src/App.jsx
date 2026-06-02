import { useState, useEffect, useRef, useCallback } from "react";

const DEFAULT_SYMBOLS = ["AAPL","MSFT","NVDA","TSLA","AMZN","META","GOOGL","SPY","QQQ","AMD"];
const WS_URL = "wss://stream.data.alpaca.markets/v2/iex";

const fmt  = (n, d=2) => n == null ? "—" : Number(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtT = (iso)   => iso ? new Date(iso).toLocaleTimeString("en-US",{hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "—";
const midP = (bp,ap) => (bp!=null&&ap!=null) ? (bp+ap)/2 : null;
const sprd = (bp,ap) => (bp!=null&&ap!=null) ? ap-bp : null;
const toUnixSec = (iso) => Math.floor(new Date(iso).getTime()/1000);

const C = {
  bg:"#030b06", bgPanel:"#040d07",
  border:"#0d2a12", border2:"#071209",
  green:"#00ff88", green2:"#5ab87a", green3:"#4a8a5a", green4:"#2a6a3a",
  red:"#ff4466", red2:"#b85a7a", red3:"#6a2a3a",
  text:"#aaffcc", textDim:"#7acc8e", textMid:"#4a8a5a", textFar:"#2a5a38", textMin:"#1a3a22",
};

const iStyle = {background:"#06110a",border:"1px solid #1a3a22",color:C.textDim,fontFamily:"monospace",fontSize:11,padding:"6px 10px",borderRadius:2,outline:"none"};
const bStyle = {background:"none",border:"1px solid #1a5a2a",color:"#4acc6a",cursor:"pointer",fontFamily:"monospace",fontSize:11,padding:"6px 14px",borderRadius:2,letterSpacing:"0.06em"};
const bDStyle = {...bStyle,border:"1px solid #5a1a22",color:"#cc4a5a"};
const thS = {background:"none",border:"none",cursor:"pointer",fontFamily:"monospace",fontSize:10,fontWeight:600,letterSpacing:"0.08em",padding:0,textTransform:"uppercase"};

// ── Canvas candlestick chart ──────────────────────────────────────────────────
function CandleChart({ symbol, bars }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.offsetWidth  || 410;
    const H = canvas.offsetHeight || 280;
    canvas.width  = W;
    canvas.height = H;

    const volH   = 44;
    const priceH = H - volH - 4;
    const padL=54, padR=8, padT=12, padB=2;
    const chartW = W - padL - padR;

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    if (!bars || bars.length === 0) {
      ctx.fillStyle = C.textMin;
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("WAITING FOR BAR DATA", W/2, H/2);
      return;
    }

    const visible  = bars.slice(-80);
    const n        = visible.length;
    const step     = chartW / n;
    const candleW  = Math.max(2, step - 2);

    const priceMax = Math.max(...visible.map(b=>b.h));
    const priceMin = Math.min(...visible.map(b=>b.l));
    const priceRng = priceMax - priceMin || 1;
    const volMax   = Math.max(...visible.map(b=>b.v)) || 1;

    const py = p => padT + (1-(p-priceMin)/priceRng)*(priceH-padT-padB);
    const vy = v => H - (v/volMax)*volH;

    // Grid
    ctx.lineWidth = 1;
    for (let i=0; i<=4; i++) {
      const y = padT + (i/4)*(priceH-padT-padB);
      ctx.strokeStyle = "#0a1e0d";
      ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke();
      ctx.fillStyle = C.textFar;
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      ctx.fillText(fmt(priceMax-(i/4)*priceRng), padL-3, y+3);
    }

    // Candles + volume
    visible.forEach((b,i) => {
      const x   = padL + i*step + step/2;
      const up  = b.c >= b.o;
      const col = up ? C.green : C.red;

      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x,py(b.h)); ctx.lineTo(x,py(b.l)); ctx.stroke();

      const bTop = py(Math.max(b.o,b.c));
      const bBot = py(Math.min(b.o,b.c));
      ctx.fillStyle = col;
      ctx.fillRect(x-candleW/2, bTop, candleW, Math.max(1,bBot-bTop));

      ctx.fillStyle = up ? "#00ff8833" : "#ff446633";
      ctx.fillRect(x-candleW/2, vy(b.v), candleW, H-vy(b.v));
    });

    // Vol divider
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL,H-volH); ctx.lineTo(W-padR,H-volH); ctx.stroke();

    // Last price line
    const last = visible[visible.length-1];
    if (last) {
      const y = py(last.c);
      ctx.strokeStyle = C.green;
      ctx.setLineDash([2,3]);
      ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#001a08";
      ctx.fillRect(W-padR-56, y-9, 56, 14);
      ctx.fillStyle = C.green;
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      ctx.fillText(fmt(last.c), W-padR-2, y+3);
    }

    // Time labels
    ctx.fillStyle = C.textFar;
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    const every = Math.max(1, Math.floor(n/6));
    visible.forEach((b,i) => {
      if (i % every === 0) {
        const x = padL + i*step + step/2;
        const t = new Date(b.t*1000);
        const lbl = t.getHours().toString().padStart(2,"0")+":"+t.getMinutes().toString().padStart(2,"0");
        ctx.fillText(lbl, x, H-volH-4);
      }
    });

  }, [bars, symbol]);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"5px 10px",borderBottom:"1px solid "+C.border,fontSize:10,color:C.textMid,display:"flex",justifyContent:"space-between",flexShrink:0}}>
        <span style={{color:C.text,fontWeight:700,letterSpacing:"0.1em"}}>{symbol}</span>
        <span>1-MIN BARS · IEX</span>
      </div>
      <canvas ref={canvasRef} style={{flex:1,width:"100%",display:"block"}}/>
    </div>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Spark({ points, color }) {
  if (!points || points.length < 2) return null;
  const w=54, h=14, pad=1;
  const mn=Math.min(...points), mx=Math.max(...points), rng=mx-mn||0.001;
  const xs=points.map((_,i)=>pad+i*(w-2*pad)/(points.length-1));
  const ys=points.map(v=>h-pad-(v-mn)/rng*(h-2*pad));
  const d="M"+xs.map((x,i)=>x.toFixed(1)+","+ys[i].toFixed(1)).join("L");
  return (
    <svg width={w} height={h}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round"/>
      <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r={2} fill={color}/>
    </svg>
  );
}

// ── Main terminal ─────────────────────────────────────────────────────────────
export default function App() {
  const [apiKey,    setApiKey]    = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [symbols,   setSymbols]   = useState(DEFAULT_SYMBOLS);
  const [symInput,  setSymInput]  = useState(DEFAULT_SYMBOLS.join(","));
  const [status,    setStatus]    = useState("disconnected");
  const [statusMsg, setStatusMsg] = useState("");
  const [ticks,     setTicks]     = useState({});
  const [midHist,   setMidHist]   = useState({});
  const [barHist,   setBarHist]   = useState({});
  const [trades,    setTrades]    = useState([]);
  const [sortKey,   setSortKey]   = useState("symbol");
  const [sortDir,   setSortDir]   = useState(1);
  const [filter,    setFilter]    = useState("");
  const [flash,     setFlash]     = useState({});
  const [chartSym,  setChartSym]  = useState("AAPL");
  const [showChart, setShowChart] = useState(true);
  const wsRef    = useRef(null);
  const flashRef = useRef({});

  const triggerFlash = useCallback((sym, dir) => {
    setFlash(f => ({...f,[sym]:dir}));
    clearTimeout(flashRef.current[sym]);
    flashRef.current[sym] = setTimeout(() => setFlash(f => { const n={...f}; delete n[sym]; return n; }), 500);
  }, []);

  const handleMsg = useCallback((msgs) => {
    if (!Array.isArray(msgs)) return;
    msgs.forEach(msg => {
      const {T,S} = msg;
      if (T==="success") {
        if (msg.msg==="connected")     setStatus("auth");
        if (msg.msg==="authenticated") setStatus("live");
        return;
      }
      if (T==="error")        { setStatus("error"); setStatusMsg(msg.msg||"Unknown error"); return; }
      if (T==="subscription") return;

      if (T==="q" && S) {
        setTicks(prev => {
          const old=prev[S]||{};
          const nm=midP(msg.bp,msg.ap);
          const dir=old.mid!=null?(nm>old.mid?"up":nm<old.mid?"down":null):null;
          if(dir) triggerFlash(S,dir);
          return {...prev,[S]:{...old,bp:msg.bp,bs:msg.bs,ap:msg.ap,as:msg.as,mid:nm,spread:sprd(msg.bp,msg.ap),qt:msg.t,dir}};
        });
        setMidHist(h => {
          const m=midP(msg.bp,msg.ap);
          if(m==null) return h;
          return {...h,[S]:[...(h[S]||[]),m].slice(-30)};
        });
      }
      if (T==="t" && S) {
        setTicks(prev => {
          const old=prev[S]||{};
          const dir=old.lastPrice!=null?(msg.p>old.lastPrice?"up":msg.p<old.lastPrice?"down":null):null;
          if(dir) triggerFlash(S,dir);
          return {...prev,[S]:{...old,lastPrice:msg.p,lastSize:msg.s,tt:msg.t,dir}};
        });
        setTrades(prev => [{sym:S,price:msg.p,size:msg.s,time:msg.t},...prev].slice(0,60));
      }
      if (T==="b" && S) {
        const bt=toUnixSec(msg.t);
        setTicks(prev => ({...prev,[S]:{...(prev[S]||{}),barO:msg.o,barH:msg.h,barL:msg.l,barC:msg.c,barV:msg.v,barVW:msg.vw}}));
        setBarHist(h => {
          const arr=h[S]||[];
          const last=arr[arr.length-1];
          if(last&&last.t===bt) return {...h,[S]:[...arr.slice(0,-1),{t:bt,o:msg.o,h:msg.h,l:msg.l,c:msg.c,v:msg.v}]};
          return {...h,[S]:[...arr,{t:bt,o:msg.o,h:msg.h,l:msg.l,c:msg.c,v:msg.v}].slice(-200)};
        });
      }
    });
  }, [triggerFlash]);

  const connect = useCallback(() => {
    if (!apiKey.trim()||!apiSecret.trim()) { setStatusMsg("Enter API key and secret"); setStatus("error"); return; }
    if (wsRef.current) wsRef.current.close();
    setStatus("connecting"); setStatusMsg(""); setTicks({}); setMidHist({}); setBarHist({}); setTrades([]);
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({action:"auth",key:apiKey.trim(),secret:apiSecret.trim()}));
    ws.onmessage = (e) => {
      try {
        const msgs=JSON.parse(e.data);
        handleMsg(msgs);
        if(Array.isArray(msgs)&&msgs.some(m=>m.T==="success"&&m.msg==="authenticated")) {
          const syms=symbols.filter(Boolean);
          ws.send(JSON.stringify({action:"subscribe",trades:syms,quotes:syms,bars:syms}));
        }
      } catch(err) { console.error(err); }
    };
    ws.onerror = () => { setStatus("error"); setStatusMsg("WebSocket error — check credentials"); };
    ws.onclose = (e) => { if(e.code!==1000) { setStatus("disconnected"); setStatusMsg("Closed: "+e.code); } };
  }, [apiKey,apiSecret,symbols,handleMsg]);

  const disconnect = useCallback(() => {
    if(wsRef.current) { wsRef.current.close(1000); wsRef.current=null; }
    setStatus("disconnected"); setStatusMsg("");
  }, []);

  useEffect(() => () => { if(wsRef.current) wsRef.current.close(); }, []);

  const applySymbols = () => {
    const s=symInput.split(",").map(x=>x.trim().toUpperCase()).filter(Boolean).slice(0,30);
    setSymbols(s);
  };

  const isLive   = status==="live";
  const dotCol   = {disconnected:C.textFar,connecting:"#f59e0b",auth:"#f59e0b",live:C.green,error:C.red}[status]||C.textFar;
  const statusLbl= {disconnected:"OFFLINE",connecting:"CONNECTING",auth:"AUTHENTICATING",live:"LIVE",error:"ERROR"}[status];

  const toggleSort = (k) => { if(sortKey===k) setSortDir(d=>-d); else {setSortKey(k);setSortDir(1);} };
  const SortBtn = ({k,label}) => (
    <button onClick={()=>toggleSort(k)} style={{...thS,color:sortKey===k?C.green:C.textMid}}>
      {label}{sortKey===k?(sortDir===1?"▲":"▼"):""}
    </button>
  );

  const rows = symbols
    .filter(s=>!filter||s.includes(filter.toUpperCase()))
    .map(s=>({symbol:s,...(ticks[s]||{}),spark:midHist[s]||[]}))
    .sort((a,b)=>{
      const av=a[sortKey],bv=b[sortKey];
      if(av==null&&bv==null) return 0;
      if(av==null) return 1; if(bv==null) return -1;
      if(typeof av==="string") return av.localeCompare(bv)*sortDir;
      return (av-bv)*sortDir;
    });

  const upCnt   = Object.values(ticks).filter(d=>d.dir==="up").length;
  const downCnt = Object.values(ticks).filter(d=>d.dir==="down").length;
  const COLS=[["symbol","SYM"],["mid","MID"],["bp","BID"],["bs","BSZ"],["ap","ASK"],["as","ASZ"],["spread","SPRD"],["lastPrice","LAST"],["barVW","VWAP"],["barV","VOL"]];

  return (
    <div style={{fontFamily:"monospace",background:C.bg,height:"100vh",color:C.textDim,display:"flex",flexDirection:"column",fontSize:12,overflow:"hidden"}}>

      {/* Header */}
      <div style={{background:C.bgPanel,borderBottom:"1px solid "+C.border,padding:"8px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",flexShrink:0}}>
        <span style={{fontSize:14,fontWeight:700,color:C.green,letterSpacing:"0.15em"}}>ARIA · EQUITIES</span>
        <span style={{fontSize:9,color:C.textFar,letterSpacing:"0.1em"}}>ALPACA IEX STREAM</span>
        {isLive && (
          <span style={{fontSize:10,color:C.textMid}}>
            <span style={{color:C.green}}>▲{upCnt}</span>{" / "}<span style={{color:C.red}}>▼{downCnt}</span>
          </span>
        )}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:dotCol,boxShadow:"0 0 8px "+dotCol}}/>
          <span style={{fontSize:10,color:dotCol,letterSpacing:"0.1em"}}>{statusLbl}</span>
          {statusMsg && <span style={{fontSize:10,color:C.red}}> · {statusMsg}</span>}
        </div>
      </div>

      {/* Config */}
      <div style={{background:C.bgPanel,borderBottom:"1px solid "+C.border,padding:"7px 16px",display:"flex",gap:7,flexWrap:"wrap",alignItems:"center",flexShrink:0}}>
        <input style={{...iStyle,width:155}} placeholder="API KEY ID"    value={apiKey}    onChange={e=>setApiKey(e.target.value)}    type="password" spellCheck={false}/>
        <input style={{...iStyle,width:155}} placeholder="SECRET KEY"    value={apiSecret} onChange={e=>setApiSecret(e.target.value)} type="password" spellCheck={false}/>
        <div style={{width:1,height:20,background:C.border}}/>
        <input style={{...iStyle,width:280}} placeholder="SYMBOLS comma-separated (max 30)" value={symInput} onChange={e=>setSymInput(e.target.value)}/>
        <button style={bStyle} onClick={applySymbols}>APPLY</button>
        <div style={{width:1,height:20,background:C.border}}/>
        {!isLive
          ? <button style={bStyle} onClick={connect} disabled={status==="connecting"||status==="auth"}>
              {(status==="connecting"||status==="auth")?"CONNECTING...":"▶ CONNECT"}
            </button>
          : <button style={bDStyle} onClick={disconnect}>■ DISCONNECT</button>
        }
        <button style={{...bStyle,marginLeft:"auto",fontSize:10,padding:"5px 10px"}} onClick={()=>setShowChart(v=>!v)}>
          {showChart?"HIDE CHART":"SHOW CHART"}
        </button>
        <input style={{...iStyle,width:88}} placeholder="FILTER..." value={filter} onChange={e=>setFilter(e.target.value)}/>
      </div>

      {/* Notice */}
      {!isLive && (
        <div style={{padding:"4px 16px",background:"#040a06",borderBottom:"1px solid #0a1e0d",fontSize:9,color:C.textFar,flexShrink:0}}>
          FREE PLAN: IEX feed · 30-symbol limit · 1 connection · alpaca.markets · Market hours 9:30–16:00 ET
        </div>
      )}

      {/* Body */}
      <div style={{display:"flex",flex:1,overflow:"hidden",minHeight:0}}>

        {/* Ticker table */}
        <div style={{flex:1,overflowY:"auto",overflowX:"auto",minWidth:0}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:600}}>
            <thead>
              <tr style={{borderBottom:"1px solid "+C.border,position:"sticky",top:0,background:C.bg,zIndex:2}}>
                {COLS.map(([k,l])=>(
                  <th key={k} style={{padding:"6px 8px",textAlign:k==="symbol"?"left":"right",fontWeight:"normal",whiteSpace:"nowrap"}}>
                    <SortBtn k={k} label={l}/>
                  </th>
                ))}
                <th style={{padding:"6px 8px",textAlign:"center",color:C.textFar,fontSize:10,fontWeight:"normal"}}>TRD</th>
                <th style={{padding:"6px 8px",textAlign:"right",color:C.textFar,fontSize:10,fontWeight:"normal"}}>TIME</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const fl=flash[r.symbol];
                const tc=r.dir==="up"?C.green:r.dir==="down"?C.red:C.textMid;
                const sc=(r.spark.length>1&&r.spark[r.spark.length-1]>=r.spark[0])?C.green:C.red;
                const rb=fl==="up"?"rgba(0,255,136,0.08)":fl==="down"?"rgba(255,68,102,0.08)":"transparent";
                const sel=chartSym===r.symbol;
                return (
                  <tr key={r.symbol} onClick={()=>{setChartSym(r.symbol);setShowChart(true);}}
                    style={{borderBottom:"1px solid "+C.border2,background:sel?"#061a0c":rb,cursor:"pointer",transition:"background 0.4s"}}>
                    <td style={{padding:"7px 8px",textAlign:"left"}}>
                      <span style={{fontWeight:700,fontSize:12,color:sel?C.green:C.text,letterSpacing:"0.05em"}}>{r.symbol}</span>
                    </td>
                    <td style={{padding:"7px 8px",textAlign:"right"}}>
                      <span style={{fontSize:12,color:tc,fontWeight:500}}>{r.mid!=null?fmt(r.mid):<span style={{color:C.textMin}}>—</span>}</span>
                    </td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.green2,fontSize:11}}>{fmt(r.bp)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.green4,fontSize:10}}>{r.bs!=null?r.bs:"—"}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.red2,  fontSize:11}}>{fmt(r.ap)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.red3,  fontSize:10}}>{r.as!=null?r.as:"—"}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.green3,fontSize:10}}>{r.spread!=null?fmt(r.spread,3):"—"}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.textDim,fontSize:11}}>{fmt(r.lastPrice)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.textMid,fontSize:10}}>{fmt(r.barVW)}</td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.textFar,fontSize:10}}>{r.barV!=null?Number(r.barV).toLocaleString():"—"}</td>
                    <td style={{padding:"7px 8px",textAlign:"center"}}><Spark points={r.spark} color={sc}/></td>
                    <td style={{padding:"7px 8px",textAlign:"right",color:C.textMin,fontSize:9}}>{fmtT(r.qt||r.tt)}</td>
                  </tr>
                );
              })}
              {rows.length===0&&(
                <tr><td colSpan={12} style={{padding:"48px 0",textAlign:"center",color:C.textMin,fontSize:11,letterSpacing:"0.1em"}}>
                  {isLive?"NO SYMBOLS MATCH FILTER":"ENTER CREDENTIALS AND CONNECT"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Chart */}
        {showChart && (
          <div style={{width:400,borderLeft:"1px solid "+C.border,flexShrink:0,display:"flex",flexDirection:"column"}}>
            <CandleChart symbol={chartSym} bars={barHist[chartSym]||[]}/>
          </div>
        )}

        {/* Blotter */}
        <div style={{width:180,borderLeft:"1px solid "+C.border,background:C.bg,display:"flex",flexDirection:"column",flexShrink:0}}>
          <div style={{padding:"6px 10px",borderBottom:"1px solid "+C.border,fontSize:9,color:C.textFar,letterSpacing:"0.12em",fontWeight:600}}>TRADE BLOTTER</div>
          <div style={{flex:1,overflowY:"auto"}}>
            {trades.length===0
              ? <div style={{padding:"20px 10px",fontSize:10,color:C.textMin,textAlign:"center"}}>AWAITING TRADES</div>
              : trades.map((t,i)=>(
                  <div key={i} style={{padding:"4px 8px",borderBottom:"1px solid "+C.border2,display:"flex",justifyContent:"space-between",alignItems:"center",gap:3}}>
                    <span style={{fontSize:10,color:C.text,fontWeight:600,minWidth:34}}>{t.sym}</span>
                    <span style={{fontSize:10,color:C.green2}}>{fmt(t.price)}</span>
                    <span style={{fontSize:9,color:C.textFar}}>{t.size}</span>
                    <span style={{fontSize:9,color:C.textMin}}>{fmtT(t.time)}</span>
                  </div>
                ))
            }
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{borderTop:"1px solid "+C.border,padding:"4px 16px",display:"flex",justifyContent:"space-between",gap:4,flexShrink:0}}>
        <span style={{fontSize:9,color:C.textMin}}>{rows.length} SYMBOLS · IEX L1 · CLICK ROW TO CHART · NOT FOR TRADING</span>
        <span style={{fontSize:9,color:C.textMin}}>ARIA TERMINAL · EQUITIES</span>
      </div>
    </div>
  );
}
