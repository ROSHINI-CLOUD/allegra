import 'dotenv/config';

const key = process.env.NVIDIA_API_KEY ?? '';
const models = ['mistralai/mistral-nemotron', 'meta/llama-3.2-11b-vision-instruct'];
const prompt = `Liked songs:
- "Tum Hi Ho" by Arijit Singh
- "Gehra Hua" by Arijit Singh

Respond with ONLY JSON: {"queries":["q1","q2","q3"],"reasoning":"one short sentence"}`;

for (const model of models) {
  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a music taste analyst. JSON only.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 512,
      temperature: 0.4
    })
  });
  const text = await response.text();
  console.log(`=== ${model} ${response.status} ===`);
  console.log(text.slice(0, 1000));
}
