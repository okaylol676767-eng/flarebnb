const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8080);
const HOST = '127.0.0.1';
const ROOT = __dirname;

function loadLocalEnv() {
  if (!fs.existsSync(path.join(ROOT, '.env'))) return;
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*["']?([^"']*)["']?\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

loadLocalEnv();
const apiKey = process.env.GOOGLE_MAPS_API_KEY;

function send(res, status, body, contentType = 'application/json') {
  res.writeHead(status, {
    'Content-Type': `${contentType}; charset=utf-8`,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(contentType === 'application/json' ? JSON.stringify(body) : body);
}

function placesRequest(payload, fieldMask = ['places.id','places.displayName','places.formattedAddress','places.rating','places.userRatingCount','places.types','places.googleMapsUri']) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request({
      hostname: 'places.googleapis.com',
      path: '/v1/places:searchText',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask.join(',')
      }
    }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { return reject(new Error('Google Places returned invalid JSON')); }
        if (response.statusCode >= 400) return reject(new Error(parsed.error?.message || 'Google Places request failed'));
        resolve(parsed.places || []);
      });
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
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
  return {
    id: place.id,
    name: place.displayName?.text || 'Unnamed lodging',
    address: place.formattedAddress || location,
    rating: place.rating || null,
    reviewCount: place.userRatingCount || 0,
    category,
    mapsUrl: place.googleMapsUri || null
  };
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return send(res, 404, { error: 'Not found' });
  }
  const extension = path.extname(filePath);
  const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
  send(res, 200, fs.readFileSync(filePath), contentTypes[extension] || 'application/octet-stream');
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || HOST}`);
  if (requestUrl.pathname === '/api/places' || requestUrl.pathname === '/api/nearby') {
    if (!apiKey) return send(res, 503, { error: 'GOOGLE_MAPS_API_KEY is not configured. Copy .env.example to .env and export the key before starting the server.' });
    const location = requestUrl.searchParams.get('location')?.trim();
    const lat = Number(requestUrl.searchParams.get('lat'));
    const lng = Number(requestUrl.searchParams.get('lng'));
    if (requestUrl.pathname === '/api/places' && !location) return send(res, 400, { error: 'A destination is required.' });
    if (requestUrl.pathname === '/api/nearby' && (!Number.isFinite(lat) || !Number.isFinite(lng))) return send(res, 400, { error: 'Valid coordinates are required.' });
    try {
      const places = requestUrl.pathname === '/api/nearby' ? await requestNearby(lat, lng) : await requestPlaces(location);
      const label = requestUrl.pathname === '/api/nearby' ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : location;
      const listings = places.map(place => normalizePlace(place, label)).sort((a, b) => (b.rating || 0) - (a.rating || 0));
      return send(res, 200, { location: label, listings });
    } catch (error) {
      return send(res, 502, { error: error.message });
    }
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  serveStatic(req, res, requestUrl.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`FLARE_BNB running at http://${HOST}:${PORT}`);
  console.log(apiKey ? 'Google Places proxy: configured' : 'Google Places proxy: missing GOOGLE_MAPS_API_KEY');
});
