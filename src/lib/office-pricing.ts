/** Listino standard USD per milione di token, verificato il 22 ottobre 2026.
 * Fonte: https://developers.openai.com/api/docs/models/gpt-5-mini
 * Niente strumenti, immagini o batch: questa base accetta solo testo.
 * La prenotazione ignora la cache; il saldo applica i token in cache restituiti.
 */
export const OFFICE_MODEL_PRICES: Readonly<Record<string, { input: number; cachedInput: number; output: number }>> = Object.freeze({
  'gpt-5-mini': Object.freeze({ input: 0.25, cachedInput: 0.025, output: 2 }),
  // Verificato il 23 ottobre 2026: https://developers.openai.com/api/docs/models/gpt-5.1
  // Prezzi standard testo USD / 1M token, inclusa la snapshot elencata nella stessa pagina.
  'gpt-5.1': Object.freeze({ input: 1.25, cachedInput: 0.125, output: 10 }),
  'gpt-5.1-2025-11-13': Object.freeze({ input: 1.25, cachedInput: 0.125, output: 10 }),
})

export function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647
}

export function modelCostCents(model: string, tokensIn: number, tokensOut: number, usdToEur = 1, cachedTokens = 0): number {
  const price = Object.hasOwn(OFFICE_MODEL_PRICES, model) ? OFFICE_MODEL_PRICES[model] : undefined
  if (!price) throw new Error(`Modello senza listino: ${model}`)
  if (!nonNegativeInteger(tokensIn) || !nonNegativeInteger(tokensOut)) throw new Error('Numero di token non valido')
  if (!nonNegativeInteger(cachedTokens) || cachedTokens > tokensIn) throw new Error('Token in cache non validi')
  const rate = Math.round(usdToEur * 1_000_000)
  if (!Number.isFinite(usdToEur) || usdToEur <= 0 || usdToEur > 10 || rate < 1 || Math.abs(rate / 1_000_000 - usdToEur) > 1e-12) {
    throw new Error('Cambio USD/EUR non valido: usa fino a sei decimali')
  }
  // Interi per evitare che 207,00000000000003 diventi 208 centesimi.
  // Prezzi in microdollari, cambio in milionesimi, poi centesimi EUR.
  const usdMicros = BigInt(tokensIn - cachedTokens) * BigInt(Math.round(price.input * 1_000_000)) + BigInt(cachedTokens) * BigInt(Math.round(price.cachedInput * 1_000_000)) + BigInt(tokensOut) * BigInt(Math.round(price.output * 1_000_000))
  const numerator = usdMicros * BigInt(rate) * BigInt(100)
  const denominator = BigInt('1000000000000000000')
  return Number((numerator + denominator - BigInt(1)) / denominator)
}

export function estimateModelCost(model: string, input: string, maxOutputTokens: number, usdToEur = 1) {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 32_768) {
    throw new Error('Il limite di uscita deve essere fra 1 e 32768 token')
  }
  if (typeof input !== 'string' || input.length > 250_000) throw new Error('Testo troppo lungo o non valido')
  // Un byte UTF-8 per token e 512 token di margine per la struttura della richiesta:
  // un limite prudente anche con accenti, emoji e testo poco comprimibile.
  const tokensIn = new TextEncoder().encode(input).length + 512
  return { tokensIn, cents: Math.max(1, modelCostCents(model, tokensIn, maxOutputTokens, usdToEur)) }
}
