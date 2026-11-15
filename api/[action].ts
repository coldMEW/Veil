// Vercel function: /api/scan, /api/image, /api/host, /api/status (see server/handlers.ts).
import { handleApi } from '../server/handlers';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  return handleApi(url.pathname, url.searchParams);
}

// Only the time stamp takes a POST: its body is a SHA-256, never a file.
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/witness') return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  return handleApi(url.pathname, url.searchParams, request);
}
