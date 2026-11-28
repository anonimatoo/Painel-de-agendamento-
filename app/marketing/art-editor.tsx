'use client'

import { useRef, useState } from 'react'

const themes = {
  violeta: { primary: '#260852', accent: '#7934eb' },
  petróleo: { primary: '#062b37', accent: '#087e8f' },
  noturno: { primary: '#181322', accent: '#883c5e' }
}

export function ArtEditor({ name }: { name: string }) {
  const [headline, setHeadline] = useState('Confira nosso catálogo')
  const [subtitle, setSubtitle] = useState(name.slice(0, 80))
  const [template, setTemplate] = useState<keyof typeof themes>('violeta')
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  function render() {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const colors = themes[template]
    const gradient = ctx.createLinearGradient(10, 0, 1080, 1080)
    gradient.addColorStop(0, colors.primary)
    gradient.addColorStop(1, colors.accent)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 1080, 1080)
    ctx.lineWidth = 4
    ctx.strokeStyle = '#ffffff66'
    ctx.strokeRect(48, 48, 984, 984)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    const wrap = (text: string, font: string, y: number, leading: number) => {
      ctx.font = font
      const lines = text.trim().split(/\s+/).reduce<string[]>((lines, word) => {
        const line = lines.at(-1)
        const next = line ? line + ' ' + word : word
        if (line && ctx.measureText(next).width > 860) return [...lines, word]
        return [...lines.slice(0, -1), next]
      }, [])
      lines.forEach((line, index) => ctx.fillText(line, 540, y + index * leading, 860))
      return lines.length
    }
    const lines = wrap(headline, 'bold 92px system-ui', 440, 105)
    wrap(subtitle, '44px system-ui', Math.min(855, 460 + (lines - 1) * 105 + 105), 55)
    setReady(true)
  }

  function download() {
    canvas.current?.toBlob(blob => {
      if (!blob) return
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'arte-cs-agenda-pro.png'
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    }, 'image/png')
  }

  return <article><h2>Editor de artes</h2><form onSubmit={event => { event.preventDefault(); render() }}>
    <label>Título<input required maxLength={56} value={headline} onChange={event => setHeadline(event.target.value)} /></label>
    <label>Subtítulo<input maxLength={80} value={subtitle} onChange={event => setSubtitle(event.target.value)} /></label>
    <label>Tema<select value={template} onChange={event => setTemplate(event.target.value as keyof typeof themes)}>
      {Object.keys(themes).map(theme => <option key={theme}>{theme}</option>)}</select></label>
    <div className="inline"><button>Gerar prévia</button>{ready && <button type="button" className="outline" onClick={download}>Baixar PNG</button>}</div>
  </form>
  <canvas ref={canvas} width={1080} height={1080} hidden={!ready} aria-label="Prévia da arte publicitária" style={{ width: 'min(100%, 420px)', display: ready ? 'block' : 'none', marginTop: '1rem' }} />
  </article>
}
