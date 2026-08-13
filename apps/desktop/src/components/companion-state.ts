export type CompanionTenant = 'structure' | 'proof' | 'agent' | 'history'

// Remembered per document because the tenant is a fact about the work, not
// the installation. Kept outside Companion.tsx so that file exports React
// components only and Vite can fast-refresh it without invalidating the tree.
const TENANT_KEY = 'essay.companion.v1'
const MAX_TENANT_ENTRIES = 50
const TENANT_VALUES: ReadonlySet<string> = new Set([
  'structure',
  'proof',
  'agent',
  'history',
])

type SavedTenant = CompanionTenant | 'closed'

function loadTenantMap(): Record<string, SavedTenant> {
  try {
    const raw = localStorage.getItem(TENANT_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return {}
    const map: Record<string, SavedTenant> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (
        typeof value === 'string' &&
        (TENANT_VALUES.has(value) || value === 'closed')
      ) {
        map[key] = value as SavedTenant
      }
    }
    return map
  } catch {
    return {}
  }
}

export function loadCompanionTenant(docKey: string): CompanionTenant | null {
  const saved = loadTenantMap()[docKey]
  if (saved === 'closed') return null
  return saved ?? 'agent'
}

export function saveCompanionTenant(
  docKey: string,
  tenant: CompanionTenant | null,
): void {
  const map = loadTenantMap()
  delete map[docKey]
  const entries = Object.entries(map)
  entries.push([docKey, tenant ?? 'closed'])
  const pruned = Object.fromEntries(entries.slice(-MAX_TENANT_ENTRIES))
  try {
    localStorage.setItem(TENANT_KEY, JSON.stringify(pruned))
  } catch {
    // A full or disabled localStorage costs a remembered tenant, never the
    // document it was remembered for.
  }
}
