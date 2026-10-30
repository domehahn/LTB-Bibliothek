type Env = { DB: D1Database; EBAY_CLIENT_ID?: string; EBAY_CLIENT_SECRET?: string; EBAY_ENV?: string; EBAY_VERIFICATION_TOKEN?: string };
type User = { id: string; email: string; display_name: string };
type SessionUser = User & { token: string };

const MAIN_SERIES_LAST_NUMBER = 618;
const OFFICIAL_SERIES_SLUGS: Record<string, string> = {
  'ltb-abenteuer': 'abenteuer', advent: 'advent', 'ltb-adventszeit': 'adventszeit', balkonien: 'balkonien', camping: 'camping',
  'classic-edition': 'classic-edition', collection: 'collection', crime: 'crime', 'disney-100': 'disney-100', ducktales: 'ducktales',
  english: 'english', 'enten-edition': 'enten-edition', 'entenhausen-stars': 'entenhausen-stars', europareise: 'europareise', exklusiv: 'exklusiv',
  extra: 'extra', fahrrad: 'fahrrad', fantasy: 'fantasy', 'fantasy-entenhausen': 'fantasy-entenhausen', fitness: 'fitness', galaxy: 'galaxy',
  geschenk: 'geschenk', halloween: 'halloween', 'heavy-metal': 'heavy-metal', history: 'history', 'kleine-helden': 'kleine-helden', klettern: 'klettern',
  kochbuch: 'kochbuch', lesespass: 'lesespass', literatur: 'literatur', malbuch: 'malbuch', 'maus-edition': 'maus-edition', 'mini-pocket': 'mini-pocket',
  mundart: 'mundart', musical: 'musical', mystery: 'mystery', nikolaus: 'nikolaus', ostern: 'ostern', 'phantomias-collection': 'phantomias', präsentiert: 'präsentiert',
  premium: 'premium', 'premium-plus': 'premium-plus', rätsel: 'rätsel', royal: 'royal', schlager: 'schlager', schwimmen: 'schwimmen', sommer: 'sommer',
  'sommer-spiele': 'sommer-spiele', sonderband: 'sonderband', sondereditionen: 'sondereditionen', space: 'space', spezial: 'spezial',
  'ultimate-phantomias': 'ultimate-phantomias', wandern: 'wandern', weihnachten: 'weihnachten', weltreise: 'weltreise', winter: 'winter', 'young-comics': 'young-comics'
};

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 100_000;
const encoder = new TextEncoder();

function json(data: unknown, status = 200, extra: HeadersInit = {}) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  return new Response(JSON.stringify(data), { status, headers });
}

