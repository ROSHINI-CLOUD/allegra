import 'dotenv/config';
import { extractJson } from '../src/ai/json.js';
import { AiClient } from '../src/ai/aiClient.js';
import { OpenAiCompatibleProvider } from '../src/ai/providers/openaiCompatible.js';
import { RecommendationService } from '../src/services/recommendations.js';
import { TranslationService } from '../src/services/translation.js';
import { MemoryCacheStore } from '../src/lib/cache.js';
import { createServices } from '../src/services.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig(process.env);

const nvidiaOnly = new AiClient([
  new OpenAiCompatibleProvider({
    name: 'nvidia',
    apiKey: process.env.NVIDIA_API_KEY!,
    model: process.env.NVIDIA_MODEL ?? 'mistralai/mistral-nemotron',
    baseUrl: 'https://integrate.api.nvidia.com/v1'
  })
]);

const groqOnly = new AiClient([
  new OpenAiCompatibleProvider({
    name: 'groq',
    apiKey: process.env.GROQ_API_KEY!,
    model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
    baseUrl: 'https://api.groq.com/openai/v1'
  })
]);

const catalog = createServices({
  jwtSecret: config.jwtSecret,
  saavnApiUrl: config.saavnApiUrl,
  gaanaApiUrl: config.gaanaApiUrl,
  lrclibApiUrl: config.lrclibApiUrl,
  ai: {}
}).catalog;

const taste = {
  likedSongs: [
    { title: 'Tum Hi Ho', artist: 'Arijit Singh' },
    { title: 'Gehra Hua', artist: 'Arijit Singh' }
  ],
  recentSongs: [{ title: 'Tum Hi Ho', artist: 'Arijit Singh' }],
  currentSong: { title: 'Tum Hi Ho', artist: 'Arijit Singh' }
};

for (const [label, client] of [
  ['nvidia', nvidiaOnly],
  ['groq', groqOnly]
] as const) {
  const cache = new MemoryCacheStore();
  const translation = new TranslationService(client, cache);
  const recommendations = new RecommendationService(client, catalog, cache);

  const translated = await translation.translate(
    [
      { text: 'Tum hi ho', timestamp: 0, lineOrder: 0 },
      { text: 'Ab tum hi ho', timestamp: 5, lineOrder: 1 }
    ],
    'Tum Hi Ho',
    'Arijit Singh',
    'English'
  );
  console.log(`${label} translate:`, translated ? { provider: translated.provider, sample: translated.lines.map((line) => line.text) } : null);

  const recommended = await recommendations.recommend(taste, new Set(['yXCLyL-9']));
  console.log(
    `${label} recommend:`,
    recommended
      ? { provider: recommended.provider, reasoning: recommended.reasoning, count: recommended.songs.length }
      : null
  );
}

// Prove cascade skips a dead first provider.
const cascade = new AiClient([
  new OpenAiCompatibleProvider({
    name: 'dead',
    apiKey: 'bad',
    model: 'nope',
    baseUrl: 'https://example.invalid/v1'
  }),
  new OpenAiCompatibleProvider({
    name: 'groq',
    apiKey: process.env.GROQ_API_KEY!,
    model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
    baseUrl: 'https://api.groq.com/openai/v1'
  })
]);
const result = await cascade.complete('Return exactly: {"ok":true}', { maxTokens: 32 });
console.log('cascade skip-dead ->', result);
console.log('json ok?', Boolean(extractJson(result?.text ?? '')));
