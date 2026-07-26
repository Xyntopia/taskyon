import { canonicalHash, type Hash } from '@taskyon/comp-dag/caching'

export type BundledDesignExample = {
  projectId: string
  title: string
  message: string
  capacityLabel: string
  capacityUnit: string
  performanceLabel: string
  accent: string
  accent2: string
  visual: 'drone' | 'rover' | 'satellite' | 'battery'
}

const examples = [
  {
    projectId: 'mission-drone',
    title: 'Mission Drone',
    message: 'Bundled mission drone design example',
    capacityLabel: 'Endurance',
    capacityUnit: 'min',
    performanceLabel: 'Mission score',
    accent: '#7c4dff',
    accent2: '#26c6da',
    visual: 'drone',
  },
  {
    projectId: 'mars-rover',
    title: 'Autonomous Mars Rover',
    message: 'Bundled autonomous Mars rover design example',
    capacityLabel: 'Mission life',
    capacityUnit: 'days',
    performanceLabel: 'Science score',
    accent: '#ef6c00',
    accent2: '#ffca28',
    visual: 'rover',
  },
  {
    projectId: 'satellite',
    title: 'Mission Satellite',
    message: 'Bundled mission satellite design example',
    capacityLabel: 'Payload',
    capacityUnit: 'kg',
    performanceLabel: 'Mission score',
    accent: '#1565c0',
    accent2: '#80deea',
    visual: 'satellite',
  },
  {
    projectId: 'home-battery',
    title: 'Home Battery System',
    message: 'Bundled home battery system design example',
    capacityLabel: 'Usable energy',
    capacityUnit: 'kWh',
    performanceLabel: 'Energy score',
    accent: '#00897b',
    accent2: '#ffee58',
    visual: 'battery',
  },
] as const satisfies readonly BundledDesignExample[]

export const bundledDesignExamples = Object.fromEntries(
  examples.map((example) => [example.projectId, example]),
) as Record<string, BundledDesignExample>

const visualMarkup = (kind: BundledDesignExample['visual']) => {
  if (kind === 'drone') {
    return `<div class="drone craft"><i></i><i></i><i></i><i></i><b></b></div>`
  }
  if (kind === 'rover') {
    return `<div class="rover craft"><b></b><i></i><i></i><span></span></div>`
  }
  if (kind === 'satellite') {
    return `<div class="satellite craft"><i></i><b></b><i></i><span></span></div>`
  }
  return `<div class="battery craft"><b><i></i><i></i><i></i><i></i></b><span></span></div>`
}

