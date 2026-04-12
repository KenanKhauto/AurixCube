# AurixCube

AurixCube is a modular browser-based game hub built with FastAPI and vanilla JavaScript.

It is designed to support multiple lightweight social games through a clean, maintainable architecture.  
The platform currently includes an Undercover-style game with room creation, joining, voting, and round management.

## Tech Stack

- FastAPI
- Jinja2
- Vanilla JavaScript
- HTML/CSS

## Features

- Modular game architecture
- Browser-based multiplayer room flow
- Persistent frontend profile name using localStorage
- Easy expansion for future games

## Run locally

```bash
pip install -r requirements.txt
python run.py
```

## Profile Image Storage

Profile images support two backends:

- `local` (default): stores files on disk.
- `s3`: stores files in an S3 bucket.

Environment variables:

- `PROFILE_IMAGE_STORAGE_BACKEND=local|s3`
- `PROFILE_IMAGE_LOCAL_DIR` (used when backend is `local`)
- `PROFILE_IMAGE_LOCAL_BASE_URL` (used when backend is `local`)
- `PROFILE_IMAGE_S3_BUCKET` (required when backend is `s3`)
- `PROFILE_IMAGE_S3_REGION`
- `PROFILE_IMAGE_S3_PREFIX`
- `PROFILE_IMAGE_S3_PUBLIC_BASE_URL` (optional CDN/base URL)

`docker-compose.yml` is configured with a named volume for local profile uploads so images survive container restarts/redeploys.

## License

AurixCube Proprietary License v1.0

This project is proprietary software. Unauthorized use, copying, modification, or distribution is strictly prohibited.
