const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8080);
const HOST = '127.0.0.1';
const ROOT = __dirname;

function loadLocalEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*["']?([^"']*)["']?\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

loadLocalEnv();
const googleKey = process.env.GOOGLE_MAPS_API_KEY;
const bookingToken = process.env.BOOKING_API_TOKEN;
const bookingAffiliateId = process.env.BOOKING_AFFILIATE_ID;
const bookingMode = process.env.BOOKING_API_MODE === 'production' ? 'production' : 'sandbox';
const bookingApiVersion = process.env.BOOKING_API_VERSION || '3.2';
const bookingHost = bookingMode === 'production' ? 'demandapi.booking.com' : 'demandapi-sandbox.booking.com';
const bookingCountry = (process.env.BOOKING_BOOKER_COUNTRY || 'us').toLowerCase();
const bookingCurrency = (process.env.BOOKING_CURRENCY || 'USD').toUpperCase();

function send(res, status, body, contentType = 'application/json') {
  res.writeHead(status, {
    'Content-Type': `${contentType}; charset=utf-8`,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(contentType === 'application/json' ? JSON.stringify(body) : body);
}

function jsonRequest({ hostname, path: requestPath, headers = {}, payload }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request({ hostname, path: requestPath, method: 'POST', headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...headers
    }}, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { return reject(new Error('API returned invalid JSON')); }
        if (response.statusCode >= 400) return reject(new Error(parsed.error?.message || parsed.message || 'API request failed'));
        resolve(parsed);
      });
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function placesRequest(payload, fieldMask = ['places.id','places.displayName','places.formattedAddress','places.rating','places.userRatingCount','places.types','places.googleMapsUri']) {
  return jsonRequest({ hostname: 'places.googleapis.com', path: '/v1/places:searchText', headers: {
    'X-Goog-Api-Key': googleKey,
    'X-Goog-FieldMask': fieldMask.join(',')
  }, payload });
}

function requestPlaces(location) {
  return placesRequest({ textQuery: `${location} hotels and vacation rentals`, pageSize: 20, languageCode: 'en' });
}

function requestNearby(lat, lng) {
  return placesRequest({ includedTypes: ['hotel'], maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } } });
}

function normalizePlace(place, location) {
  const types = place.types || [];
  const category = types.includes('hotel') ? 'HOTEL' : types.includes('resort_hotel') ? 'RESORT' : 'VACATION_RENTAL';
  return { id: place.id, name: place.displayName?.text || 'Unnamed lodging', address: place.formattedAddress || location, rating: place.rating || null, reviewCount: place.userRatingCount || 0, category, mapsUrl: place.googleMapsUri || null };
}

function bookingHeaders() {
  return { Authorization: `Bearer ${bookingToken}`, 'X-Affiliate-Id': bookingAffiliateId };
}

async function bookingAutocomplete(query) {
  const result = await jsonRequest({ hostname: bookingHost, path: `/${bookingApiVersion}/common/autocomplete`, headers: bookingHeaders(), payload: {
    query: query.slice(0, 200), language: 'en-gb', country: bookingCountry
  } });
  const suggestion = (result.data || []).find(item => item.dest_type === 'city' || item.type === 'city') || result.data?.[0];
  if (!suggestion?.dest_id) throw new Error('Booking.com could not resolve that destination.');
  return suggestion;
}

async function bookingSearch({ location, checkin, checkout, adults, rooms }) {
  if (!bookingToken || !bookingAffiliateId) throw new Error('Booking.com credentials are not configured. Set BOOKING_API_TOKEN and BOOKING_AFFILIATE_ID in .env.');
  const destination = await bookingAutocomplete(location);
  const result = await jsonRequest({ hostname: bookingHost, path: `/${bookingApiVersion}/accommodations/search`, headers: bookingHeaders(), payload: {
    booker: { country: bookingCountry, platform: 'desktop' },
    checkin, checkout, city: Number(destination.dest_id), currency: bookingCurrency,
    extras: ['products'],
    guests: { number_of_adults: adults, number_of_rooms: rooms },
    rows: 20
  } });
  return { destination: destination.name || location, listings: (result.data || []).map(item => normalizeBooking(item, destination.name || location)) };
}