export const bundledVisualizationHtml = (example: BundledDesignExample): string => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{font-family:Inter,ui-sans-serif,system-ui;color:#202536;background:#f7f8fc}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 15%,${example.accent}26,transparent 38%),radial-gradient(circle at 90% 85%,${example.accent2}22,transparent 42%),#f7f8fc}
#app{min-height:100vh;padding:18px;display:grid;place-items:center}.loading{color:#737b8f;font-size:13px}
.design{width:100%;max-width:760px;display:grid;grid-template-columns:minmax(155px,.85fr) minmax(210px,1.4fr);gap:18px}
.scene{position:relative;min-height:260px;overflow:hidden;border-radius:20px;background:linear-gradient(145deg,#272c40,#11141f);box-shadow:0 18px 38px #20243c33}
.scene:after{content:"";position:absolute;left:10%;right:10%;bottom:22px;height:2px;background:linear-gradient(90deg,transparent,${example.accent2},transparent);box-shadow:0 0 18px ${example.accent2}}
.orb{position:absolute;width:170px;height:170px;border-radius:50%;left:50%;top:50%;transform:translate(-50%,-50%);background:${example.accent};filter:blur(62px);opacity:.42}
.craft{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:${example.accent2}}
.drone{width:150px;height:72px}.drone b{position:absolute;left:52px;top:22px;width:46px;height:30px;border-radius:50% 50% 35% 35%;background:#e8ebf5}
.drone i{position:absolute;width:42px;height:42px;border:3px solid currentColor;border-radius:50%;box-shadow:0 0 14px currentColor}.drone i:nth-child(1){left:0}.drone i:nth-child(2){right:0}.drone i:nth-child(3){left:18px;top:38px}.drone i:nth-child(4){right:18px;top:38px}
.rover{width:150px;height:80px}.rover b{position:absolute;left:18px;right:18px;top:18px;height:42px;background:#e0e3ec;clip-path:polygon(15% 0,75% 0,100% 45%,92% 100%,0 100%,0 35%)}.rover i{position:absolute;bottom:0;width:38px;height:38px;border:8px solid #34394c;border-radius:50%;box-shadow:inset 0 0 0 3px ${example.accent2}}.rover i:nth-child(2){left:12px}.rover i:nth-child(3){right:12px}.rover span{position:absolute;left:68px;top:0;width:5px;height:24px;background:${example.accent2}}
.satellite{width:190px;height:80px;display:flex;align-items:center}.satellite i{width:65px;height:48px;border:2px solid ${example.accent2};background:repeating-linear-gradient(90deg,#1e5480 0 13px,#72d8e5 14px 15px)}.satellite b{width:58px;height:70px;border-radius:8px;background:linear-gradient(145deg,#f4f5f8,#aab2c6);box-shadow:0 0 18px ${example.accent}}.satellite span{position:absolute;width:48px;height:48px;border:3px solid ${example.accent2};border-radius:50%;right:70px;top:-20px;clip-path:inset(0 0 50% 0)}
.battery{width:132px;height:174px}.battery b{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:16px 14px;width:100%;height:150px;border:3px solid #c9d0dd;border-radius:14px;background:#252a3b}.battery i{border-radius:5px;background:linear-gradient(180deg,${example.accent2},${example.accent});box-shadow:0 0 12px ${example.accent}}.battery span{position:absolute;left:48px;top:-10px;width:36px;height:12px;border-radius:4px 4px 0 0;background:#c9d0dd}
.specs{min-width:0;display:flex;flex-direction:column;gap:12px}.eyebrow{color:${example.accent};font-size:11px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}
h1{margin:3px 0 0;font-size:clamp(20px,4vw,31px);line-height:1.08;letter-spacing:-.035em}.sub{margin:5px 0 0;color:#737b8f;font-size:12px}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.metric{padding:10px;border:1px solid #e0e3ec;border-radius:11px;background:#ffffffcc}.metric strong{display:block;font-size:17px}.metric span{font-size:10px;color:#7d8495;text-transform:uppercase}
.fit{padding:10px 12px;border-radius:11px;color:#14633c;background:#e8f8ef;font-size:12px;font-weight:650}.fit:before{content:"✓";display:inline-grid;place-items:center;width:20px;height:20px;margin-right:8px;border-radius:50%;color:white;background:#22a865}
.ranking{display:flex;flex-direction:column;gap:6px}.rank{display:grid;grid-template-columns:minmax(90px,1.2fr) 2fr auto;gap:8px;align-items:center;font-size:10px;color:#626a7c}.rank-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar{height:5px;border-radius:5px;background:#e3e5ec;overflow:hidden}.bar i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,${example.accent},${example.accent2})}
@media(max-width:540px){#app{padding:12px}.design{grid-template-columns:1fr}.scene{min-height:190px}}
</style></head><body><main id="app"><div class="loading">Waiting for the evaluated design…</div></main>
<script>
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const num=(value,digits=0)=>Number(value??0).toFixed(digits)
const render=value=>{const recommendation=value?.recommendation??{};const ranked=Array.isArray(value?.ranked)?value.ranked.slice(0,4):[];const max=Math.max(1,...ranked.map(item=>Math.max(0,Number(item.score)||0)));const rows=ranked.map(item=>\`<div class="rank"><span class="rank-name">\${esc(item.name)}</span><span class="bar"><i style="width:\${Math.max(2,Math.max(0,Number(item.score)||0)/max*100)}%"></i></span><span>\${num(item.score,1)}</span></div>\`).join('');document.querySelector('#app').innerHTML=\`<section class="design"><div class="scene"><div class="orb"></div>${visualMarkup(example.visual)}</div><div class="specs"><header><div class="eyebrow">Generated design · best viable candidate</div><h1>\${esc(recommendation.name)}</h1><p class="sub">\${esc(value?.viableCount)} viable configurations satisfy this revision.</p></header><div class="metrics"><div class="metric"><strong>\${num(recommendation.capacity,1)} ${example.capacityUnit}</strong><span>${example.capacityLabel}</span></div><div class="metric"><strong>$\${num(recommendation.costUsd)}</strong><span>Estimated cost</span></div><div class="metric"><strong>\${num(recommendation.performance)}</strong><span>${example.performanceLabel}</span></div></div><div class="fit">Fits capacity, mass, power, and budget constraints</div><div class="ranking">\${rows}</div></div></section>\`}
connectDesignRenderer(render)
</script></body></html>`

export const bundledVisualizationId = (example: BundledDesignExample, schemaId: Hash) => {
  const html = bundledVisualizationHtml(example)
  return { html, visualizationId: canonicalHash({ schemaId, html }) }
}