function securityHeaders(request: Request, response: Response) {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('content-security-policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://covers.openlibrary.org; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (new URL(request.url).protocol === 'https:') headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  return new Response(response.body, { status: response.status, headers });
}

function parseCookies(request: Request) {
  return Object.fromEntries((request.headers.get('cookie') ?? '').split(';').filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function cookie(name: string, value: string, maxAge: number, secure: boolean) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict`;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlToBytes(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function derivePassword(password: string, salt: Uint8Array, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

function hex(bytes: Uint8Array) { return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
function unhex(value: string) { return Uint8Array.from(value.match(/.{2}/g) ?? [], pair => parseInt(pair, 16)); }
function equal(a: Uint8Array, b: Uint8Array) { let result = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) result |= (a[i % a.length] ?? 0) ^ (b[i % b.length] ?? 0); return result === 0; }

async function verifyPassword(password: string, stored: string) {
  const [algorithm, iterations, saltHex, hashHex] = stored.split('$');
  if (algorithm !== 'pbkdf2_sha256' || !iterations || !saltHex || !hashHex) return false;
  const derived = await derivePassword(password, unhex(saltHex), Number(iterations));
  return equal(derived, unhex(hashHex));
}

async function createSession(db: D1Database, user: User) {
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = hex(await digest(token));
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(tokenHash, user.id, expiresAt).run();
  return { token, expiresAt };
}

async function currentUser(request: Request, db: D1Database): Promise<SessionUser | null> {
  const token = parseCookies(request).ltb_session;
  if (!token) return null;
  const tokenHash = hex(await digest(token));
  const row = await db.prepare('SELECT u.id, u.email, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1').bind(tokenHash, Math.floor(Date.now() / 1000)).first<User>();
  return row ? { ...row, token } : null;
}

async function body(request: Request) { try { return await request.json() as any; } catch { return null; } }
function userResponse(user: User) { return { user: { id: user.id, email: user.email, name: user.display_name || user.email.split('@')[0] } }; }

async function ebayToken(env: Env): Promise<{ token: string; apiBase: string }> {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) throw new Error('eBay ist nicht konfiguriert.');
  const credentials = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const targets = env.EBAY_ENV?.toLowerCase() === 'sandbox' ? [{ apiBase: 'https://api.sandbox.ebay.com', authBase: 'https://api.sandbox.ebay.com' }] : [{ apiBase: 'https://api.ebay.com', authBase: 'https://api.ebay.com' }, { apiBase: 'https://api.sandbox.ebay.com', authBase: 'https://api.sandbox.ebay.com' }];
  let lastStatus = 0;
  for (const target of targets) {
    const cacheKey = new Request(`https://ltb-bibliothek.internal/ebay-token-${target.apiBase.includes('sandbox') ? 'sandbox' : 'production'}`);
    const cached = await caches.default.match(cacheKey);
    if (cached) return { token: await cached.text(), apiBase: target.apiBase };
    const response = await fetch(`${target.authBase}/identity/v1/oauth2/token`, { method: 'POST', headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope' });
    if (response.ok) { const data = await response.json() as { access_token?: string; expires_in?: number }; if (data.access_token) { await caches.default.put(cacheKey, new Response(data.access_token, { headers: { 'cache-control': `public, max-age=${Math.max(60, (data.expires_in ?? 7200) - 120)}` } })); return { token: data.access_token, apiBase: target.apiBase }; } }
    lastStatus = response.status;
  }
  throw new Error(`eBay OAuth ${lastStatus}: Bitte App ID als Client ID und Cert ID als Client Secret verwenden; Sandbox- und Produktionsschlüssel dürfen nicht verwechselt werden.`);
}

async function ebayAverage(editionId: number, env: Env, userId?: string, requestedTitle?: string, requestedQuery?: string, editionKey?: string) {
  const auth = await ebayToken(env);
  const searchTitle = requestedTitle?.trim() || '';
  const searchQuery = requestedQuery?.trim() || (searchTitle ? `LTB ${searchTitle}` : `LTB ${editionId}`);
  const searchUrl = `https://www.ebay.de/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&_sacat=0`;
  const normalizedTitle = searchTitle.replace(/^ltb\s+(?:hauptreihe\s+)?\d+\s*/i, '').trim();
  const seriesPrefix = editionKey?.startsWith('main:') ? 'LTB' : (searchQuery.match(/^(LTB\s+[^\d]+)\s+\d+/i)?.[1] ?? 'LTB');
  const searchVariants = [...new Set([
    searchQuery,
    `${seriesPrefix} ${editionId} ${normalizedTitle}`.trim(),
    `LTB ${editionId}`,
    `LT ${editionId}`,
    normalizedTitle,
  ].filter(Boolean))].slice(0, editionKey && requestedQuery ? 1 : 5);
  type EbayItem = { title?: string; price?: { value?: string; currency?: string }; itemWebUrl?: string };
  const allItems = new Map<string, EbayItem>();
  for (const variant of searchVariants) {
    const params = new URLSearchParams({ q: variant, limit: '100', sort: 'price', filter: 'priceCurrency:EUR,buyingOptions:{FIXED_PRICE|AUCTION}' });
    const response = await fetch(`${auth.apiBase}/buy/browse/v1/item_summary/search?${params}`, { headers: { authorization: `Bearer ${auth.token}`, 'x-ebay-c-marketplace-id': 'EBAY_DE', 'accept-language': 'de-DE' } });
    if (!response.ok) throw new Error(`eBay Browse ${response.status}`);
    const data = await response.json() as { itemSummaries?: EbayItem[] };
    for (const item of data.itemSummaries ?? []) { const key = item.itemWebUrl || `${item.title}|${item.price?.value}`; if (!allItems.has(key)) allItems.set(key, item); }
  }
  const exact = editionKey && !editionKey.startsWith('main:') ? null : new RegExp(`\\b(?:LTB|LT)\\s*0*${editionId}\\b`, 'i');
  const titleTerms = `${normalizedTitle} ${editionKey?.startsWith('main:') ? '' : searchQuery}`.toLowerCase().split(/[^a-z0-9äöüß]+/i).filter(term => term.length >= 4 && !['lustiges', 'taschenbuch', 'ausgabe', 'hauptreihe'].includes(term));
  const excluded = /konvolut|sammlung|paket|set|bundle|lot|mehrere|bände|baende|komplett/i;
  const listings = [...allItems.values()].filter(item => { const listingTitle = item.title ?? ''; const matchesTitle = titleTerms.length === 0 || titleTerms.every(term => listingTitle.toLowerCase().includes(term)); const matchesNumber = !exact || exact.test(listingTitle); return matchesNumber && matchesTitle && !excluded.test(listingTitle); }).map(item => ({ title: item.title ?? `LTB ${editionId}`, price: Number(item.price?.value), url: item.itemWebUrl ?? '' })).filter(item => Number.isFinite(item.price) && item.price >= 0.5 && item.price <= 250).slice(0, 50);
  const prices = listings.map(item => item.price).sort((a, b) => a - b);
  if (!prices.length) {
    if (userId) await env.DB.prepare('INSERT INTO price_snapshots (user_id, edition_key, average, median, listing_count) VALUES (?, ?, NULL, NULL, 0)').bind(userId, editionKey ?? `main:${editionId}`).run();
    return { editionId, currency: 'EUR', average: null, median: null, count: 0, checkedAt: new Date().toISOString(), searchUrl, listings: [] };
  }
  const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  const middle = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2;
  if (userId) await env.DB.prepare('INSERT INTO price_snapshots (user_id, edition_key, average, median, listing_count) VALUES (?, ?, ?, ?, ?)').bind(userId, editionKey ?? `main:${editionId}`, Number(average.toFixed(2)), Number(median.toFixed(2)), prices.length).run();
  return { editionId, currency: 'EUR', average: Number(average.toFixed(2)), median: Number(median.toFixed(2)), count: prices.length, checkedAt: new Date().toISOString(), searchUrl, listings: listings.slice(0, 5) };
}

export async function syncCatalogSources(db: D1Database) {
  const sources = [
    { name: 'egmont', url: 'https://www.lustiges-taschenbuch.de/news' },
    { name: 'duckipedia', url: 'https://de.duckipedia.org/Ausgabenliste_Lustiges_Taschenbuch' },
  ];
  const results: Array<{ source: string; records: number }> = [];
  const values = new Map<string, { egmont?: { title: string; url: string }; duckipedia?: { title: string; url: string } }>();
  for (const source of sources) {
    const response = await fetch(source.url, { headers: { 'user-agent': 'LTB-Bibliothek-Katalogabgleich/1.0' } });
    if (!response.ok) { results.push({ source: source.name, records: 0 }); continue; }
    const html = await response.text();
    const found = new Map<string, string>();
    const dates = new Map<string, string>();
    const reprints = new Map<string, string>();
    const originalPrices = new Map<string, string>();
    const decode = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (source.name === 'duckipedia') {
      const rowPattern = /<tr[\s\S]*?<\/tr>/gi;
      let row: RegExpExecArray | null;
      while ((row = rowPattern.exec(html))) {
        const numberMatch = row[0].match(/title=["']LTB\s+(\d{1,4})["'][^>]*>\s*LTB\s+\d+/i);
        if (!numberMatch) continue;
        const number = Number(numberMatch[1]);
        const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => decode(cell[1]));
        const title = cells[1];
        const reprint = cells[2];
        const date = cells[3];
        const originalPrice = cells[4];
        if (number >= 1 && number <= 618 && title) { found.set(`main:${number}`, title); if (date) dates.set(`main:${number}`, date); if (reprint) reprints.set(`main:${number}`, reprint); if (originalPrice) originalPrices.set(`main:${number}`, originalPrice); }
      }
    } else {
      const pattern = /LTB\s+(\d{1,4})[^<]{0,240}(?:>|\s)([^<]{3,120})</gi;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(html))) {
        const number = Number(match[1]);
        if (number < 1 || number > 618) continue;
        const title = decode(match[2]);
        if (title && !found.has(`main:${number}`)) found.set(`main:${number}`, title);
      }
    }
    if (source.name === 'egmont') {
      const sidePattern = /<a[^>]+href="(?:https?:\/\/www\.lustiges-taschenbuch\.de)?\/ausgaben\/nebenreihen\/([^"/]+)\/band-(\d+)"[\s\S]{0,900}?<span[^>]*class="[^"]*field--name-title[^"]*"[^>]*>([^<]+)<\/span>/gi;
      const parseSidePage = (pageHtml: string) => { let sideMatch: RegExpExecArray | null; sidePattern.lastIndex = 0; while ((sideMatch = sidePattern.exec(pageHtml))) { const seriesId = OFFICIAL_SERIES_SLUGS[decodeURIComponent(sideMatch[1]).toLowerCase()]; const number = Number(sideMatch[2]); const title = sideMatch[3].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim(); const date = sideMatch[0].match(/datetime="([^"]+)"/i)?.[1]; if (seriesId && Number.isInteger(number) && number > 0 && title) { const key = `${seriesId}:${number}`; found.set(key, title); if (date) dates.set(key, date); } } };
      parseSidePage(html);
      const dayBucket = Math.floor(Date.now() / 86_400_000) % 3;
      const categorySlugs = Object.keys(OFFICIAL_SERIES_SLUGS).filter((_, index) => index % 3 === dayBucket);
      const categoryPages = await Promise.all(categorySlugs.map(async slug => { const page = await fetch(`https://www.lustiges-taschenbuch.de/ausgaben/nebenreihen/${slug}`, { headers: { 'user-agent': 'LTB-Bibliothek-Katalogabgleich/1.0' } }); return page.ok ? page.text() : ''; }));
      for (const pageHtml of categoryPages) if (pageHtml) parseSidePage(await pageHtml);
    }
    for (const [editionKey, title] of found) {
      const publicationDate = dates.get(editionKey) ?? null;
      const printYear = publicationDate ? Number(publicationDate.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? '') || null : null;
      await db.prepare('INSERT INTO catalog_sources (edition_key, source_name, source_url, title, reprint_title, original_price, publication_date, print_year, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(edition_key, source_name) DO UPDATE SET source_url = excluded.source_url, title = excluded.title, reprint_title = excluded.reprint_title, original_price = excluded.original_price, publication_date = excluded.publication_date, print_year = excluded.print_year, fetched_at = CURRENT_TIMESTAMP').bind(editionKey, source.name, source.url, title, reprints.get(editionKey) ?? null, originalPrices.get(editionKey) ?? null, publicationDate, printYear).run();
      const current = values.get(editionKey) ?? {}; current[source.name as 'egmont' | 'duckipedia'] = { title, url: source.url }; values.set(editionKey, current);
    }
    results.push({ source: source.name, records: found.size });
  }
  for (const [editionKey, value] of values) if (value.egmont && value.duckipedia && value.egmont.title.toLowerCase() !== value.duckipedia.title.toLowerCase()) await db.prepare('INSERT INTO catalog_conflicts (edition_key, field_name, egmont_value, duckipedia_value) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM catalog_conflicts WHERE edition_key = ? AND field_name = ? AND status = \'open\')').bind(editionKey, 'title', value.egmont.title, value.duckipedia.title, editionKey, 'title').run();
  return { sources: results, conflicts: (await db.prepare("SELECT COUNT(*) AS count FROM catalog_conflicts WHERE status = 'open'").first<{ count: number }>())?.count ?? 0, syncedAt: new Date().toISOString() };
}

async function lookupIsbn(isbn: string, db: D1Database) {
  const normalized = isbn.replace(/[^0-9X]/gi, '').toUpperCase();
  if (!/^(?:\d{9}[\dX]|\d{13})$/.test(normalized)) throw new Error('Ungültige ISBN. Bitte ISBN-10 oder ISBN-13 scannen.');
  const response = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(normalized)}&format=json&jscmd=data`, { headers: { 'user-agent': 'LTB-Bibliothek/1.0' } });
  if (!response.ok) throw new Error(`ISBN-Dienst nicht erreichbar (${response.status}).`);
  const data = await response.json() as Record<string, { title?: string; publish_date?: string; publishers?: Array<{ name?: string }>; url?: string }>;
  const book = data[`ISBN:${normalized}`];
  if (!book) return { isbn: normalized, found: false, candidates: [] };
  const title = book.title ?? '';
  const yearMatch = (book.publish_date ?? '').match(/(?:19|20)\d{2}/);
  const volumeMatch = title.match(/(?:lustiges taschenbuch|ltb)\s*[-#: ]*0*(\d{1,4})\b/i);
  const candidates = volumeMatch && Number(volumeMatch[1]) <= MAIN_SERIES_LAST_NUMBER ? [{ editionKey: `main:${Number(volumeMatch[1])}`, title: `LTB ${Number(volumeMatch[1])}` }] : title ? (await db.prepare("SELECT edition_key AS editionKey, title FROM catalog_sources WHERE source_name = 'egmont' AND lower(title) LIKE ? ORDER BY fetched_at DESC LIMIT 10").bind(`%${title.toLowerCase().slice(0, 40)}%`).all<{ editionKey: string; title: string }>()).results : [];
  return { isbn: normalized, found: true, title, publishYear: yearMatch ? Number(yearMatch[0]) : null, publisher: book.publishers?.[0]?.name ?? null, sourceUrl: book.url ?? null, candidates };
}

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  const secureCookie = url.protocol === 'https:';
  const path = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (path === '/health' && request.method === 'GET') return json({ ok: true });
  if (path === '/ebay/notifications') {
    if (!env.EBAY_VERIFICATION_TOKEN) return json({ error: 'eBay Verification Token ist noch nicht konfiguriert.' }, 503);
    if (request.method === 'GET') {
      const challengeCode = new URL(request.url).searchParams.get('challenge_code');
      if (!challengeCode) return json({ error: 'challenge_code fehlt.' }, 400);
      const endpoint = 'https://ltb-bibliothek.squora.workers.dev/api/ebay/notifications';
      const responseHash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${challengeCode}${env.EBAY_VERIFICATION_TOKEN}${endpoint}`)));
      return json({ challengeResponse: hex(responseHash) });
    }
    if (request.method === 'POST') return new Response(null, { status: 204 });
    return json({ error: 'Methode nicht erlaubt.' }, 405);
  }

  const publicShare = path.match(/^\/share\/([^/]+)$/);
  if (publicShare && request.method === 'GET') {
    const link = await env.DB.prepare('SELECT token, user_id, kind, expires_at FROM share_links WHERE token = ? LIMIT 1').bind(publicShare[1]).first<{ token: string; user_id: string; kind: string; expires_at: number | null }>();
    if (!link || (link.expires_at !== null && link.expires_at <= Math.floor(Date.now() / 1000))) return json({ error: 'Link nicht gefunden oder abgelaufen.' }, 404);
    const rows = await env.DB.prepare('SELECT edition_key, condition, location, notes FROM collection_entries WHERE user_id = ? AND owned = ? ORDER BY edition_key').bind(link.user_id, link.kind === 'wishlist' ? 0 : 1).all<any>();
    return json({ kind: link.kind, items: rows.results });
  }

  if (path === '/auth/login' && request.method === 'POST') {
    const input = await body(request);
    const email = typeof input?.email === 'string' ? input.email.toLowerCase().trim() : '';
    const password = typeof input?.password === 'string' ? input.password : '';
    const row = await env.DB.prepare('SELECT id, email, display_name, password_hash FROM users WHERE email = ? LIMIT 1').bind(email).first<User & { password_hash: string }>();
    if (!row || !(await verifyPassword(password, row.password_hash))) return json({ error: 'E-Mail oder Passwort ist nicht korrekt.' }, 401);
    const user: User = { id: row.id, email: row.email, display_name: row.display_name };
    const session = await createSession(env.DB, user);
    return json(userResponse(user), 200, { 'set-cookie': cookie('ltb_session', session.token, SESSION_TTL_SECONDS, secureCookie) });
  }

  if (path === '/auth/logout' && request.method === 'POST') {
    const sessionUser = await currentUser(request, env.DB);
    if (sessionUser) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hex(await digest(sessionUser.token))).run();
    return json({ ok: true }, 200, { 'set-cookie': cookie('ltb_session', '', 0, secureCookie) });
  }

  const user = await currentUser(request, env.DB);
  if (!user) return json({ error: 'Nicht authentifiziert.' }, 401);
  const isbnMatch = path.match(/^\/isbn\/([0-9Xx-]+)$/);
  if (isbnMatch && request.method === 'GET') {
    try { return json(await lookupIsbn(isbnMatch[1], env.DB)); } catch (error) { return json({ error: error instanceof Error ? error.message : 'ISBN konnte nicht geprüft werden.' }, 400); }
  }
  if (path === '/catalog/sync' && request.method === 'POST') return json(await syncCatalogSources(env.DB));
  if (path === '/catalog/official' && request.method === 'GET') {
    const rows = await env.DB.prepare("SELECT edition_key AS editionKey, title, reprint_title AS reprintTitle, original_price AS originalPrice, print_year AS printYear, publication_date AS publicationDate, source_url AS sourceUrl, fetched_at AS fetchedAt FROM catalog_sources WHERE source_name = 'duckipedia' ORDER BY edition_key LIMIT 3000").all<any>();
    return json({ items: rows.results });
  }
  if (path === '/catalog/conflicts' && request.method === 'GET') return json(await env.DB.prepare("SELECT conflict_id AS id, edition_key AS editionKey, field_name AS field, egmont_value AS egmont, duckipedia_value AS duckipedia, status, created_at AS createdAt FROM catalog_conflicts WHERE status = 'open' ORDER BY created_at DESC LIMIT 200").all<any>());
  const ebayMatch = path.match(/^\/ebay\/average\/(\d+)$/);
  if (ebayMatch && request.method === 'GET') {
    const editionId = Number(ebayMatch[1]);
    if (!Number.isInteger(editionId) || editionId < 1 || editionId > MAIN_SERIES_LAST_NUMBER) return json({ error: 'Ungültige Ausgabe.' }, 400);
    try { const params = new URL(request.url).searchParams; return json(await ebayAverage(editionId, env, user.id, params.get('title') ?? undefined, params.get('query') ?? undefined)); } catch (error) { console.error('eBay valuation failed', error); const message = error instanceof Error ? error.message : 'eBay-Wert konnte nicht ermittelt werden.'; return json({ error: message }, message.includes('429') ? 429 : 502); }
  }
  if (path === '/ebay/average' && request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const editionKey = params.get('editionKey') ?? '';
    const editionId = Number(params.get('editionId'));
    if (!/^[a-z0-9-]+:\d+$/.test(editionKey) || !Number.isInteger(editionId) || editionId < 1) return json({ error: 'Ungültiger Katalogeintrag.' }, 400);
    try { return json(await ebayAverage(editionId, env, user.id, params.get('title') ?? undefined, params.get('query') ?? undefined, editionKey)); } catch (error) { console.error('eBay valuation failed', error); const message = error instanceof Error ? error.message : 'eBay-Wert konnte nicht ermittelt werden.'; return json({ error: message }, message.includes('429') ? 429 : 502); }
  }
  if (path === '/ebay/prices' && request.method === 'GET') {
    const ids = (new URL(request.url).searchParams.get('editionIds') ?? '').split(',').map(value => value.trim()).filter(value => /^[a-z0-9-]+:\d+$/.test(value)).slice(0, 100);
    if (!ids.length) return json({ items: [] });
    const placeholders = ids.map(() => '?').join(',');
    const rows = await env.DB.prepare(`SELECT edition_key AS editionKey, average, median, listing_count AS count, checked_at AS checkedAt FROM price_snapshots WHERE user_id = ? AND edition_key IN (${placeholders}) AND snapshot_id IN (SELECT MAX(snapshot_id) FROM price_snapshots WHERE user_id = ? GROUP BY edition_key)`).bind(user.id, ...ids, user.id).all<any>();
    return json({ items: rows.results });
  }
  const historyMatch = path.match(/^\/price-history\/(.+)$/);
  if (historyMatch && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT average, median, listing_count AS count, checked_at FROM price_snapshots WHERE user_id = ? AND edition_key = ? ORDER BY checked_at DESC LIMIT 30').bind(user.id, decodeURIComponent(historyMatch[1])).all<any>();
    return json({ items: rows.results });
  }
  if (path === '/session' && request.method === 'GET') return json(userResponse(user));
  if (path === '/collection' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT item_id, edition_key, owned, first_edition, print_id, condition, purchase_price, purchase_date, location, notes, isbn, publication_year, updated_at FROM collection_entries WHERE user_id = ? ORDER BY updated_at DESC, item_id DESC').bind(user.id).all<any>();
    return json({ items: rows.results.map(row => ({ id: row.item_id, editionKey: row.edition_key, owned: Boolean(row.owned), first: Boolean(row.first_edition), printId: row.print_id ?? 'original', condition: row.condition, purchasePrice: row.purchase_price, purchaseDate: row.purchase_date, location: row.location, notes: row.notes, isbn: row.isbn ?? '', publicationYear: row.publication_year, updatedAt: row.updated_at })) });
  }
  if (path === '/collection' && request.method === 'POST') {
    const input = await body(request);
    if (!input || typeof input.editionKey !== 'string' || input.editionKey.length < 3 || input.editionKey.length > 100) return json({ error: 'Ungültige Ausgabe.' }, 400);
    const result = await env.DB.prepare('INSERT INTO collection_entries (user_id, edition_key, owned, first_edition, print_id, condition, purchase_price, purchase_date, location, notes, isbn, publication_year, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) RETURNING item_id').bind(user.id, input.editionKey, input.owned === false ? 0 : 1, input.first === false ? 0 : 1, typeof input.printId === 'string' ? input.printId : 'original', typeof input.condition === 'string' ? input.condition : 'unbekannt', typeof input.purchasePrice === 'number' ? input.purchasePrice : null, typeof input.purchaseDate === 'string' ? input.purchaseDate : null, typeof input.location === 'string' ? input.location : '', typeof input.notes === 'string' ? input.notes : '', typeof input.isbn === 'string' ? input.isbn : '', Number.isInteger(input.publicationYear) && input.publicationYear >= 1900 && input.publicationYear <= 2100 ? input.publicationYear : null).first<{ item_id: number }>();
    return json({ ok: true, id: result?.item_id });
  }
  const itemMatch = path.match(/^\/collection\/item\/(\d+)$/);
  if (itemMatch && request.method === 'PUT') {
    const itemId = Number(itemMatch[1]);
    const input = await body(request);
    if (!Number.isInteger(itemId) || !input || typeof input.editionKey !== 'string') return json({ error: 'Ungültiger Sammlungseintrag.' }, 400);
    await env.DB.prepare('UPDATE collection_entries SET edition_key = ?, owned = ?, first_edition = ?, print_id = ?, condition = ?, purchase_price = ?, purchase_date = ?, location = ?, notes = ?, isbn = ?, publication_year = ?, updated_at = CURRENT_TIMESTAMP WHERE item_id = ? AND user_id = ?').bind(input.editionKey, input.owned === false ? 0 : 1, input.first === false ? 0 : 1, typeof input.printId === 'string' ? input.printId : 'original', typeof input.condition === 'string' ? input.condition : 'unbekannt', typeof input.purchasePrice === 'number' ? input.purchasePrice : null, typeof input.purchaseDate === 'string' ? input.purchaseDate : null, typeof input.location === 'string' ? input.location : '', typeof input.notes === 'string' ? input.notes : '', typeof input.isbn === 'string' ? input.isbn : '', Number.isInteger(input.publicationYear) && input.publicationYear >= 1900 && input.publicationYear <= 2100 ? input.publicationYear : null, itemId, user.id).run();
    return json({ ok: true });
  }
  if (itemMatch && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM collection_entries WHERE item_id = ? AND user_id = ?').bind(Number(itemMatch[1]), user.id).run();
    return json({ ok: true });
  }
  const legacyMatch = path.match(/^\/collection\/([^/]+)$/);
  if (legacyMatch && request.method === 'PUT') {
    const editionKey = decodeURIComponent(legacyMatch[1]);
    const input = await body(request);
    if (!input || typeof input.owned !== 'boolean') return json({ error: 'Ungültiger Sammlungseintrag.' }, 400);
    const existing = await env.DB.prepare('SELECT item_id FROM collection_entries WHERE user_id = ? AND edition_key = ? ORDER BY item_id LIMIT 1').bind(user.id, editionKey).first<{ item_id: number }>();
    if (existing) await env.DB.prepare('UPDATE collection_entries SET owned = ?, first_edition = ?, print_id = ?, updated_at = CURRENT_TIMESTAMP WHERE item_id = ? AND user_id = ?').bind(input.owned ? 1 : 0, input.first === false ? 0 : 1, typeof input.printId === 'string' ? input.printId : 'original', existing.item_id, user.id).run();
    else if (input.owned) await env.DB.prepare('INSERT INTO collection_entries (user_id, edition_key, owned, first_edition, print_id) VALUES (?, ?, 1, ?, ?)').bind(user.id, editionKey, input.first === false ? 0 : 1, typeof input.printId === 'string' ? input.printId : 'original').run();
    return json({ ok: true });
  }
  if (path === '/collection/export' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT edition_key, owned, first_edition, print_id, condition, purchase_price, purchase_date, location, notes, isbn, publication_year FROM collection_entries WHERE user_id = ? ORDER BY edition_key, item_id').bind(user.id).all<any>();
    const escapeCsv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = ['editionKey,owned,firstEdition,printId,condition,purchasePrice,purchaseDate,location,notes,isbn,publicationYear', ...rows.results.map(row => [row.edition_key, row.owned, row.first_edition, row.print_id, row.condition, row.purchase_price, row.purchase_date, row.location, row.notes, row.isbn, row.publication_year].map(escapeCsv).join(','))].join('\n');
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="ltb-sammlung.csv"', 'cache-control': 'no-store' } });
  }
  if (path === '/collection/import' && request.method === 'POST') {
    const input = await body(request);
    if (!Array.isArray(input?.rows)) return json({ error: 'Importdaten fehlen.' }, 400);
    let imported = 0;
    for (const row of input.rows.slice(0, 5000)) {
      if (!row || typeof row.editionKey !== 'string') continue;
      await env.DB.prepare('INSERT INTO collection_entries (user_id, edition_key, owned, first_edition, print_id, condition, purchase_price, purchase_date, location, notes, isbn, publication_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(user.id, row.editionKey, row.owned === false ? 0 : 1, row.firstEdition === false ? 0 : 1, typeof row.printId === 'string' ? row.printId : 'original', typeof row.condition === 'string' ? row.condition : 'unbekannt', typeof row.purchasePrice === 'number' ? row.purchasePrice : null, typeof row.purchaseDate === 'string' ? row.purchaseDate : null, typeof row.location === 'string' ? row.location : '', typeof row.notes === 'string' ? row.notes : '', typeof row.isbn === 'string' ? row.isbn : '', Number.isInteger(row.publicationYear) && row.publicationYear >= 1900 && row.publicationYear <= 2100 ? row.publicationYear : null).run();
      imported++;
    }
    return json({ ok: true, imported });
  }
  if (path === '/share' && request.method === 'POST') {
    const input = await body(request); const kind = input?.kind === 'trade' ? 'trade' : 'wishlist'; const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
    await env.DB.prepare('INSERT INTO share_links (token, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').bind(token, user.id, kind, Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30).run();
    return json({ token, url: `${url.origin}/share/${token}`, kind });
  }
  if (path === '/corrections' && request.method === 'POST') {
    const input = await body(request); if (!input || typeof input.editionKey !== 'string' || typeof input.message !== 'string' || input.message.length < 3) return json({ error: 'Korrekturhinweis fehlt.' }, 400);
    await env.DB.prepare('INSERT INTO correction_reports (user_id, edition_key, message) VALUES (?, ?, ?)').bind(user.id, input.editionKey, input.message.slice(0, 1000)).run();
    return json({ ok: true });
  }
  return json({ error: 'Nicht gefunden.' }, 404);
}

export async function handleApi(request: Request, env: Env) {
  try { return securityHeaders(request, await route(request, env)); }
  catch (error) { console.error(JSON.stringify({ event: 'api_error', message: error instanceof Error ? error.message : 'unknown' })); return securityHeaders(request, json({ error: 'Interner Serverfehler.' }, 500)); }
}

export const onRequest: PagesFunction<Env> = async context => handleApi(context.request, context.env);
