import 'dotenv/config';

const nvidiaKey = process.env.NVIDIA_API_KEY ?? '';
const groqKey = process.env.GROQ_API_KEY ?? '';

const nvidia = await fetch('https://integrate.api.nvidia.com/v1/models', {
  headers: { authorization: `Bearer ${nvidiaKey}` }
});
const nvidiaJson = (await nvidia.json()) as { data?: Array<{ id: string }> };
console.log('NVIDIA status', nvidia.status);
const nvidiaIds = (nvidiaJson.data ?? [])
  .map((model) => model.id)
  .filter((id) => /llama|mistral|qwen|gemma|nvidia|nemotron/i.test(id));
console.log('NVIDIA matches:', nvidiaIds.slice(0, 60));

const groq = await fetch('https://api.groq.com/openai/v1/models', {
  headers: { authorization: `Bearer ${groqKey}` }
});
const groqJson = (await groq.json()) as { data?: Array<{ id: string }>; error?: unknown };
console.log('GROQ status', groq.status);
console.log('GROQ body sample', JSON.stringify(groqJson).slice(0, 1200));
console.log(
  'GROQ models:',
  (groqJson.data ?? []).map((model) => model.id)
);
