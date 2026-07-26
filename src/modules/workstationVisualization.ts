export const workstationVisualizationHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #1d2433;
      background: #f7f8fc;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background:
      radial-gradient(circle at 12% 18%, rgba(124,77,255,.16), transparent 38%),
      radial-gradient(circle at 88% 82%, rgba(38,198,218,.12), transparent 42%),
      #f7f8fc; }
    #app { min-height: 100vh; padding: 18px; display: grid; place-items: center; }
    .loading { color: #70778a; font-size: 13px; }
    .design { width: 100%; max-width: 760px; display: grid; grid-template-columns: minmax(150px,.8fr) minmax(210px,1.35fr); gap: 18px; }
    .machine {
      position: relative; min-height: 260px; overflow: hidden;
      border: 1px solid rgba(124,77,255,.24); border-radius: 20px;
      background: linear-gradient(145deg,#24283a,#11131d);
      box-shadow: 0 18px 40px rgba(31,24,73,.2);
    }
    .machine:before { content: ""; position: absolute; inset: 12px; border: 1px solid rgba(255,255,255,.09); border-radius: 14px; }
    .glow { position: absolute; width: 150px; height: 150px; left: -45px; top: 28px; border-radius: 50%; background: #7c4dff; filter: blur(55px); opacity: .42; }
    .fan { position: absolute; width: 74px; height: 74px; left: 26px; border: 9px solid #30364d; border-radius: 50%; box-shadow: inset 0 0 0 3px #9b7cff, 0 0 18px rgba(124,77,255,.38); }
    .fan.one { top: 32px; } .fan.two { top: 122px; }
    .fan:before,.fan:after { content:""; position:absolute; inset:15px; border-radius:50%; border:3px solid rgba(255,255,255,.18); transform:skew(22deg); }
    .fan:after { transform:skew(-22deg) rotate(55deg); }
    .gpu {
      position: absolute; height: 74px; left: 118px; right: 22px; top: 92px;
      border: 1px solid #616b8f; border-radius: 8px;
      background: linear-gradient(130deg,#30354a,#1d2130);
      box-shadow: 0 10px 20px rgba(0,0,0,.35);
    }
    .gpu:after { content:""; position:absolute; left:14px; right:14px; bottom:12px; height:4px; border-radius:3px; background:linear-gradient(90deg,#7c4dff,#26c6da); box-shadow:0 0 12px #7c4dff; }
    .gpu-label { position:absolute; left:14px; right:8px; top:14px; color:white; font-size:12px; font-weight:700; letter-spacing:.02em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ports { position:absolute; left:122px; right:26px; top:186px; display:flex; gap:6px; }
    .ports i { display:block; height:24px; flex:1; border-radius:4px; background:#282d40; border:1px solid #444c68; }
    .specs { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
    .eyebrow { color:#7c4dff; font-size:11px; font-weight:800; letter-spacing:.13em; text-transform:uppercase; }
    h1 { margin:3px 0 0; font-size:clamp(20px,4vw,31px); line-height:1.08; letter-spacing:-.035em; }
    .sub { margin:5px 0 0; color:#70778a; font-size:12px; }
    .metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
    .metric { padding:10px; border:1px solid #e1e4ee; border-radius:11px; background:rgba(255,255,255,.78); }
    .metric strong { display:block; font-size:17px; color:#252a3a; }
    .metric span { font-size:10px; color:#7d8495; text-transform:uppercase; letter-spacing:.05em; }
    .fit { padding:10px 12px; border-radius:11px; display:flex; align-items:center; gap:9px; color:#14633c; background:#e8f8ef; font-size:12px; font-weight:650; }
    .fit.fail { color:#8b2635; background:#fdecef; }
    .fit:before { content:"✓"; display:grid; place-items:center; width:20px; height:20px; border-radius:50%; color:white; background:#22a865; }
    .ranking { display:flex; flex-direction:column; gap:6px; }
    .rank { display:grid; grid-template-columns:minmax(90px,1.2fr) 2fr auto; align-items:center; gap:8px; font-size:10px; color:#626a7c; }
    .rank-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .bar { height:5px; overflow:hidden; border-radius:5px; background:#e3e5ec; }
    .bar i { display:block; height:100%; border-radius:5px; background:linear-gradient(90deg,#7c4dff,#26c6da); }
    .score { min-width:30px; text-align:right; font-variant-numeric:tabular-nums; }
    @media (max-width:540px) {
      #app { padding:12px; }
      .design { grid-template-columns:1fr; }
      .machine { min-height:190px; }
      .fan { width:52px;height:52px;left:20px;border-width:6px; }
      .fan.one { top:25px } .fan.two { top:91px }
      .gpu { left:90px;top:58px;right:18px; }
      .ports { left:94px;top:143px; }
    }
  </style>
</head>
<body>
  <main id="app"><div class="loading">Waiting for the evaluated design…</div></main>
  <script>
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character])
    const number = (value, digits = 0) => Number(value ?? 0).toFixed(digits)
    const render = (value) => {
      const recommendation = value?.recommendation ?? {}
      const constraints = Array.isArray(value?.constraints) ? value.constraints : []
      const rows = constraints.map(item => \`
        <div class="rank">
          <span class="rank-name">\${escapeHtml(item.label)}</span>
          <span class="bar"><i style="width:\${item.status === 'pass' ? 100 : item.status === 'warning' ? 55 : 12}%"></i></span>
          <span class="score">\${escapeHtml(item.status)}</span>
        </div>\`).join('')
      document.querySelector('#app').innerHTML = \`
        <section class="design">
          <div class="machine" aria-label="Generated AI workstation">
            <div class="glow"></div><div class="fan one"></div><div class="fan two"></div>
            <div class="gpu"><span class="gpu-label">\${escapeHtml(recommendation.gpu)}</span></div>
            <div class="ports"><i></i><i></i><i></i><i></i></div>
          </div>
          <div class="specs">
            <header><div class="eyebrow">Evaluated design · revision-owned candidate</div>
              <h1>\${escapeHtml(recommendation.configuration)}</h1>
              <p class="sub">\${escapeHtml(value?.modelEstimate?.model)} · \${escapeHtml(value?.modelEstimate?.quantization)} · \${number(value?.modelEstimate?.contextTokens)} tokens</p>
            </header>
            <div class="metrics">
              <div class="metric"><strong>\${number(recommendation.usableVramGb)} GB</strong><span>Usable memory</span></div>
              <div class="metric"><strong>$\${number(recommendation.estimatedPriceUsd)}</strong><span>System estimate</span></div>
              <div class="metric"><strong>\${number(recommendation.estimatedSystemPowerW)} W</strong><span>System</span></div>
            </div>
            <div class="fit \${recommendation.viable ? '' : 'fail'}">\${recommendation.viable ? 'Feasible for this workload and requirements' : 'Rejected by one or more hard constraints'}</div>
            <div class="ranking">\${rows}</div>
          </div>
        </section>\`
    }
    connectDesignRenderer(render)
  </script>
</body>
</html>`
