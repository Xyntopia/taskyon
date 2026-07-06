import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_LIBRARY_ALGORITHM,
  createSpaceshipScene,
  renderSpaceshipSvg,
} from './proceduralSpaceship.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outputDir = join(__dirname, '..', '.tmp', 'spaceship-identicons')

const seeds = Array.from({ length: 36 }, (_, index) => createSeed(index))
const profiles = [
  {
    id: 'scored',
    label: 'scored',
    symmetry: true,
    stages: withSelectionForAllStages(DEFAULT_LIBRARY_ALGORITHM.stages, 'scored'),
  },
  {
    id: 'weighted',
    label: 'weighted',
    symmetry: false,
    stages: withSelectionForAllStages(DEFAULT_LIBRARY_ALGORITHM.stages, 'weighted'),
  },
  {
    id: 'random',
    label: 'random',
    symmetry: false,
    stages: withSelectionForAllStages(DEFAULT_LIBRARY_ALGORITHM.stages, 'random'),
  },
]
const columns = 6
const cardWidth = 252
const cardHeight = 220
const padding = 18
const entries = seeds.map((seed, index) => ({
  seed,
  profile: profiles[index % profiles.length],
  index,
}))
const width = columns * cardWidth + (columns + 1) * padding
const rows = Math.ceil(entries.length / columns)
const height = rows * cardHeight + (rows + 1) * padding

mkdirSync(outputDir, { recursive: true })

const cards = entries
  .map(({ seed, profile, index }) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = padding + column * (cardWidth + padding)
    const y = padding + row * (cardHeight + padding)
    const scene = createSpaceshipScene(seed, {
      symmetry: profile.symmetry,
      stages: profile.stages,
    })
    const shipSvg = renderSpaceshipSvg(seed, {
      size: 148,
      showBackground: false,
      showStars: false,
      symmetry: profile.symmetry,
      stages: profile.stages,
    })
    const categorySummary = summarizeCategories(scene)
    const shipOnlySvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
        <rect width="220" height="220" fill="#edf4fb"/>
        <svg x="36" y="36" width="148" height="148" viewBox="0 0 160 160">
          ${shipSvg.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}
        </svg>
      </svg>
    `
    writeFileSync(join(outputDir, `ship-${String(index).padStart(3, '0')}-${profile.id}.svg`), shipOnlySvg)

    return `
      <g transform="translate(${x} ${y})">
        <rect width="${cardWidth}" height="${cardHeight}" rx="18" fill="rgba(255,255,255,0.96)" stroke="rgba(130,153,173,0.32)" />
        <text x="18" y="28" font-size="11" font-family="monospace" fill="#6a7a8a">mode: ${escapeXml(profile.label)} / ${scene.summary.symmetryLabel}</text>
        <svg x="18" y="26" width="148" height="148" viewBox="0 0 160 160">
          ${shipSvg.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}
        </svg>
        <text x="176" y="76" font-size="11" font-family="monospace" fill="#203245">${escapeXml(seed)}</text>
        <text x="176" y="96" font-size="11" font-family="monospace" fill="#6a7a8a">modules ${escapeXml(scene.summary.moduleCountLabel)}</text>
        <text x="176" y="116" font-size="11" font-family="monospace" fill="#6a7a8a">cat ${escapeXml(categorySummary)}</text>
        <text x="176" y="136" font-size="11" font-family="monospace" fill="#6a7a8a">bounds ${escapeXml(formatBounds(scene.stats.occupiedBounds))}</text>
      </g>
    `
  })
  .join('\n')

const sheetSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#edf4fb" />
    ${cards}
  </svg>
`

const svgPath = join(outputDir, 'contact-sheet.svg')
const pngPath = join(outputDir, 'contact-sheet.png')

writeFileSync(svgPath, sheetSvg)

try {
  execFileSync('rsvg-convert', ['-o', pngPath, svgPath], { stdio: 'inherit' })
} catch (error) {
  console.warn('PNG conversion failed, SVG output still written.', error)
}

console.log(`Wrote ${svgPath}`)
console.log(`Wrote ${pngPath}`)

function createSeed(index) {
  const silhouettes = ['dart', 'freighter', 'scout', 'shuttle', 'cruiser', 'orbiter', 'manta']
  const moods = ['nova', 'ember', 'ice', 'neon', 'jade', 'amber', 'obsidian']
  const extras = ['antenna', 'ion', 'solar', 'laser', 'apollo', 'trek', 'echo']
  return `ident-${String(index).padStart(3, '0')}-${moods[index % moods.length]}-${silhouettes[(index * 3) % silhouettes.length]}-${extras[(index * 5) % extras.length]}`
}

function withSelectionForAllStages(stages, selection) {
  const out = {}
  for (const [stage, config] of Object.entries(stages ?? {})) {
    if (!config || typeof config !== 'object') continue
    if (!('categories' in config)) continue
    out[stage] = {
      ...config,
      selection,
    }
  }
  return out
}

function summarizeCategories(scene) {
  const counts = new Map()
  for (const placement of scene.placements ?? []) {
    const category = `${placement.tile?.category ?? 'unknown'}`
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => `${category}:${count}`)
    .join(' ')
}

function formatBounds(bounds) {
  if (!bounds) return 'none'
  return `${bounds.minX},${bounds.minY} -> ${bounds.maxX},${bounds.maxY}`
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
