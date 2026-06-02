# aria-equities
equity screen using Alpaca Markets

Deploy to Railway via GitHub
	1.	Push this repo to GitHub
	2.	Go to railway.app → New Project → Deploy from GitHub repo
	3.	Select this repo — Railway auto-detects railway.json
	4.	Deploy — no env vars needed (Alpaca keys are entered in the UI at runtime)
Stack
	•	React 18 + Vite 5
	•	Express (serves dist/ in production)
	•	Alpaca IEX WebSocket — free plan
	•	Canvas 2D candlestick renderer (no external chart libs)
Notes
	•	Alpaca IEX free plan: 30 symbols max, 1 concurrent connection
	•	Data streams during US market hours only (9:30–16:00 ET Mon–Fri)
	•	API keys are entered in the browser UI — never stored server-side