import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background, Controls, MiniMap, ReactFlow,
  addEdge, useEdgesState, useNodesState, Handle, Position,
  type Connection, type Edge, type Node, type NodeProps, type ReactFlowInstance
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Download, FileDown, FileUp, Gauge, Play, Save, Square, Trash2, Waves, X } from 'lucide-react'

type ComponentType = 'pipe'|'elbow'|'tee'|'cross'|'inlet'|'meter'|'leak'|'open'
type PortDimensions = { left: string; right: string; top: string; bottom: string }
type Data = {
  label: string; component: ComponentType; size?: string; length?: number;
  flow?: number; pressure?: number; monthlyVolumeM3?: number; template?: string; portSizes?: Partial<PortDimensions>; leakFlowLs?: number
}
type SimulationRow = {
  time: string
  totalVolumeM3: number
  inletPressure: number
  meterVolumes: Record<string, number>
  meterTotals: Record<string, number>
  leakVolumes: Record<string, number>
  totalLeakVolumeM3: number
}

const sizes = ['DN25','DN32','DN40','DN50','DN63','DN75','DN90','DN110','DN160','DN200']
const templates = ['Normalvilla','Stor villa','Sommarstuga','Egen profil']
const templateMonthlyM3: Record<string, number> = { 'Normalvilla': 8, 'Stor villa': 12, 'Sommarstuga': 8, 'Egen profil': 8 }
const speedOptions = [1,2,4,8,16,32]

function Port({type, position, id}: {type:'target'|'source',position:Position,id?:string}) {
  return <Handle id={id} type={type} position={position} style={{width:9,height:9,borderRadius:2}} />
}

function BiPort({position, id}: {position:Position, id:string}) {
  return <>
    <Port type="target" position={position} id={`${id}-target`} />
    <Port type="source" position={position} id={`${id}-source`} />
  </>
}

function NetworkNode({data, selected}: NodeProps<Node<Data>>) {
  const d=data
  const portSizes = {left:d.portSizes?.left ?? d.size ?? 'DN63', right:d.portSizes?.right ?? d.size ?? 'DN63', top:d.portSizes?.top ?? d.size ?? 'DN63', bottom:d.portSizes?.bottom ?? d.size ?? 'DN63'}
  if (d.component==='pipe') return <div className={`node pipe ${selected?'selected':''}`}><Port type="target" position={Position.Left}/><Port type="source" position={Position.Right}/><div className="pipe-label">RÖR</div><b>{d.size}</b><span>{d.length} m</span></div>
  if (d.component==='elbow') return <div className={`node elbow ${selected?'selected':''}`}><Port type="target" position={Position.Left}/><Port type="source" position={Position.Right}/><div className="shape">⌞</div><b>{d.size}</b></div>
  if (d.component==='tee') return <div className={`node junction ${selected?'selected':''}`}><BiPort position={Position.Left} id="left"/><BiPort position={Position.Right} id="right"/><BiPort position={Position.Bottom} id="bottom"/><div className="tee-shape">T</div><b>T-koppling</b><span>V {portSizes.left} · H {portSizes.right}</span><span>N {portSizes.bottom}</span></div>
  if (d.component==='cross') return <div className={`node junction ${selected?'selected':''}`}><BiPort position={Position.Left} id="left"/><BiPort position={Position.Right} id="right"/><BiPort position={Position.Top} id="top"/><BiPort position={Position.Bottom} id="bottom"/><div className="tee-shape">✚</div><b>X-koppling</b><span>L {portSizes.left} · R {portSizes.right}</span><span>U {portSizes.top} · N {portSizes.bottom}</span></div>
  if (d.component==='inlet') return <div className={`node meter inlet ${selected?'selected':''}`}><Port type="source" position={Position.Right}/><Gauge size={25}/><b>INLOPP</b><span>{d.flow} l/s · {d.pressure} bar</span></div>
  if (d.component==='leak') return <div className={`node leak ${selected?'selected':''}`}><BiPort position={Position.Left} id="left"/><Gauge size={22}/><b>{d.label}</b><span>LÄCKA</span><small>{Number(d.leakFlowLs ?? 1).toFixed(2)} l/s</small></div>
  if (d.component==='open') return <div className={`node open-boundary ${selected?'selected':''}`}><BiPort position={Position.Left} id="left"/><Waves size={22}/><b>{d.label}</b><span>ÖPPEN</span><small>Okänt efter denna punkt</small></div>
  return <div className={`node meter ${selected?'selected':''}`}><Port type="target" position={Position.Left}/><Gauge size={23}/><b>{d.label}</b><span>{d.template || 'Normalvilla'}</span><small>{Number(d.monthlyVolumeM3 ?? templateMonthlyM3[d.template ?? 'Normalvilla'] ?? 8).toFixed(1)} m³/mån · {Number(d.pressure ?? 0).toFixed(2)} bar</small></div>
}

