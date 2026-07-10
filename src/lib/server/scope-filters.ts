/**
 * Regola canonica di visibilità dei contatti lato server.
 *
 * - Superficie di LAVORO pipeline (code, automazioni che generano task):
 *   contact_scope 'crm' (o null, righe legacy) E non nascosto (hidden).
 * - Superficie di REPORTING (analytics, finanza): solo scope 'crm', senza
 *   filtro hidden — lo storico di un contatto dormiente resta nei numeri.
 *
 * `is_partner` è un attributo/filtro opzionale e non è MAI un'esclusione:
 * un partner può stare in pipeline ed essere anche cliente.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Scope CRM (righe legacy con scope null incluse), senza filtro hidden. */
export function applyCrmScope<T>(query: T): T {
  return (query as any).or('contact_scope.is.null,contact_scope.eq.crm') as T
}

/** Superficie di lavoro pipeline: scope CRM e non nascosto. */
export function applyPipelineScope<T>(query: T): T {
  return (applyCrmScope(query) as any).or('hidden.is.null,hidden.eq.false') as T
}
