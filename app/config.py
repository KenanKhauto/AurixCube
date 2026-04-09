"""Application configuration."""

from pydantic import BaseModel
import os

class Settings(BaseModel):
    """Application settings."""

    app_name: str = "AurixCube"
    debug: bool = True

    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    use_redis_for_rooms: bool = os.getenv("USE_REDIS_FOR_ROOMS", "false").lower() == "true"
    room_ttl_seconds: int = int(os.getenv("ROOM_TTL_SECONDS", str(60 * 60 * 6)))


settings = Settings()