export function publicSlug(name: string) {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')
}

export function publicSlugBase(name: string) {
  const normalized = publicSlug(name)
  if (normalized.length >= 3) return normalized
  return normalized ? 'agenda-' + normalized : 'agenda'
}
