# FLARE_BNB

A cyber-brutalist lodging reconnaissance interface with simulated telemetry and Booking.com lodging search in sandbox or production mode.

## Run locally

1. Register as a Booking.com Managed Affiliate Partner and obtain your API token and Affiliate ID.
2. Copy `.env.example` to `.env` and set private credentials:

   ```text
   BOOKING_API_TOKEN=your_booking_token
   BOOKING_AFFILIATE_ID=your_affiliate_id
   BOOKING_API_MODE=sandbox
   ```

   Use `BOOKING_API_MODE=production` only after your affiliate integration is approved and tested. Google Places remains optional for nearby-location discovery.

3. Start the server. It automatically reads the local `.env` file:

   ```bash
   node server.js
   ```

   You can also provide `GOOGLE_MAPS_API_KEY` directly through your shell environment if preferred.

4. Open http://127.0.0.1:8080.

The server keeps credentials on the backend and proxies Booking.com destination resolution plus date-based accommodation availability. Results include open-for-booking status, prices, categories, ratings, review counts, and booking links; the interface includes 4.0+ and 4.5+ rating filters. The local default is sandbox mode; switch to production with `BOOKING_API_MODE=production`.

## Authorized catalog fallback

If Booking.com credentials are unavailable, searches automatically fall back to an authorized local catalog. Copy `data/listings.example.json` to `data/listings.json` and replace the example records with your authorized export. A CSV export is also supported at `data/listings.csv` using the same field names. Local catalog files are ignored by Git so private listings are not committed. Example records are clearly labeled in the interface and are not live inventory.