function normalizeBooking(item, location) {
  const property = item.property || item.accommodation || {};
  const price = item.price || item.cheapest_room?.price || {};
  const rawReview = item.review_score ?? item.reviewScore ?? property.review_score;
  const review = rawReview == null ? null : Number(rawReview) > 5 ? Number(rawReview) / 2 : Number(rawReview);
  const name = property.name || item.name || `Booking.com stay in ${location}`;
  const type = property.type || item.accommodation_type || item.type || 'ACCOMMODATION';
  const bookingUrl = item.url || item.booking_url || property.url || null;
  return { id: String(property.id || item.id || name), name, address: property.address || item.address || location, rating: review, reviewCount: Number(item.review_count || item.reviewCount || property.review_count || 0), category: String(type).replace(/_/g, ' ').toUpperCase(), price: price.amount || price.total || null, currency: price.currency || bookingCurrency, available: true, mapsUrl: bookingUrl };
}

function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, { error: 'Not found' });
  const extension = path.extname(filePath);
  const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
  send(res, 200, fs.readFileSync(filePath), contentTypes[extension] || 'application/octet-stream');
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || HOST}`);
  if (requestUrl.pathname === '/api/booking/search') {
    if (!bookingToken || !bookingAffiliateId) return send(res, 503, { error: 'Booking.com credentials are not configured. Set BOOKING_API_TOKEN and BOOKING_AFFILIATE_ID in .env.' });
    const location = requestUrl.searchParams.get('location')?.trim();
    const checkin = requestUrl.searchParams.get('checkin');
    const checkout = requestUrl.searchParams.get('checkout');
    const adults = Math.max(1, Number(requestUrl.searchParams.get('adults') || 2));
    const rooms = Math.max(1, Number(requestUrl.searchParams.get('rooms') || 1));
    if (!location || !checkin || !checkout) return send(res, 400, { error: 'Location, check-in, and check-out are required.' });
    try { const result = await bookingSearch({ location, checkin, checkout, adults, rooms }); return send(res, 200, { ...result, source: 'booking.com', mode: bookingMode }); } catch (error) { return send(res, 502, { error: error.message, source: 'booking.com', mode: bookingMode }); }
  }
  if (requestUrl.pathname === '/api/places' || requestUrl.pathname === '/api/nearby') {
    if (!googleKey) return send(res, 503, { error: 'GOOGLE_MAPS_API_KEY is not configured.' });
    const location = requestUrl.searchParams.get('location')?.trim();
    const lat = Number(requestUrl.searchParams.get('lat'));
    const lng = Number(requestUrl.searchParams.get('lng'));
    if (requestUrl.pathname === '/api/places' && !location) return send(res, 400, { error: 'A destination is required.' });
    if (requestUrl.pathname === '/api/nearby' && (!Number.isFinite(lat) || !Number.isFinite(lng))) return send(res, 400, { error: 'Valid coordinates are required.' });
    try { const places = requestUrl.pathname === '/api/nearby' ? (await requestNearby(lat, lng)).places || [] : (await requestPlaces(location)).places || []; const label = requestUrl.pathname === '/api/nearby' ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : location; return send(res, 200, { location: label, listings: places.map(place => normalizePlace(place, label)).sort((a, b) => (b.rating || 0) - (a.rating || 0)), source: 'google-places' }); } catch (error) { return send(res, 502, { error: error.message }); }
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  serveStatic(res, requestUrl.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`FLARE_BNB running at http://${HOST}:${PORT}`);
  console.log(`Booking.com API: ${bookingToken && bookingAffiliateId ? bookingMode : 'credentials missing'}`);
  console.log(`Google Places API: ${googleKey ? 'configured' : 'not configured'}`);
});
