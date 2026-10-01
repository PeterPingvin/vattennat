import type { Edge, Node } from '@xyflow/react'

export type HydraulicComponentType = 'pipe'|'elbow'|'tee'|'cross'|'inlet'|'meter'|'leak'|'open'

export type HydraulicData = {
  label: string
  component: HydraulicComponentType
  size?: string
  length?: number
  pressure?: number
  monthlyVolumeM3?: number
  template?: string
  portSizes?: { left?: string; right?: string; top?: string; bottom?: string }
  leakFlowLs?: number
}

export type HydraulicRowInput = {
  meterVolumes: Record<string, number>
  leakVolumes: Record<string, number>
  inletPressureBar: number
}

export type HydraulicResult = {
  meterPressures: Record<string, number>
  nodePressures: Record<string, number>
  componentFlowsM3h: Record<string, number>
  warnings: string[]
}

const G = 9.80665
const BAR_PER_M_HEAD = 0.0980665
const HW_C_PLASTIC = 150
const DN_M: Record<string, number> = {
  DN25: 0.025, DN32: 0.032, DN40: 0.040, DN50: 0.050, DN63: 0.063,
  DN75: 0.075, DN90: 0.090, DN110: 0.110, DN160: 0.160, DN200: 0.200,
}

function diameterM(size?: string) {
  return DN_M[size ?? 'DN63'] ?? 0.063
}

function velocity(flowM3h: number, diameter: number) {
  if (flowM3h <= 0 || diameter <= 0) return 0
  const q = flowM3h / 3600
  return q / (Math.PI * diameter * diameter / 4)
}

function hazenWilliamsHeadLoss(flowM3h: number, diameter: number, lengthM: number) {
  if (flowM3h <= 0 || diameter <= 0 || lengthM <= 0) return 0
  const q = flowM3h / 3600
  return 10.67 * lengthM * Math.pow(q, 1.852) / (Math.pow(HW_C_PLASTIC, 1.852) * Math.pow(diameter, 4.871))
}

function minorHeadLoss(k: number, flowM3h: number, diameter: number) {
  const v = velocity(flowM3h, diameter)
  return k * v * v / (2 * G)
}

function directSizeChangeHeadLoss(upstreamDiameter: number, downstreamDiameter: number, flowM3h: number) {
  if (!upstreamDiameter || !downstreamDiameter || Math.abs(upstreamDiameter - downstreamDiameter) < 1e-9 || flowM3h <= 0) return 0
  if (downstreamDiameter > upstreamDiameter) {
    const k = Math.pow(1 - Math.pow(upstreamDiameter / downstreamDiameter, 2), 2)
    return minorHeadLoss(k, flowM3h, upstreamDiameter)
  }
  const beta = downstreamDiameter / upstreamDiameter
  const k = 0.5 * (1 - beta * beta)
  return minorHeadLoss(k, flowM3h, downstreamDiameter)
}

function directionPort(node: Node<HydraulicData>, other: Node<HydraulicData>, explicit?: string | null) {
  if (explicit) return explicit.replace(/-(source|target)$/, '')
  const dx = other.position.x - node.position.x
  const dy = other.position.y - node.position.y
  if (node.data.component === 'inlet') return 'right'
  if (node.data.component === 'meter' || node.data.component === 'leak' || node.data.component === 'open') return 'left'
  if (node.data.component === 'pipe' || node.data.component === 'elbow') return dx < 0 ? 'left' : 'right'
  const candidates = node.data.component === 'tee'
    ? {left:[-1,0], right:[1,0], bottom:[0,1]}
    : {left:[-1,0], right:[1,0], top:[0,-1], bottom:[0,1]}
  let best = Object.keys(candidates)[0]
  let bestScore = -Infinity
  for (const key of Object.keys(candidates)) {
    const [x,y] = (candidates as Record<string,number[]>)[key]
    const len = Math.hypot(dx,dy) || 1
    const score = (dx/len)*x + (dy/len)*y
    if (score > bestScore) { bestScore = score; best = key }
  }
  return best
}

function portDiameter(node: Node<HydraulicData>, port?: string) {
  const d = node.data
  if ((d.component === 'tee' || d.component === 'cross') && port) {
    return diameterM(d.portSizes?.[port as keyof NonNullable<typeof d.portSizes>] ?? d.size)
  }
  return diameterM(d.size)
}

function oppositePort(port: string) {
  if (port === 'left') return 'right'
  if (port === 'right') return 'left'
  if (port === 'top') return 'bottom'
  if (port === 'bottom') return 'top'
  return ''
}

