import type { GraphEdge, LayoutNode } from './types'

type OrganicParticle = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  width: number
  height: number
  pinned: boolean
}

type OrganicLink = {
  source: number
  target: number
  length: number
}

export type OrganicLayoutState = {
  particles: OrganicParticle[]
  links: OrganicLink[]
  center: { x: number; y: number }
}

const clampMagnitude = (value: number, limit: number): number =>
  Math.max(-limit, Math.min(limit, value))

const deterministicDirection = (a: string, b: string): { x: number; y: number } => {
  let hash = 2166136261
  for (const character of `${a}:${b}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  const angle = ((hash >>> 0) / 0xffffffff) * Math.PI * 2
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

const preferredLinkLength = (source: OrganicParticle, target: OrganicParticle): number =>
  Math.hypot(source.width, source.height) / 2 + Math.hypot(target.width, target.height) / 2 + 72

export const createOrganicLayoutState = (
  nodes: LayoutNode[],
  edges: Array<Pick<GraphEdge, 'source' | 'target'>>,
): OrganicLayoutState => {
  const particles = nodes.map((node) => ({
    id: node.id,
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
    vx: 0,
    vy: 0,
    width: node.width,
    height: node.height,
    pinned: false,
  }))
  const indexById = new Map(particles.map((particle, index) => [particle.id, index]))
  const links = edges.flatMap((edge) => {
    const source = indexById.get(edge.source)
    const target = indexById.get(edge.target)
    if (source === undefined || target === undefined) return []
    return [{ source, target, length: preferredLinkLength(particles[source]!, particles[target]!) }]
  })
  const center =
    particles.length === 0
      ? { x: 0, y: 0 }
      : {
          x: particles.reduce((sum, particle) => sum + particle.x, 0) / particles.length,
          y: particles.reduce((sum, particle) => sum + particle.y, 0) / particles.length,
        }
  return { particles, links, center }
}

const applyPairForces = (
  state: OrganicLayoutState,
  forces: Array<{ x: number; y: number }>,
): void => {
  const particles = state.particles
  for (let first = 0; first < particles.length; first += 1) {
    const a = particles[first]!
    for (let second = first + 1; second < particles.length; second += 1) {
      const b = particles[second]!
      let dx = b.x - a.x
      let dy = b.y - a.y
      if (Math.abs(dx) + Math.abs(dy) < 0.001) {
        const direction = deterministicDirection(a.id, b.id)
        dx = direction.x
        dy = direction.y
      }
      const distance = Math.max(1, Math.hypot(dx, dy))
      const unitX = dx / distance
      const unitY = dy / distance
      const repulsion = Math.min(5, 120_000 / (distance * distance + 400))
      forces[first]!.x -= unitX * repulsion
      forces[first]!.y -= unitY * repulsion
      forces[second]!.x += unitX * repulsion
      forces[second]!.y += unitY * repulsion

      const overlapX = (a.width + b.width) / 2 + 18 - Math.abs(dx)
      const overlapY = (a.height + b.height) / 2 + 18 - Math.abs(dy)
      if (overlapX <= 0 || overlapY <= 0) continue
      if (overlapX / Math.max(1, a.width + b.width) < overlapY / Math.max(1, a.height + b.height)) {
        const push = overlapX * 0.09 + 0.8
        const sign = dx >= 0 ? 1 : -1
        forces[first]!.x -= sign * push
        forces[second]!.x += sign * push
      } else {
        const push = overlapY * 0.09 + 0.8
        const sign = dy >= 0 ? 1 : -1
        forces[first]!.y -= sign * push
        forces[second]!.y += sign * push
      }
    }
  }
}

const applyLinkForces = (
  state: OrganicLayoutState,
  forces: Array<{ x: number; y: number }>,
): void => {
  for (const link of state.links) {
    const source = state.particles[link.source]!
    const target = state.particles[link.target]!
    const dx = target.x - source.x
    const dy = target.y - source.y
    const distance = Math.max(1, Math.hypot(dx, dy))
    const spring = clampMagnitude((distance - link.length) * 0.012, 5)
    const forceX = (dx / distance) * spring
    const forceY = (dy / distance) * spring
    forces[link.source]!.x += forceX
    forces[link.source]!.y += forceY
    forces[link.target]!.x -= forceX
    forces[link.target]!.y -= forceY
  }
}

export const stepOrganicLayout = (state: OrganicLayoutState, iterations = 1): number => {
  let maximumSpeed = 0
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const forces = state.particles.map(() => ({ x: 0, y: 0 }))
    applyPairForces(state, forces)
    applyLinkForces(state, forces)
    maximumSpeed = 0
    state.particles.forEach((particle, index) => {
      if (particle.pinned) {
        particle.vx = 0
        particle.vy = 0
        return
      }
      const centerForceX = (state.center.x - particle.x) * 0.0015
      const centerForceY = (state.center.y - particle.y) * 0.0015
      particle.vx = clampMagnitude((particle.vx + forces[index]!.x + centerForceX) * 0.82, 18)
      particle.vy = clampMagnitude((particle.vy + forces[index]!.y + centerForceY) * 0.82, 18)
      particle.x += particle.vx
      particle.y += particle.vy
      maximumSpeed = Math.max(maximumSpeed, Math.hypot(particle.vx, particle.vy))
    })
  }
  return maximumSpeed
}

export const moveOrganicNode = (
  state: OrganicLayoutState,
  id: string,
  center: { x: number; y: number },
): void => {
  const particle = state.particles.find((candidate) => candidate.id === id)
  if (!particle) return
  particle.x = center.x
  particle.y = center.y
  particle.vx = 0
  particle.vy = 0
  particle.pinned = true
}

export const releaseOrganicNode = (state: OrganicLayoutState, id: string): void => {
  const particle = state.particles.find((candidate) => candidate.id === id)
  if (particle) particle.pinned = false
}

export const applyOrganicLayout = (state: OrganicLayoutState, nodes: LayoutNode[]): void => {
  const particleById = new Map(state.particles.map((particle) => [particle.id, particle]))
  nodes.forEach((node) => {
    const particle = particleById.get(node.id)
    if (!particle) return
    node.x = particle.x - node.width / 2
    node.y = particle.y - node.height / 2
  })
}