const nodeTypes = { network: NetworkNode }

const initialNodes: Node<Data>[] = [
  {id:'inlet-1', type:'network', position:{x:80,y:280}, data:{label:'Inlopp',component:'inlet',flow:5,pressure:5}},
  {id:'pipe-1', type:'network', position:{x:280,y:275}, data:{label:'Rör 1',component:'pipe',size:'DN63',length:100}},
  {id:'tee-1', type:'network', position:{x:490,y:275}, data:{label:'T1',component:'tee',size:'DN63',portSizes:{left:'DN63',right:'DN50',bottom:'DN40'}}},
  {id:'pipe-2', type:'network', position:{x:680,y:180}, data:{label:'Rör 2',component:'pipe',size:'DN50',length:60}},
  {id:'meter-1', type:'network', position:{x:900,y:180}, data:{label:'Hushåll 1',component:'meter',size:'DN25',template:'Normalvilla',monthlyVolumeM3:8,pressure:4.6}},
  {id:'pipe-3', type:'network', position:{x:680,y:380}, data:{label:'Rör 3',component:'pipe',size:'DN50',length:80}},
  {id:'meter-2', type:'network', position:{x:900,y:380}, data:{label:'Hushåll 2',component:'meter',size:'DN25',template:'Normalvilla',monthlyVolumeM3:8,pressure:4.4}},
]
const initialEdges: Edge[] = [
  {id:'e1',source:'inlet-1',target:'pipe-1',animated:true},
  {id:'e2',source:'pipe-1',target:'tee-1',animated:true},
  {id:'e3',source:'tee-1',target:'pipe-2'},
  {id:'e4',source:'pipe-2',target:'meter-1'},
  {id:'e5',source:'tee-1',target:'pipe-3'},
  {id:'e6',source:'pipe-3',target:'meter-2'},
]

