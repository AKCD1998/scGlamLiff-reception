# LIFF Frontend Drop-In Directory

Place the built LIFF frontend bundle here when you want this backend to serve the frontend from the same origin under `/liff/`.

Expected contents:
- `index.html`
- `assets/`

This directory is part of a staged rollout plan:
1. keep the existing GitHub Pages deployment active
2. copy a backend-hosted LIFF build into this directory
3. deploy the backend
4. verify `https://<backend-host>/liff/`
5. only then switch the LIFF endpoint in LINE Developers Console

Do not commit secret env values or runtime-only generated files here.
