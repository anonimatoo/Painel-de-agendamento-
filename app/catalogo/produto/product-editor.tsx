'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react'
import { editProductPhotos, saveProductEditor, type Photo } from './actions'
import styles from './product-editor.module.css'

type Product = {
  id: string; name: string; category: string; description: string; sku: string | null; barcode: string | null;
  cents: number; costCents: number; promotionCents: number | null; stock: number; minimumStock: number; published: boolean
}
type LocalPhoto = { file: File; preview: string }
const money = (cents?: number | null) => cents == null ? '' : (cents / 100).toFixed(2).replace('.', ',')

export function ProductEditor({ initial, parentId, categories, photos: initialPhotos, limit, active, canEditStock }: {
  initial: Product | null; parentId?: string; categories: string[]; photos: Photo[]; limit: number; active: boolean; canEditStock: boolean
}) {
  const [id, setId] = useState(initial?.id)
  const [stock, setStock] = useState(initial?.stock ?? 0)
  const [queue, setQueue] = useState<LocalPhoto[]>([])
  const [photos, setPhotos] = useState(initialPhotos)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const previews = useRef(new Set<string>())
  useEffect(() => {
    const urls = previews.current
    return () => urls.forEach(url => URL.revokeObjectURL(url))
  }, [])

  function forget(item: LocalPhoto) {
    URL.revokeObjectURL(item.preview)
    previews.current.delete(item.preview)
    setQueue(current => current.filter(entry => entry !== item))
  }

  function select(files: File[]) {
    setError('')
    const remaining = Math.max(0, limit - photos.length - queue.length)
    if (files.length > remaining) {
      setError('Há espaço para ' + remaining + ' novas fotos. Selecione menos arquivos.')
      return
    }
    if (files.some(file => !file.size || file.size > 4_000_000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
      setError('Selecione imagens JPG, PNG ou WebP de até 4 MB cada.')
      return
    }
    const selected = files.map(file => {
      const preview = URL.createObjectURL(file)
      previews.current.add(preview)
      return { file, preview }
    })
    setQueue(current => [...current, ...selected])
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setStatus('Salvando produto…')
    try {
      const form = new FormData(event.currentTarget)
      if (id) form.set('id', id)
      const result = await saveProductEditor(form)
      if ('error' in result) throw new Error(result.error)
      if (!result.id) throw new Error('Não foi possível salvar o produto.')
      setId(result.id)
      setStock(result.stock)
      for (const [index, item] of queue.entries()) {
        setStatus('Enviando foto ' + (index + 1) + ' de ' + queue.length + '…')
        const upload = new FormData()
        upload.set('command', 'add')
        upload.set('image', item.file)
        const outcome = await editProductPhotos(result.id, upload)
        if ('error' in outcome) throw new Error('Produto salvo. ' + outcome.error)
        setPhotos(outcome.photos)
        forget(item)
      }
      setStatus('Produto salvo.')
      if (window.location.pathname.endsWith('/novo')) window.history.replaceState(null, '', '/catalogo/produto/' + encodeURIComponent(result.id))
    } catch (failure) {
      setStatus('')
      setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.')
    } finally { setBusy(false) }
  }

  async function adjust(command: 'order' | 'remove', ids: string[]) {
    if (!id || busy) return
    setBusy(true)
    setError('')
    setStatus(command === 'remove' ? 'Removendo foto…' : 'Salvando ordem…')
    try {
      const form = new FormData()
      form.set('command', command)
      for (const photo of ids) form.append('photo', photo)
      const result = await editProductPhotos(id, form)
      if ('error' in result) throw new Error(result.error)
      setPhotos(result.photos)
      setStatus('Galeria atualizada.')
    } catch (failure) {
      setStatus('')
      setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar a galeria.')
    } finally { setBusy(false) }
  }

  return <form className={styles.editor} onSubmit={save}>
    <article><h2>Dados do produto</h2>
      {parentId && <input type="hidden" name="parentId" value={parentId} />}
      <fieldset disabled={busy} className={styles.fields}>
        <label>Nome<input name="name" defaultValue={initial?.name} required minLength={2} maxLength={100} /></label>
        <label>Categoria<input name="category" list="product-categories" defaultValue={initial?.category} maxLength={80} />
          <datalist id="product-categories">{categories.map(category => <option key={category}>{category}</option>)}</datalist></label>
        <div className={styles.two}><label>SKU<input name="sku" defaultValue={initial?.sku ?? ''} maxLength={64} /></label>
          <label>Código de barras<input name="barcode" inputMode="numeric" pattern="[0-9]*" maxLength={32} defaultValue={initial?.barcode ?? ''} /></label></div>
        <label>Descrição<textarea name="description" defaultValue={initial?.description} maxLength={1000} rows={4} /></label>
        <div className={styles.two}>
          <label>Preço (R$)<input name="price" required inputMode="decimal" placeholder="0,00" defaultValue={money(initial?.cents)} /></label>
          <label>Preço promocional (R$)<input name="promotion" inputMode="decimal" defaultValue={money(initial?.promotionCents)} /></label>
          <label>Custo unitário (R$)<input name="cost" inputMode="decimal" defaultValue={money(initial?.costCents)} /></label>
          <label>Estoque mínimo<input name="minimumStock" type="number" min={0} max={1000000} required defaultValue={initial?.minimumStock ?? 0} /></label>
          {canEditStock && <label>Estoque atual<input name="stock" type="number" min={0} max={1000000} required defaultValue={initial?.stock ?? 0} />
            <input name="expectedStock" type="hidden" value={stock} /></label>}
        </div>
        {active ? <label className="check"><input name="published" type="checkbox" defaultChecked={initial?.published} /> Publicar no catálogo</label>
          : <p>O produto será salvo como rascunho. A publicação é liberada após a ativação da assinatura.</p>}
      </fieldset>
    </article>
    <article><h2>Fotos do produto</h2>
      <p>{photos.length + queue.length} de {limit} fotos. A primeira aparece no catálogo.</p>
      {photos.length > limit && <p>As fotos existentes foram mantidas. Remova fotos para voltar a enviar.</p>}
      <label className={styles.upload}><ImagePlus size={22} aria-hidden /> Selecionar fotos
        <input type="file" aria-label="Selecionar fotos" multiple accept="image/jpeg,image/png,image/webp"
          disabled={busy || photos.length + queue.length >= limit} onChange={event => {
            select(Array.from(event.currentTarget.files ?? []))
            event.currentTarget.value = ''
          }} />
      </label>
      <ol className={styles.gallery}>
        {photos.map((photo, index) => <li key={photo.id}>
          <img src={'/api/imagens/' + photo.key} alt={'Foto ' + (index + 1)} />
          <small>{index === 0 ? 'Foto principal' : 'Foto ' + (index + 1)}</small>
          <div className={styles.photoActions}>{[-1, 1].map(offset => <button type="button" key={offset} className="outline" disabled={busy || !photos[index + offset]}
            aria-label={(offset < 0 ? 'Subir foto ' : 'Descer foto ') + (index + 1)} onClick={() => {
              const ids = photos.map(item => item.id)
              const other = ids[index + offset]
              ids[index + offset] = ids[index]
              ids[index] = other
              void adjust('order', ids)
            }}>{offset < 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}</button>)}
            <button className="outline" type="button" disabled={busy} aria-label={'Remover foto ' + (index + 1)} onClick={() => void adjust('remove', [photo.id])}><Trash2 size={16} /></button></div>
        </li>)}
        {queue.map((item, index) => <li key={item.preview}><img src={item.preview} alt={'Prévia ' + (index + 1)} /><small>Aguardando envio</small>
          <div className={styles.photoActions}>{[-1, 1].map(offset => <button key={offset} className="outline" type="button" disabled={busy || !queue[index + offset]}
            aria-label={(offset < 0 ? 'Subir prévia ' : 'Descer prévia ') + (index + 1)}
            onClick={() => setQueue(current => {
              const next = [...current]
              const other = next[index + offset]
              next[index + offset] = next[index]
              next[index] = other
              return next
            })}>{offset < 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}</button>)}
            <button className="outline" type="button" aria-label={'Remover prévia ' + (index + 1)} disabled={busy} onClick={() => forget(item)}><Trash2 size={16} /></button></div></li>)}
      </ol>
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="success" role="status">{status}</p>}
      <button disabled={busy}>{busy ? 'Aguarde…' : 'Salvar produto'}</button>
    </article>
  </form>
}
