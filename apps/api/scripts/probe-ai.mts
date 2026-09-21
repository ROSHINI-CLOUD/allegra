import 'dotenv/config';
import { extractJson } from '../src/ai/json.js';
import { GeminiProvider } from '../src/ai/providers/gemini.js';
import { OpenAiCompatibleProvider } from '../src/ai/providers/openaiCompatible.js';

const system =
  'You are a music taste analyst. Respond with ONLY JSON: {"queries":["q1","q2","q3"],"reasoning":"one short sentence"}. No markdown.';
const prompt =
  'Liked songs:\n- "Tum Hi Ho" by Arijit Singh\n- "Gehra Hua" by Arijit Singh';

const providers = [
  new GeminiProvider({
    apiKey: process.env.GEMINI_API_KEY!,
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
  }),
  new OpenAiCompatibleProvider({
    name: 'nvidia',
    apiKey: process.env.NVIDIA_API_KEY!,
    model: 'nvidia/llama-3.1-nemotron-70b-instruct',
    baseUrl: 'https://integrate.api.nvidia.com/v1'
  }),
  new OpenAiCompatibleProvider({
    name: 'groq',
    apiKey: process.env.GROQ_API_KEY!,
    model: 'openai/gpt-oss-20b',
    baseUrl: 'https://api.groq.com/openai/v1'
  })
];

for (const provider of providers) {
  const text = await provider.complete(prompt, { system, maxTokens: 1024, temperature: 0.4 });
  console.log(`--- ${provider.name} ---`);
  console.log('raw:', text ? text.slice(0, 500) : text);
  console.log('parsed:', JSON.stringify(extractJson(text ?? '')));
}
