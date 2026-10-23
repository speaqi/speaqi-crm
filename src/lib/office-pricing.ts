/** Listino standard USD per milione di token, verificato il 22 ottobre 2026.
 * Fonte: https://developers.openai.com/api/docs/models/gpt-5-mini
 * Niente strumenti o batch. Le immagini (bigliettini per il Direttore) si
 * prenotano a parte con OFFICE_IMAGE_RESERVE_TOKENS per immagine.
 * La prenotazione ignora la cache; il saldo applica i token in cache restituiti.
 */
export const OFFICE_MODEL_PRICES: Readonly<Record<string, { input: number; cachedInput: number; output: number }>> = Object.freeze({
  'gpt-5-mini': Object.freeze({ input: 0.25, cachedInput: 0.025, output: 2 }),
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

/** Tetto prudente per un'immagine in alta definizione sui modelli mini
 * (patch da 32 px moltiplicate): si prenota il massimo, si salda il vero. */
export const OFFICE_IMAGE_RESERVE_TOKENS = 3000

export function estimateModelCost(model: string, input: string, maxOutputTokens: number, usdToEur = 1, extraInputTokens = 0) {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 32_768) {
    throw new Error('Il limite di uscita deve essere fra 1 e 32768 token')
  }
  if (typeof input !== 'string' || input.length > 250_000) throw new Error('Testo troppo lungo o non valido')
  // Un byte UTF-8 per token e 512 token di margine per la struttura della richiesta:
  // un limite prudente anche con accenti, emoji e testo poco comprimibile.
  if (!nonNegativeInteger(extraInputTokens)) throw new Error('Token aggiuntivi non validi')
  const tokensIn = new TextEncoder().encode(input).length + 512 + extraInputTokens
  return { tokensIn, cents: Math.max(1, modelCostCents(model, tokensIn, maxOutputTokens, usdToEur)) }
}
