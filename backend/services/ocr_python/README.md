# Python OCR Service

## Purpose
- This folder is the backend-repo source of truth for the Python receipt OCR runtime.
- The active public Bill Verification OCR API stays unchanged in the Node backend:
  - `GET /api/ocr/health`
  - `POST /api/ocr/receipt`
- The old Python OCR copy in `scGlamLiFFF/scGlamLiFF/backend/services/ocr_python` is intentionally kept during migration as a temporary duplicate until deployment cutover is complete.

## Folder Layout
```text
backend/services/ocr_python/
  README.md
  requirements.txt
  app/
    __init__.py
    main.py
    services/
      __init__.py
      paddle_ocr_service.py
      preprocess_service.py
      receipt_parser.py
```

## HTTP Contract

### Health
- Method: `GET`
- Path: `/health`

### Receipt OCR
- Method: `POST`
- Path: `/ocr/receipt`
- Content type: `multipart/form-data`
- File field: `receipt`

## Render Service Setup
- Repo: `scGlamLiff-reception`
- Root Directory: `backend/services/ocr_python`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

## Local Run
```powershell
cd backend/services/ocr_python
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

## Required Environment Variables
- No custom OCR-specific env vars are required by this Python app source.
- Render must provide `PORT` for the start command.

## Dependency Notes
- The first OCR request may download PaddleOCR model files.
- Runtime dependencies are pinned in `requirements.txt`.
- This migration step copies the Python source into the backend repo without changing current frontend behavior or public backend route paths.

## Migration Status
- Source-of-truth location: `scGlamLiff-reception/backend/services/ocr_python`
- Temporary duplicate retained: `scGlamLiFFF/scGlamLiFF/backend/services/ocr_python`
- Public backend bridge still uses `OCR_SERVICE_BASE_URL`; deployment cutover to the new repo-owned Python service is a separate step.
