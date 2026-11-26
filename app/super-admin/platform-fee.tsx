import { admin } from '../actions'
import { Field } from '../ui'

export function PlatformFeeForm({ scope, id, bps, fixed }: { scope: 'tenant' | 'plan'; id: string; bps: number | null; fixed: number | null }) {
  return <details><summary>Comissão da plataforma</summary><form action={admin.bind(null, 'platform-fee')}>
    <input type="hidden" name="scope" value={scope} /><input type="hidden" name="id" value={id} />
    <label>Regra<select name="method" defaultValue={bps === null && fixed === null ? 'plan' : fixed ? 'fixed' : bps ? 'percent' : 'none'}>
      {scope === 'tenant' && <option value="plan">Usar regra do plano</option>}
      <option value="none">Desativada</option><option value="percent">Percentual</option><option value="fixed">Valor fixo</option>
    </select></label>
    <label>Percentual por cobrança<input type="number" name="percent" min={0} max={100} step="0.01" defaultValue={(bps ?? 0) / 100} /></label>
    <Field label="Valor fixo em centavos por cobrança" name="fixed" type="number" min={0} value={fixed ?? 0} />
    <button>Salvar comissão</button>
  </form></details>
}