function formatDateInput(date: Date) {
  const pad=(n:number)=>String(n).padStart(2,'0')
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`
}

function formatTime(value:string) {
  return new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))
}

const normalProfile = [0.50,0.45,0.42,0.40,0.48,0.72,0.95,1.05,0.85,0.68,0.58,0.62,0.72,0.68,0.62,0.68,0.82,1.08,1.20,1.00,0.82,0.68,0.58,0.52]
const largeProfile = [0.55,0.50,0.48,0.45,0.50,0.80,1.05,1.15,0.95,0.75,0.65,0.70,0.85,0.80,0.72,0.75,0.90,1.20,1.35,1.10,0.90,0.78,0.68,0.60]
const summerProfile = [0.25,0.20,0.18,0.18,0.20,0.35,0.55,0.70,0.75,0.70,0.80,0.95,1.05,1.10,1.15,1.25,1.35,1.30,1.20,1.00,0.75,0.55,0.40,0.30]

function hourlyProfileFactor(template:string, hour:number, day:number) {
  const profile = template === 'Stor villa' ? largeProfile : template === 'Sommarstuga' ? summerProfile : normalProfile
  if (template === 'Egen profil') return 0.85 + ((hour * 17 + day * 7) % 31) / 100
  return profile[hour] ?? 1
}

function profileNormalization(template:string) {
  let sum = 0
  for (let day=0; day<30; day++) for (let hour=0; hour<24; hour++) sum += hourlyProfileFactor(template,hour,day)
  return sum
}

function buildSimulationRows(start:string, end:string, nodes:Node<Data>[]) {
  const from = new Date(start)
  const to = new Date(end)
  const meters = nodes.filter(n=>n.data.component==='meter')
  const inlet = nodes.find(n=>n.data.component==='inlet')
  const rows: SimulationRow[] = []
  const totals: Record<string,number> = Object.fromEntries(meters.map(m=>[m.id,0]))
  const leaks = nodes.filter(n=>n.data.component==='leak')

  for(let t=from.getTime(), i=0; t<=to.getTime(); t+=3600000, i++) {
    const date = new Date(t)
    const meterVolumes: Record<string,number> = {}
    const meterTotals: Record<string,number> = {}
    let total = 0
    const leakVolumes: Record<string,number> = {}
    let totalLeakVolumeM3 = 0
    leaks.forEach(leak=>{
      const leakLs = Math.max(0, Number(leak.data.leakFlowLs ?? 1))
      const volume = leakLs * 3.6
      leakVolumes[leak.id] = Number(volume.toFixed(6))
      totalLeakVolumeM3 += volume
      total += volume
    })
    meters.forEach(m=>{
      const template = m.data.template ?? 'Normalvilla'
      const monthlyVolume = Math.max(0, Number(m.data.monthlyVolumeM3 ?? templateMonthlyM3[template] ?? 8))
      const factor = hourlyProfileFactor(template,date.getHours(),i % 30)
      const volume = monthlyVolume * factor / profileNormalization(template)
      totals[m.id] += volume
      meterVolumes[m.id]=Number(volume.toFixed(6))
      meterTotals[m.id]=Number(totals[m.id].toFixed(6))
      total += volume
    })
    rows.push({time:date.toISOString(),totalVolumeM3:Number(total.toFixed(6)),inletPressure:Number(inlet?.data.pressure ?? 0),meterVolumes,meterTotals,leakVolumes,totalLeakVolumeM3:Number(totalLeakVolumeM3.toFixed(6))})
    if(rows.length>100000) break
  }
  return rows
}

function App(){
  const [nodes,setNodes,onNodesChange]=useNodesState(initialNodes)
  const [edges,setEdges,onEdgesChange]=useEdgesState(initialEdges)
  const [selected,setSelected]=useState<string|null>(null)
  const [rf,setRf]=useState<ReactFlowInstance<Node<Data>,Edge>|null>(null)
  const [status,setStatus]=useState('Redo att bygga')
  const [simOpen,setSimOpen]=useState(false)
  const now = useMemo(()=>{const d=new Date();d.setMinutes(0,0,0);return d},[])
  const [simStart,setSimStart]=useState(formatDateInput(now))
  const [simEnd,setSimEnd]=useState(formatDateInput(new Date(now.getTime()+24*3600000)))
  const [simSpeed,setSimSpeed]=useState(4)
  const [simRows,setSimRows]=useState<SimulationRow[]>([])
  const [simIndex,setSimIndex]=useState(0)
  const [simRunning,setSimRunning]=useState(false)
  const [simError,setSimError]=useState('')
  const selectedNode=nodes.find(n=>n.id===selected)
  const onConnect=useCallback((c:Connection)=>setEdges(es=>addEdge({...c,animated:false},es)),[setEdges])

  useEffect(()=>{
    if(!simRunning) return
    if(simIndex>=simRows.length){setSimRunning(false);setStatus('Simulering klar');return}
    const timer=window.setTimeout(()=>setSimIndex(i=>Math.min(i+simSpeed,simRows.length)),1000)
    return ()=>window.clearTimeout(timer)
  },[simRunning,simIndex,simRows.length,simSpeed])

  const addNode=(component:ComponentType)=>{
    const id=`${component}-${Date.now()}`
    const center=rf?.screenToFlowPosition({x:window.innerWidth/2,y:window.innerHeight/2}) || {x:500,y:300}
    const data:Data = component==='pipe'?{label:'Nytt rör',component,size:'DN63',length:100}:
      component==='elbow'?{label:'Ny böj',component,size:'DN63'}:
      component==='tee'?{label:'Ny T-koppling',component,size:'DN63',portSizes:{left:'DN63',right:'DN63',bottom:'DN63'}}:
      component==='cross'?{label:'Ny X-koppling',component,size:'DN63',portSizes:{left:'DN63',right:'DN63',top:'DN63',bottom:'DN63'}}:
      component==='inlet'?{label:'Inlopp',component,flow:5,pressure:5}:
      component==='leak'?{label:`Läcka ${nodes.filter(n=>n.data.component==='leak').length+1}`,component,leakFlowLs:1}:
      component==='open'?{label:'Öppen',component}:
      {label:`Hushåll ${nodes.filter(n=>n.data.component==='meter').length+1}`,component,template:'Normalvilla',monthlyVolumeM3:8,pressure:4.5}
    setNodes(ns=>[...ns,{id,type:'network',position:center,data}]);setSelected(id)
  }
  const update=(patch:Partial<Data>)=> selected && setNodes(ns=>ns.map(n=>n.id===selected?{...n,data:{...n.data,...patch}}:n))
  const deleteSelected=()=>{ if(!selected)return; setNodes(ns=>ns.filter(n=>n.id!==selected)); setEdges(es=>es.filter(e=>e.source!==selected&&e.target!==selected)); setSelected(null)}
  const save=()=>{
    const blob=new Blob([JSON.stringify({version:1,nodes,edges},null,2)],{type:'application/json'})
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='vattennat-projekt.json'; a.click(); URL.revokeObjectURL(a.href); setStatus('Projekt sparat')
  }
  const exportCsv=()=>{
    const meters=nodes.filter(n=>n.data.component==='meter'||n.data.component==='inlet')
    const rows=['meter_id,label,volume_m3_per_report,pressure_bar,template,monthly_volume_m3',...meters.map(n=>`${n.id},"${n.data.label}",${n.data.monthlyVolumeM3??''},${n.data.pressure??''},"${n.data.template??''}",${n.data.monthlyVolumeM3??''}`)]
    const blob=new Blob([rows.join('
')],{type:'text/csv;charset=utf-8'})
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='vattennat-matare.csv';a.click();URL.revokeObjectURL(a.href);setStatus('CSV exporterad')
  }
  const load=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0]; if(!file)return
    const r=new FileReader(); r.onload=()=>{try{const x=JSON.parse(String(r.result)); const loadedNodes=(x.nodes ?? []).map((n:Node<Data>)=>{ if(n.data.component==='tee'||n.data.component==='cross'){ const base=n.data.portSizes ?? {}; const fallback=n.data.size ?? 'DN63'; return {...n,data:{...n.data,portSizes:{left:base.left ?? fallback,right:base.right ?? fallback,top:base.top ?? fallback,bottom:base.bottom ?? fallback}}} } return n }); setNodes(loadedNodes);setEdges(x.edges ?? []);setStatus('Projekt laddat')}catch{setStatus('Kunde inte läsa filen')}};r.readAsText(file)
  }
  const startSimulation=()=>{
    const from=new Date(simStart), to=new Date(simEnd)
    if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())){setSimError('Ange giltiga datum och tider.');return}
    if(to<=from){setSimError('Sluttiden måste vara efter starttiden.');return}
    if(nodes.filter(n=>n.data.component==='meter').length===0){setSimError('Lägg till minst en hushållsmätare innan simuleringen startas.');return}
    const rows=buildSimulationRows(simStart,simEnd,nodes)
    setSimRows(rows);setSimIndex(0);setSimError('');setSimRunning(true);setStatus('Simulering körs')
  }
  const stopSimulation=()=>{setSimRunning(false);setStatus('Simulering pausad')}
  const closeSimulation=()=>{setSimRunning(false);setSimOpen(false);setSimError('')}
  const currentRow=simRows[Math.max(0,Math.min(simIndex-1,simRows.length-1))]
  const visibleRows=simRows.slice(0,simIndex).slice(-24)
  const progress=simRows.length?Math.round((simIndex/simRows.length)*100):0
  const componentButtons=useMemo(()=>[
    ['pipe','Rör'],['elbow','Böj'],['tee','T-koppling'],['cross','X-koppling'],['meter','Hushållsmätare'],['leak','Läcka'],['open','Öppen'],['inlet','Inlopp']
  ] as [ComponentType,string][],[])
  return <div className="app">
    <header><div className="brand"><Waves/> <span>Vattennät <small>V1</small></span></div><div className="actions">
      <button onClick={save}><Save size={16}/> Spara</button><label className="button"><FileUp size={16}/> Ladda<input type="file" accept=".json" onChange={load}/></label><button onClick={exportCsv}><FileDown size={16}/> Exportera CSV</button><button className="simulate-button" onClick={()=>setSimOpen(true)}><Play size={16}/> Simulering</button>
    </div><div className="status">{status}</div></header>
    <aside className="left">
      <h3>Komponenter</h3><p className="hint">Klicka för att lägga ut en komponent. Dra sedan handtagen för att koppla ihop nätet.</p>
      {componentButtons.map(([c,label])=><button className="tool" key={c} onClick={()=>addNode(c)}><span className={`icon ${c}`}>{c==='pipe'?'—':c==='elbow'?'⌞':c==='tee'?'T':c==='cross'?'✚':c==='meter'?'◉':c==='leak'?'⚠':c==='open'?'↔':'→'}</span>{label}</button>)}
      <hr/><h3>Tips</h3><div className="tip">• Mus: panorera<br/>• Mushjul: zooma<br/>• Dra mellan portarna för koppling<br/>• Klicka på ett objekt för inställningar<br/>• Delete tar bort markerat objekt</div>
    </aside>
    <main><ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={nodeTypes} onInit={setRf} onNodeClick={(_,n)=>setSelected(n.id)} onPaneClick={()=>setSelected(null)} fitView deleteKeyCode="Delete">
      <Background gap={20} size={1}/><Controls/><MiniMap pannable zoomable/>
    </ReactFlow></main>
    <aside className="right">
      <h3>Inställningar</h3>
      {!selectedNode?<div className="empty">Välj en komponent på ritningen.</div>:<div className="form">
        <label>Namn<input value={selectedNode.data.label} onChange={e=>update({label:e.target.value})}/></label>
        {['pipe','elbow'].includes(selectedNode.data.component) && <label>Rördimension<select value={selectedNode.data.size} onChange={e=>update({size:e.target.value})}>{sizes.map(s=><option key={s}>{s}</option>)}</select></label>}
        {['tee','cross'].includes(selectedNode.data.component) && <div className="port-settings">
          <div className="section-label">Dimension per anslutning</div>
          {(selectedNode.data.component==='tee' ? ['left','right','bottom'] : ['left','right','top','bottom']).map(port=> { const p=port as keyof PortDimensions; return <label key={port}>{port==='left'?'Vänster':port==='right'?'Höger':port==='top'?'Upp':'Ned'}<select value={selectedNode.data.portSizes?.[p] ?? selectedNode.data.size ?? 'DN63'} onChange={e=>update({portSizes:{left:selectedNode.data.portSizes?.left ?? selectedNode.data.size ?? 'DN63',right:selectedNode.data.portSizes?.right ?? selectedNode.data.size ?? 'DN63',top:selectedNode.data.portSizes?.top ?? selectedNode.data.size ?? 'DN63',bottom:selectedNode.data.portSizes?.bottom ?? selectedNode.data.size ?? 'DN63',[p]:e.target.value}})}>{sizes.map(s=><option key={s}>{s}</option>)}</select></label> })}
        </div>}
        {selectedNode.data.component==='pipe' && <label>Längd (m)<input type="number" value={selectedNode.data.length} onChange={e=>update({length:Number(e.target.value)})}/></label>}
        {selectedNode.data.component==='inlet' && <><label>Inloppsflöde (l/s)<input type="number" step="0.01" value={selectedNode.data.flow ?? 5} onChange={e=>update({flow:Number(e.target.value)})}/></label><label>Tryck (bar)<input type="number" step="0.01" value={selectedNode.data.pressure ?? 5} onChange={e=>update({pressure:Number(e.target.value)})}/></label></>}
        {selectedNode.data.component==='meter' && <><label>Tryck vid mätpunkten (bar)<input type="number" step="0.01" value={selectedNode.data.pressure ?? 4.5} onChange={e=>update({pressure:Number(e.target.value)})}/></label><label>Förbrukningsprofil<select value={selectedNode.data.template ?? 'Normalvilla'} onChange={e=>update({template:e.target.value,monthlyVolumeM3:templateMonthlyM3[e.target.value] ?? 8})}>{templates.map(t=><option key={t}>{t}</option>)}</select></label><label>Månadsförbrukning (m³)<input type="number" min="0" step="0.1" value={selectedNode.data.monthlyVolumeM3 ?? templateMonthlyM3[selectedNode.data.template ?? 'Normalvilla'] ?? 8} onChange={e=>update({monthlyVolumeM3:Number(e.target.value)})}/></label><div className="form-hint">Normalvilla är kalibrerad till 8 m³/månad. Simuleringen rapporterar vattenmängd per timme, inte l/s.</div></>}
        {selectedNode.data.component==='open' && <div className="form-hint">Den här anslutningen markerar gränsen för det modellerade området. Allt efter Öppen betraktas som okänt och behöver inte finnas med i projektet.</div>}
        {selectedNode.data.component==='leak' && <><label>Läckflöde (l/s)<input type="number" min="0" step="0.01" value={selectedNode.data.leakFlowLs ?? 1} onChange={e=>update({leakFlowLs:Math.max(0,Number(e.target.value))})}/></label><div className="form-hint">Läckan är konstant i V1. Vid timrapportering motsvarar 1,00 l/s = 3,60 m³ per timme. Hydrauliskt tryckfall beräknas ännu inte.</div></>}
        <button className="danger" onClick={deleteSelected}><Trash2 size={16}/> Ta bort</button>
      </div>}
    </aside>

    {simOpen && <div className="sim-overlay">
      <section className="sim-window">
        <div className="sim-header"><div><h2>Simulering</h2><p>Timvis rapportering · hastigheten påverkar hur snabbt simulerad tid körs</p></div><button className="icon-button" onClick={closeSimulation} aria-label="Stäng"><X size={18}/></button></div>
        <div className="sim-body">
          <div className="sim-settings">
            <label>Startdatum / tid<input type="datetime-local" value={simStart} onChange={e=>setSimStart(e.target.value)} disabled={simRunning}/></label>
            <label>Slutdatum / tid<input type="datetime-local" value={simEnd} onChange={e=>setSimEnd(e.target.value)} disabled={simRunning}/></label>
            <label>Simuleringshastighet<select value={simSpeed} onChange={e=>setSimSpeed(Number(e.target.value))} disabled={simRunning}>{speedOptions.map(s=><option key={s} value={s}>{s}x</option>)}</select></label>
            <div className="sim-note"><b>Rapportering:</b> 1 gång/timme · vattenmängd i m³ + tryck i bar<br/><b>Normalvilla:</b> 8 m³/månad som utgångspunkt<br/><b>Läckor:</b> konstant l/s, omräknat till m³ per timme<br/><b>V1-modell:</b> förbrukningsprofiler körs, medan hydrauliskt tryckfall ännu inte beräknas.</div>
            {simError && <div className="sim-error">{simError}</div>}
            <div className="sim-actions">{simRunning?<button onClick={stopSimulation}><Square size={16}/> Pausa</button>:<button className="primary" onClick={startSimulation}><Play size={16}/> {simRows.length?'Starta om':'Starta simulering'}</button>}</div>
          </div>
          <div className="sim-results">
            <div className="progress-wrap"><div className="progress-label"><span>{simRows.length?`${progress}%`:'Ingen simulering startad'}</span><span>{simIndex} / {simRows.length} timmar</span></div><div className="progress"><div style={{width:`${progress}%`}}/></div></div>
            {currentRow && <div className="sim-cards"><div><small>Simulerad tid</small><b>{formatTime(currentRow.time)}</b></div><div><small>Total vattenmängd senaste timmen</small><b>{currentRow.totalVolumeM3.toFixed(4)} m³</b></div><div><small>Varav läckor</small><b>{currentRow.totalLeakVolumeM3.toFixed(4)} m³</b></div><div><small>Inloppstryck</small><b>{currentRow.inletPressure.toFixed(2)} bar</b></div></div>}
            <div className="table-wrap"><table><thead><tr><th>Tid</th><th>Hushåll</th><th>Läckor</th><th>Totalt</th>{nodes.filter(n=>n.data.component==='meter').map(n=><th key={n.id}>{n.data.label}</th>)}</tr></thead><tbody>{visibleRows.map((r,i)=><tr key={`${r.time}-${i}`}><td>{formatTime(r.time)}</td><td>{(r.totalVolumeM3-r.totalLeakVolumeM3).toFixed(4)} m³</td><td>{r.totalLeakVolumeM3.toFixed(4)} m³</td><td>{r.totalVolumeM3.toFixed(4)} m³</td>{nodes.filter(n=>n.data.component==='meter').map(n=><td key={n.id}>{(r.meterVolumes[n.id]??0).toFixed(4)} m³<br/><small>totalt {(r.meterTotals[n.id]??0).toFixed(3)} m³</small></td>)}</tr>)}</tbody></table>{!simRows.length&&<div className="empty-results">Starta simuleringen för att se timvärden.</div>}</div>
          </div>
        </div>
      </section>
    </div>}
  </div>
}
export default App
