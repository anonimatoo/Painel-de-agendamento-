'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Background, Controls, ReactFlow, type Node, type OnNodesChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { actions, triggers, type AutomationGraph } from '@/lib/automation-graph'
import { saveAutomation } from './actions'

export function FlowEditor({ initial }: { initial: { id?: string; revision?: number; name: string; enabled: boolean; graph: AutomationGraph } }) {
  const router = useRouter()
  const [graph, setGraph] = useState(initial.graph)
  const [name, setName] = useState(initial.name)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [message, setMessage] = useState<{ text: string; error?: boolean }>()
  const [pending, start] = useTransition()
  const [identity, setIdentity] = useState({ id: initial.id, revision: initial.revision })
  const [event, task] = graph.nodes
  const nodes: Node[] = [
    { id: event.id, position: event.position, type: 'input', data: { label: triggers[event.data.trigger] } },
    { id: task.id, position: task.position, type: 'output', data: { label: actions[task.data.action] } }
  ]
  const updatePositions: OnNodesChange = changes => {
    if (!changes.getByType('position').length) return
    const positions = changes.applyTo(nodes)
    setGraph(current => ({ ...current, nodes: [
      { ...current.nodes[0], position: positions[0].position }, { ...current.nodes[1], position: positions[1].position }
    ] }))
  }
  function connect() {
    setGraph(current => ({ ...current, edges: [{ id: 'event-task', source: 'event', target: 'task' }] }))
  }
  function unlink() {
    setEnabled(false)
    setGraph(current => ({ ...current, edges: [] }))
  }
  return <form onSubmit={submit => {
    submit.preventDefault()
    start(async () => {
      setMessage(undefined)
      const result = await saveAutomation({ ...identity, graph, name, enabled })
      if ('error' in result || !result.id) {
        setMessage({ text: result.error ?? 'Não foi possível salvar o fluxo.', error: true })
        return
      }
      setIdentity(result)
      setMessage({ text: 'Automação salva.' })
      if (!initial.id) router.replace('/automacoes/editor?fluxo=' + encodeURIComponent(result.id))
    })
  }}>
    <label>Nome do fluxo<input value={name} required minLength={2} maxLength={100} onChange={e => setName(e.target.value)} /></label>
    <div style={{ height: 300, minWidth: 0 }} aria-label="Fluxo visual de automação">
      <ReactFlow nodes={nodes} edges={graph.edges} fitView minZoom={0.25} maxZoom={1.5} onNodesChange={updatePositions}
        onConnect={edge => { if (edge.source === 'event' && edge.target === 'task') connect() }}
        onEdgesDelete={unlink} deleteKeyCode={null} nodesConnectable elementsSelectable>
        <Background /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <div className="inline">
      <label>Quando<select value={event.data.trigger} onChange={e => {
        const trigger = e.target.value as keyof typeof triggers
        setGraph(current => ({ ...current, nodes: [{ ...event, data: { trigger } }, task] }))
      }}>{Object.entries(triggers).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Executar<select value={task.data.action} onChange={e => {
        const action = e.target.value as keyof typeof actions
        setGraph(current => ({ ...current, nodes: [event, { ...task, data: { ...task.data, action } }] }))
      }}>{Object.entries(actions).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {task.data.action === 'WHATSAPP_REMINDER' && <label>Minutos antes do atendimento<input type="number" min={5} max={10080} value={task.data.minutes} onChange={e => {
        const minutes = e.target.valueAsNumber
        setGraph(current => ({ ...current, nodes: [event, { ...task, data: { ...task.data, minutes } }] }))
      }} required /></label>}
    </div>
    <button type="button" className="outline" onClick={graph.edges.length ? unlink : connect}>{graph.edges.length ? 'Desconectar passos' : 'Conectar passos'}</button>
    <label className="check"><input type="checkbox" checked={enabled} disabled={!graph.edges.length} onChange={e => setEnabled(e.target.checked)} /> Ativar fluxo</label>
    <button disabled={pending}>{pending ? 'Salvando…' : 'Salvar automação'}</button>
    {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'error' : 'success'}>{message.text}</p>}
  </form>
}
