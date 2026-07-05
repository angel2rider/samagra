const U2_BASE = 'https://samagra.kite.kerala.gov.in/files/samagra-resource/uploads2/tbookscmq';
const U1_BASE = 'https://samagra.kite.kerala.gov.in/files/samagra-resource/uploads/tbookscmq';

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function getMimeType(filePath) {
  const lower = filePath.toLowerCase();
  const ext = Object.keys(MIME_TYPES).find((e) => lower.endsWith(e));
  return ext ? MIME_TYPES[ext] : null;
}

const STRIP_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'x-content-type-options',
];

async function fetchWithHeaders(url, filePath) {
  const response = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) return null;
  const headers = new Headers(response.headers);
  const mime = getMimeType(filePath);
  if (mime) headers.set('content-type', mime);
  headers.set('access-control-allow-origin', '*');
  // Images rarely change — cache for 1 year. PDFs get 1 day.
  const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(filePath);
  headers.set('cache-control', isImage
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=86400, immutable');
  for (const h of STRIP_HEADERS) headers.delete(h);
  if (filePath.endsWith('.pdf') && headers.has('content-disposition')) {
    headers.set('content-disposition', 'inline');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest(context) {
  const { params } = context;
  const segments = params.path;

  if (!segments || segments.length === 0) {
    return new Response('Not Found', { status: 404 });
  }

  const filePath = segments.join('/');

  // Try uploads2, fallback to uploads
  const u2Url = `${U2_BASE}/${filePath}`;
  const result2 = await fetchWithHeaders(u2Url, filePath).catch(() => null);
  if (result2) return result2;

  const u1Url = `${U1_BASE}/${filePath}`;
  const result1 = await fetchWithHeaders(u1Url, filePath).catch(() => null);
  if (result1) return result1;

  return new Response('404 Not Found', { status: 404 });
}
