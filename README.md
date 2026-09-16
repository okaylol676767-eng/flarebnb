# FLARE_BNB

A cyber-brutalist lodging reconnaissance interface with simulated telemetry and an optional Google Places lodging index.

## Run locally

1. Enable **Places API (New)** in Google Cloud and create a restricted API key. Do not commit the key.
2. Copy `.env.example` to `.env` and set the rotated key:

   ```text
   GOOGLE_MAPS_API_KEY=your_rotated_key_here
   ```

3. Export the variable in your shell, or use a dotenv runner, then start the server:

   **PowerShell:**

   ```powershell
   $env:GOOGLE_MAPS_API_KEY="your_rotated_key_here"
   node server.js
   ```

   **macOS/Linux:**

   ```bash
   GOOGLE_MAPS_API_KEY="your_rotated_key_here" node server.js
   ```

4. Open http://127.0.0.1:8080.

The server keeps the API key on the backend and proxies destination and nearby lodging searches. Results are categorized as hotels, resorts, or vacation rentals and sorted by rating; the interface includes 4.0+ and 4.5+ rating filters.
