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

const G=9.80665
const BAR_PER_M_HEAD=0.0980665
const HW_C=150
const DN_M:Record<string,number>={DN25:.025,DN32:.032,DN40:.04,DN50:.05,DN63:.063,DN75:.075,DN90:.09,DN110:.11,DN160:.16,DN200:.2}

type Conn={neighborId:string;ownPort:string;neighborPort:string;edgeId:string}
type Link={
  id:string;a:string;b:string;aPort:string;bPort:string
  segments:string[]
  pipes:{nodeId:string;length:number;diameter:number}[]
  elbows:{nodeId:string;diameter:number}[]
  aK:number;bK:number;aDiameter:number;bDiameter:number
}

const diameter=(size?:string)=>DN_M[size??'DN63']??.063
const velocity=(q:number,d:number)=>d>0?Math.abs(q)/3600/(Math.PI*d*d/4):0
const minor=(k:number,q:number,d:number)=>k*velocity(q,d)**2/(2*G)
const hw=(q:number,d:number,L:number)=>{
  if(q<=0||d<=0||L<=0)return 0
  const Q=q/3600
  return 10.67*L*Q**1.852/(HW_C**1.852*d**4.871)
}
const sizeK=(a:number,b:number)=>{
  if(!a||!b||Math.abs(a-b)<1e-9)return 0
  if(b>a)return (1-(a/b)**2)**2
  return .5*(1-(b/a)**2)
}
const opposite=(p:string)=>p==='left'?'right':p==='right'?'left':p==='top'?'bottom':p==='bottom'?'top':''
const anchor=(c:HydraulicComponentType)=>c==='inlet'||c==='tee'||c==='cross'||c==='meter'||c==='leak'

function port(node:Node<HydraulicData>,p?:string){
  if((node.data.component==='tee'||node.data.component==='cross')&&p)
    return diameter(node.data.portSizes?.[p as keyof NonNullable<typeof node.data.portSizes>]??node.data.size)
  return diameter(node.data.size)
}

function direction(node:Node<HydraulicData>,other:Node<HydraulicData>,explicit?:string|null){
  if(explicit)return explicit.replace(/-(source|target)$/,'')
  const dx=other.position.x-node.position.x,dy=other.position.y-node.position.y
  if(node.data.component==='inlet')return'right'
  if(node.data.component==='meter'||node.data.component==='leak'||node.data.component==='open')return'left'
  if(node.data.component==='pipe'||node.data.component==='elbow')return dx<0?'left':'right'
  const cs=node.data.component==='tee'?{left:[-1,0],right:[1,0],bottom:[0,1]}:{left:[-1,0],right:[1,0],top:[0,-1],bottom:[0,1]}
  let best=Object.keys(cs)[0],score=-Infinity,len=Math.hypot(dx,dy)||1
  for(const k of Object.keys(cs)){const [x,y]=(cs as Record<string,number[]>)[k];const s=dx/len*x+dy/len*y;if(s>score){score=s;best=k}}
  return best
}

function junctionK(node:Node<HydraulicData>,p:string,ports:string[]){
  if(node.data.component!=='tee'&&node.data.component!=='cross')return 0
  if(ports.length<=1)return 0
  return opposite(p)&&ports.includes(opposite(p)) ? 0.6 : 1.8
}

function makeGraph(nodes:Node<HydraulicData>[],edges:Edge[]){
  const byId=new Map(nodes.map(n=>[n.id,n]))
  const adj=new Map<string,Conn[]>()
  nodes.forEach(n=>adj.set(n.id,[]))
  for(const e of edges){
    const a=byId.get(e.source),b=byId.get(e.target);if(!a||!b)continue
    const ap=direction(a,b,e.sourceHandle),bp=direction(b,a,e.targetHandle)
    adj.get(a.id)!.push({neighborId:b.id,ownPort:ap,neighborPort:bp,edgeId:e.id})
    adj.get(b.id)!.push({neighborId:a.id,ownPort:bp,neighborPort:ap,edgeId:e.id})
  }
  return{byId,adj}
}

