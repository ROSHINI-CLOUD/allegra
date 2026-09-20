import { createAppFromEnv } from '../apps/api/src/createAppFromEnv.js';

// Vercel routes every /api/* request here and hands the raw (req, res) to this
// default export, which Express apps satisfy directly (same signature as an
// http.Server request listener). Built once per cold start, reused warm.
export default createAppFromEnv(process.env);
