import { clamp } from './graphUtils'

type Point = { x: number; y: number }

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y)

const movePoint = (from: Point, to: Point, amount: number): Point => {
  const d = distance(from, to)
  if (d <= 0.0001) return { ...from }
  const t = clamp(amount / d, 0, 1)
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  }
}

export const roundedPolylinePath = (points: Point[], radius: number): string => {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`
  if (radius <= 0) {
    return points
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ')
      .trim()
  }

  let d = `M ${points[0]!.x} ${points[0]!.y}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]!
    const curr = points[i]!
    const next = points[i + 1]!
    const inLen = distance(prev, curr)
    const outLen = distance(curr, next)
    const cornerRadius = Math.min(radius, inLen / 2, outLen / 2)

    if (cornerRadius <= 0.0001) {
      d += ` L ${curr.x} ${curr.y}`
      continue
    }

    const start = movePoint(curr, prev, cornerRadius)
    const end = movePoint(curr, next, cornerRadius)
    d += ` L ${start.x} ${start.y}`
    d += ` Q ${curr.x} ${curr.y} ${end.x} ${end.y}`
  }

  const last = points[points.length - 1]!
  d += ` L ${last.x} ${last.y}`
  return d
}
