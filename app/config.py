"""Application configuration."""

from pathlib import Path
from pydantic import BaseModel
import os

class Settings(BaseModel):
    """Application settings."""

    app_name: str = "AurixCube"
    debug: bool = True
    session_secret_key: str = os.getenv("SESSION_SECRET_KEY", "change-this-in-production")

    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    use_redis_for_rooms: bool = os.getenv("USE_REDIS_FOR_ROOMS", "false").lower() == "true"
    room_ttl_seconds: int = int(os.getenv("ROOM_TTL_SECONDS", str(60 * 60 * 6)))

    profile_image_storage_backend: str = os.getenv("PROFILE_IMAGE_STORAGE_BACKEND", "local").lower()
    profile_image_local_dir: str = os.getenv(
        "PROFILE_IMAGE_LOCAL_DIR",
        str(Path(__file__).resolve().parent / "web" / "static" / "images" / "profile_uploads"),
    )
    profile_image_local_base_url: str = os.getenv("PROFILE_IMAGE_LOCAL_BASE_URL", "/static/images/profile_uploads")
    profile_image_s3_bucket: str = os.getenv("PROFILE_IMAGE_S3_BUCKET", "")
    profile_image_s3_region: str = os.getenv("PROFILE_IMAGE_S3_REGION", "us-east-1")
    profile_image_s3_prefix: str = os.getenv("PROFILE_IMAGE_S3_PREFIX", "profile_uploads")
    profile_image_s3_public_base_url: str = os.getenv("PROFILE_IMAGE_S3_PUBLIC_BASE_URL", "")


settings = Settings()