function buildLinks(nodes:Node<HydraulicData>[],adj:Map<string,Conn[]>,byId:Map<string,Node<HydraulicData>>,warnings:string[]){
  const links:Link[]=[]
  const used=new Set<string>()
  for(const start of nodes.filter(n=>anchor(n.data.component))){
    for(const first of adj.get(start.id)??[]){
      if(used.has(first.edgeId))continue
      let c=first,segments:string[]=[],pipes:Link['pipes']=[],elbows:Link['elbows']=[],seen=new Set<string>()
      while(true){
        if(seen.has(c.edgeId))break
        seen.add(c.edgeId);used.add(c.edgeId)
        const n=byId.get(c.neighborId);if(!n)break
        segments.push(n.id)
        if(anchor(n.data.component)){
          links.push({
            id:start.id+'__'+n.id+'__'+links.length,a:start.id,b:n.id,aPort:first.ownPort,bPort:c.neighborPort,
            segments,pipes,elbows,
            aK:junctionK(start,first.ownPort,(adj.get(start.id)??[]).map(x=>x.ownPort)),
            bK:junctionK(n,c.neighborPort,(adj.get(n.id)??[]).map(x=>x.ownPort)),
            aDiameter:port(start,first.ownPort),bDiameter:port(n,c.neighborPort)
          })
          break
        }
        if(n.data.component==='open')break
        if(n.data.component==='pipe')pipes.push({nodeId:n.id,length:Math.max(0,Number(n.data.length??0)),diameter:diameter(n.data.size)})
        else if(n.data.component==='elbow')elbows.push({nodeId:n.id,diameter:diameter(n.data.size)})
        const next=(adj.get(n.id)??[]).filter(x=>x.edgeId!==c.edgeId)
        if(next.length!==1){
          warnings.push(`${n.data.label||n.id} måste ha exakt två anslutningar för att fungera som ett genomgående rör/böj.`)
          break
        }
        c=next[0]
      }
    }
  }
  return links
}

function loss(q:number,l:Link){
  let h=0
  for(const p of l.pipes)h+=hw(q,p.diameter,p.length)
  for(const e of l.elbows)h+=minor(.9,q,e.diameter)
  h+=minor(l.aK,q,l.aDiameter)+minor(l.bK,q,l.bDiameter)
  const first=l.pipes[0]?.diameter??l.elbows[0]?.diameter
  const last=l.pipes[l.pipes.length-1]?.diameter??l.elbows[l.elbows.length-1]?.diameter
  if(first!==undefined&&Math.abs(first-l.aDiameter)>1e-9)h+=minor(sizeK(l.aDiameter,first),q,Math.min(l.aDiameter,first))
  if(last!==undefined&&Math.abs(last-l.bDiameter)>1e-9)h+=minor(sizeK(last,l.bDiameter),q,Math.min(last,l.bDiameter))
  let prev:number|undefined
  for(const p of l.pipes){
    if(prev!==undefined&&Math.abs(prev-p.diameter)>1e-9)h+=minor(sizeK(prev,p.diameter),q,Math.min(prev,p.diameter))
    prev=p.diameter
  }
  return h
}

function flowFromHead(delta:number,l:Link){
  if(Math.abs(delta)<1e-12)return 0
  const s=delta>=0?1:-1,target=Math.abs(delta)
  let lo=0,hi=Math.max(1,target*10)
  while(loss(hi,l)<target&&hi<1e7)hi*=2
  for(let i=0;i<60;i++){const m=(lo+hi)/2;if(loss(m,l)<target)lo=m;else hi=m}
  return s*(lo+hi)/2
}

function solveLinear(A:number[][],b:number[]){
  const n=b.length,M=A.map((r,i)=>[...r,b[i]])
  for(let k=0;k<n;k++){
    let p=k;for(let i=k+1;i<n;i++)if(Math.abs(M[i][k])>Math.abs(M[p][k]))p=i
    if(Math.abs(M[p][k])<1e-10)M[k][k]+=1e-8
    else{[M[k],M[p]]=[M[p],M[k]];for(let i=k+1;i<n;i++){const f=M[i][k]/M[k][k];for(let j=k;j<=n;j++)M[i][j]-=f*M[k][j]}}
  }
  const x=Array(n).fill(0)
  for(let i=n-1;i>=0;i--){let s=M[i][n];for(let j=i+1;j<n;j++)s-=M[i][j]*x[j];x[i]=s/(M[i][i]||1e-8)}
  return x
}

