# Polymarket Weather Notifications

Node.js bot that checks Weather.com hourly forecast for configured regions and emails you when today's max temperature or its hourly occurrence count changes.

## What it does

- Runs on GitHub Actions every 5 minutes (GitHub minimum schedule cadence).
- Only executes logic during `08:00-17:59` in `Europe/Paris` timezone.
- For each region in `REGIONS_JSON`:
  - Fetches `v3/wx/forecast/hourly/2day`
  - Filters entries for **today** (`Europe/Paris` date)
  - Computes:
    - `maxTemp`
    - `maxTempCount`
- Sends a Gmail alert when:
  - It is the first successful run of the day for a region, or
  - `maxTemp` or `maxTempCount` changes
- Persists state in `.cache/weather_state.json` via GitHub Actions cache.

## Environment variables

Set these as GitHub repository secrets:

- `WEATHER_API_KEY`
- `REGIONS_JSON`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_SENDER`
- `ALERT_RECIPIENT`

Example `REGIONS_JSON`:

```json
[
  {"id":"paris_cdg","name":"Paris CDG","geocode":"49.017,2.594"},
  {"id":"london","name":"London","geocode":"51.507,-0.128"}
]
```

## Local run

```bash
npm install
npm test
node script.js
```

## Gmail API setup (OAuth refresh token)

1. Create a Google Cloud project and enable Gmail API.
2. Configure OAuth consent screen.
3. Create OAuth client credentials (`client_id`, `client_secret`).
4. Generate a refresh token for scope: `https://www.googleapis.com/auth/gmail.send`.
5. Store credentials in GitHub Secrets.

## Notes

- If all regions fail in a run, the script exits with non-zero status.
- If some regions fail, successful regions are still processed and state is saved.
