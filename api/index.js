// Vercel serverless entry: every /api/* and /t/* request is rewritten here
// (see vercel.json). Static files in public/ are served by Vercel's CDN.
import { createApp } from '../src/server.js';

export default createApp();