export function calculateHydraulics(nodes:Node<HydraulicData>[],edges:Edge[],input:HydraulicRowInput):HydraulicResult{
  const {byId,adj}=makeGraph(nodes,edges)
  const meterPressures:Record<string,number>={},nodePressures:Record<string,number>={},componentFlowsM3h:Record<string,number>={},warnings:string[]=[]
  const inlet=nodes.find(n=>n.data.component==='inlet')
  if(!inlet)return{meterPressures,nodePressures,componentFlowsM3h,warnings:['Inget inlopp finns i nätet.']}
  if(nodes.some(n=>n.data.component==='open'&&(adj.get(n.id)?.length??0)>0))warnings.push('Öppen markerar gränsen mot ett okänt område. Ingen hydraulik modelleras efter denna punkt.')
  const links=buildLinks(nodes,adj,byId,warnings)
  const linkAdj=new Map<string,Link[]>()
  for(const l of links){if(!linkAdj.has(l.a))linkAdj.set(l.a,[]);if(!linkAdj.has(l.b))linkAdj.set(l.b,[]);linkAdj.get(l.a)!.push(l);linkAdj.get(l.b)!.push(l)}
  const connected=new Set<string>([inlet.id]),qids=[inlet.id]
  while(qids.length){const id=qids.shift()!;for(const l of linkAdj.get(id)??[]){const o=l.a===id?l.b:l.a;if(!connected.has(o)){connected.add(o);qids.push(o)}}}
  for(const m of nodes.filter(n=>n.data.component==='meter'))if(!connected.has(m.id))warnings.push(`${m.data.label||m.id} saknar hydraulisk väg till inloppet.`)

  const anchors=nodes.filter(n=>anchor(n.data.component)&&connected.has(n.id))
  const unknown=anchors.filter(n=>n.id!==inlet.id)
  const demand=new Map<string,number>()
  for(const n of anchors)demand.set(n.id,n.data.component==='meter'?Math.max(0,input.meterVolumes[n.id]??0):n.data.component==='leak'?Math.max(0,input.leakVolumes[n.id]??0):0)

  const heads=new Map<string,number>()
  for(const n of anchors)heads.set(n.id,n.id===inlet.id?Math.max(0,input.inletPressureBar)/BAR_PER_M_HEAD:Math.max(0,input.inletPressureBar*.9)/BAR_PER_M_HEAD)
  const ids=unknown.map(n=>n.id)
  const residual=()=>{
    const r=new Map<string,number>();ids.forEach(id=>r.set(id,-(demand.get(id)??0)))
    for(const l of links){
      if(!heads.has(l.a)||!heads.has(l.b))continue
      const f=flowFromHead(heads.get(l.a)!-heads.get(l.b)!,l)
      if(r.has(l.a))r.set(l.a,r.get(l.a)!+f)
      if(r.has(l.b))r.set(l.b,r.get(l.b)!-f)
    }
    return r
  }

  for(let iter=0;iter<40&&ids.length;iter++){
    const r=residual();let max=0;ids.forEach(id=>max=Math.max(max,Math.abs(r.get(id)??0)));if(max<1e-7)break
    const J=ids.map(()=>ids.map(()=>0)),eps=.01
    for(let j=0;j<ids.length;j++){
      const id=ids[j],base=heads.get(id)!;heads.set(id,base+eps);const rp=residual();heads.set(id,base)
      for(let i=0;i<ids.length;i++)J[i][j]=((rp.get(ids[i])??0)-(r.get(ids[i])??0))/eps
    }
    const step=solveLinear(J,ids.map(id=>-(r.get(id)??0)))
    let factor=1
    for(let trial=0;trial<10;trial++){
      ids.forEach((id,i)=>heads.set(id,(heads.get(id)??0)+step[i]*factor))
      const nr=residual();let nm=0;ids.forEach(id=>nm=Math.max(nm,Math.abs(nr.get(id)??0)))
      if(nm<max){factor=0;break}
      ids.forEach((id,i)=>heads.set(id,(heads.get(id)??0)-step[i]*factor));factor*=.5
    }
  }

  const rFinal=residual();let maxFinal=0;ids.forEach(id=>maxFinal=Math.max(maxFinal,Math.abs(rFinal.get(id)??0)))
  if(maxFinal>1e-3)warnings.push(`Hydrauliklösningen konvergerade inte helt (max kontinuitetsfel ${maxFinal.toFixed(3)} m³/h).`)

  for(const n of anchors)nodePressures[n.id]=Number(Math.max(-10,(heads.get(n.id)??0)*BAR_PER_M_HEAD).toFixed(5))
  for(const m of nodes.filter(n=>n.data.component==='meter'))if(nodePressures[m.id]!==undefined)meterPressures[m.id]=Number(nodePressures[m.id].toFixed(4))

  for(const l of links){
    const f=flowFromHead(heads.get(l.a)!-heads.get(l.b)!,l)
    for(const id of l.segments)componentFlowsM3h[id]=Number(Math.abs(f).toFixed(6))
  }
  componentFlowsM3h[inlet.id]=Number(nodes.filter(n=>n.data.component==='meter').reduce((s,n)=>s+(input.meterVolumes[n.id]??0),0)+nodes.filter(n=>n.data.component==='leak').reduce((s,n)=>s+(input.leakVolumes[n.id]??0),0))
  return{meterPressures,nodePressures,componentFlowsM3h,warnings}
}
