// Vercel function: /api/scan, /api/image, /api/host, /api/status (see server/handlers.ts).
import { handleApi } from '../server/handlers';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  return handleApi(url.pathname, url.searchParams);
}
