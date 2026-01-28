# Reception Proxy API

## Setup
1. Copy ".env.example" to ".env" and fill values.
2. Install deps: 
pm install.
3. Start: 
pm start (defaults to port 5050).

## Endpoints
- GET /api/appointments?limit=50
- POST /api/appointments

Proxies to Google Apps Script defined by GAS_APPOINTMENTS_URL with key GAS_SECRET.
