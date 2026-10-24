/** Una risposta finta di OpenRouter (chat completions), come la legge `callModel`. */
export const MODEL_URL = 'https://openrouter.ai/api/v1/chat/completions'

export function modelReply(text: string, usage: { input_tokens: number; output_tokens: number; cached_tokens?: number; cost?: number } = { input_tokens: 1000, output_tokens: 100 }) {
  return Response.json({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }],
    usage: { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens,
      prompt_tokens_details: { cached_tokens: usage.cached_tokens ?? 0 }, ...(usage.cost === undefined ? {} : { cost: usage.cost }) },
  })
}