export function calculateHydraulics(nodes: Node<HydraulicData>[], edges: Edge[], input: HydraulicRowInput): HydraulicResult {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const adjacency = new Map<string, { neighborId:string; ownPort:string; neighborPort:string }[]>()
  nodes.forEach(n => adjacency.set(n.id, []))

  for (const edge of edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) continue
    const sourcePort = directionPort(source, target, edge.sourceHandle)
    const targetPort = directionPort(target, source, edge.targetHandle)
    adjacency.get(source.id)?.push({neighborId:target.id, ownPort:sourcePort, neighborPort:targetPort})
    adjacency.get(target.id)?.push({neighborId:source.id, ownPort:targetPort, neighborPort:sourcePort})
  }

  const inlet = nodes.find(n => n.data.component === 'inlet')
  const meterPressures: Record<string,number> = {}
  const nodePressures: Record<string,number> = {}
  const componentFlowsM3h: Record<string,number> = {}
  const warnings: string[] = []
  if (!inlet) return {meterPressures,nodePressures,componentFlowsM3h,warnings:['Inget inlopp finns i nätet.']}

  const parent = new Map<string,string|null>()
  const parentConnection = new Map<string,{parentId:string; parentPort:string; childPort:string}>()
  const queue=[inlet.id]
  parent.set(inlet.id,null)
  while(queue.length) {
    const id=queue.shift()!
    for(const link of adjacency.get(id) ?? []) {
      if(parent.has(link.neighborId)) continue
      parent.set(link.neighborId,id)
      parentConnection.set(link.neighborId,{parentId:id,parentPort:link.ownPort,childPort:link.neighborPort})
      queue.push(link.neighborId)
    }
  }

  const disconnected = nodes.filter(n => n.data.component==='meter' && !parent.has(n.id))
  if(disconnected.length) warnings.push(`${disconnected.length} hushållsmätare saknar hydraulisk väg till inloppet.`)
  const cycles = edges.filter(e => parent.get(e.source) !== e.target && parent.get(e.target) !== e.source && parent.has(e.source) && parent.has(e.target))
  if(cycles.length) warnings.push('Nätet innehåller slingor. V1 använder en trädberäkning och löser ännu inte flödesfördelning i slutna slingor.')

  const children = new Map<string,string[]>()
  nodes.forEach(n=>children.set(n.id,[]))
  parent.forEach((p,id)=>{ if(p) children.get(p)?.push(id) })

  const demandMemo = new Map<string,number>()
  const demandStack = new Set<string>()
  const demandFor = (id:string):number => {
    if(demandMemo.has(id)) return demandMemo.get(id)!
    if(demandStack.has(id)) return 0
    demandStack.add(id)
    const node=byId.get(id)!
    let demand=0
    if(node.data.component==='meter') demand=Math.max(0,input.meterVolumes[id] ?? 0)
    else if(node.data.component==='leak') demand=Math.max(0,input.leakVolumes[id] ?? 0)
    else for(const child of children.get(id) ?? []) demand += demandFor(child)
    demandStack.delete(id)
    demandMemo.set(id,demand)
    return demand
  }
  nodes.forEach(n=>demandFor(n.id))

  const pressureQueue=[inlet.id]
  nodePressures[inlet.id]=Math.max(0,input.inletPressureBar)
  while(pressureQueue.length) {
    const parentId=pressureQueue.shift()!
    const parentNode=byId.get(parentId)!
    const parentFlow=demandMemo.get(parentId) ?? 0
    componentFlowsM3h[parentId]=Number(parentFlow.toFixed(6))

    for(const childId of children.get(parentId) ?? []) {
      const child=byId.get(childId)!
      const conn=parentConnection.get(childId)!
      const childFlow=demandMemo.get(childId) ?? 0
      let headLoss=0

      if(parentNode.data.component==='pipe') {
        headLoss += hazenWilliamsHeadLoss(parentFlow, diameterM(parentNode.data.size), Number(parentNode.data.length ?? 0))
      } else if(parentNode.data.component==='elbow') {
        headLoss += minorHeadLoss(0.9,parentFlow,diameterM(parentNode.data.size))
      } else if(parentNode.data.component==='tee' || parentNode.data.component==='cross') {
        const k=conn.childPort===oppositePort(conn.parentPort) ? 0.6 : 1.8
        headLoss += minorHeadLoss(k,childFlow,portDiameter(parentNode,conn.childPort))
      }

      if((parentNode.data.component==='pipe' || parentNode.data.component==='elbow') && (child.data.component==='pipe' || child.data.component==='elbow')) {
        headLoss += directSizeChangeHeadLoss(portDiameter(parentNode,conn.parentPort),portDiameter(child,conn.childPort),childFlow)
      }

      nodePressures[childId]=Math.max(-10,nodePressures[parentId]-headLoss*BAR_PER_M_HEAD)
      pressureQueue.push(childId)
    }
  }

  for(const meter of nodes.filter(n=>n.data.component==='meter')) {
    if(nodePressures[meter.id] !== undefined) meterPressures[meter.id]=Number(nodePressures[meter.id].toFixed(4))
  }
  return {meterPressures,nodePressures,componentFlowsM3h,warnings}
}
