# Render Deployment

## Overview
This repo is prepared for two separate Render web services.

- Service A: main Node backend
- Service B: Python OCR backend

Do not assume both processes run in one container. The Node backend still calls the Python OCR service over HTTP through `OCR_SERVICE_BASE_URL`.

## Service A: Main Node Backend

### Purpose
- Public backend for auth, appointments, branch-device registration, reporting, and OCR bridge endpoints.
- OCR-related public endpoints:
  - `GET /api/ocr/health`
  - `POST /api/ocr/receipt`

### Render Settings
- Service type: Web Service
- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`
- Primary Health Endpoint: `GET /api/health`
- OCR Debug Endpoint: `GET /api/ocr/health`

### Required Env Vars

#### Required To Boot
- `DATABASE_URL`
- `JWT_SECRET`
- `PORT` provided by Render

#### Required For Real OCR Bridge
- `OCR_SERVICE_BASE_URL`
- `OCR_SERVICE_ENABLED=true`
- `OCR_SERVICE_FALLBACK_TO_MOCK=false`

#### Required For Production Browser / LIFF Session Behavior
- `NODE_ENV=production`
- `FRONTEND_ORIGINS=https://akcd1998.github.io`
- `COOKIE_SAMESITE=none`
- `COOKIE_SECURE=true`

#### Required If LIFF Token Verification Is Used
- `LINE_LIFF_CHANNEL_ID` or `LINE_CHANNEL_ID`

## Service B: Python OCR Backend

### Purpose
- Runs the Python receipt OCR app consumed by the Node backend bridge.
- Repo source path:
  - `backend/services/ocr_python`

### Render Settings
- Service type: Web Service
- Root Directory: `backend/services/ocr_python`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health Endpoint: `GET /health`
- OCR Upload Endpoint: `POST /ocr/receipt`

### Required Env Vars
- `PORT` provided by Render

### Notes
- This Python app currently does not require custom OCR env vars.
- PaddleOCR model files may download on first real OCR request.

## Render Checklist

### 1. Create Python OCR Service First
- Create a new Render Web Service from repo `scGlamLiff-reception`
- Set Root Directory to `backend/services/ocr_python`
- Set Build Command to `pip install -r requirements.txt`
- Set Start Command to `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Deploy

### 2. Verify Python OCR Service
- Confirm `GET /health` returns `200`
- Confirm `POST /ocr/receipt` accepts multipart upload field `receipt`

### 3. Create Or Update Main Node Backend Service
- Use repo `scGlamLiff-reception`
- Set Root Directory to `backend`
- Set Build Command to `npm install`
- Set Start Command to `npm start`
- Set required env vars, especially:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `OCR_SERVICE_BASE_URL=<python-ocr-service-url>`
  - `OCR_SERVICE_ENABLED=true`
  - `OCR_SERVICE_FALLBACK_TO_MOCK=false`
  - `NODE_ENV=production`
  - `FRONTEND_ORIGINS=https://akcd1998.github.io`
  - `COOKIE_SAMESITE=none`
  - `COOKIE_SECURE=true`

### 4. Verify Main Node Backend
- Confirm `GET /api/health` returns `200`
- Confirm `GET /api/ocr/health` shows:
  - `routeMounted: true`
  - the expected `ocrServiceBaseUrl`
  - downstream OCR reachability data
- Confirm `POST /api/ocr/receipt` no longer fails because of a bad downstream URL

## Curl Verification

### Service A: Node Backend
```bash
curl -i https://<node-backend-url>/api/health
```

```bash
curl -i https://<node-backend-url>/api/ocr/health
```

```bash
curl -i -X POST https://<node-backend-url>/api/ocr/receipt
```

Expected:
- `/api/health` -> `200`
- `/api/ocr/health` -> `200`
- `/api/ocr/receipt` without a file -> `400` with `OCR_IMAGE_REQUIRED` if the route is mounted

### Service B: Python OCR Backend
```bash
curl -i https://<python-ocr-url>/health
```

```bash
curl -i -F "receipt=@receipt.jpg" https://<python-ocr-url>/ocr/receipt
```

Expected:
- `/health` -> `200`
- `/ocr/receipt` -> `200` with OCR payload for a valid image, or a structured OCR error if processing fails
