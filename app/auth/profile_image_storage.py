"""Profile image storage backends."""

from __future__ import annotations

from pathlib import Path
import uuid


DEFAULT_AVATAR = "profile_img_default.png"
LEGACY_PROFILE_UPLOAD_PREFIX = "profile_uploads/"
MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_PROFILE_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def get_profile_image_content_type(extension: str) -> str:
    mapping = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    return mapping.get(extension.lower(), "application/octet-stream")


class LocalProfileImageStorage:
    """Store profile images on local filesystem."""

    def __init__(self, upload_dir: str, public_base_url: str):
        self.upload_dir = Path(upload_dir)
        self.public_base_url = public_base_url.rstrip("/")
        self.upload_dir.mkdir(parents=True, exist_ok=True)

    def store(self, user_id: int, image_bytes: bytes, extension: str, old_image: str | None = None) -> str:
        filename = f"user_{user_id}_{uuid.uuid4().hex}{extension.lower()}"
        file_path = self.upload_dir / filename

        self.upload_dir.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(image_bytes)

        self.delete(old_image)
        return f"{self.public_base_url}/{filename}"

    def delete(self, image_value: str | None) -> None:
        filename = self._extract_managed_filename(image_value)
        if not filename:
            return

        old_path = self.upload_dir / filename
        if old_path.exists() and old_path.is_file():
            old_path.unlink()

    def _extract_managed_filename(self, image_value: str | None) -> str | None:
        if not image_value:
            return None

        value = image_value.strip()
        if not value:
            return None

        managed_prefixes = (
            f"{self.public_base_url}/",
            "/static/images/profile_uploads/",
            LEGACY_PROFILE_UPLOAD_PREFIX,
        )
        for prefix in managed_prefixes:
            if value.startswith(prefix):
                candidate = value[len(prefix):].split("/")[-1]
                return candidate or None
        return None


class S3ProfileImageStorage:
    """Store profile images in S3-compatible object storage."""

    def __init__(
        self,
        bucket: str,
        region: str,
        prefix: str = "profile_uploads",
        public_base_url: str | None = None,
    ):
        self.bucket = bucket
        self.region = region
        self.prefix = (prefix or "").strip("/")
        self.public_base_url = (public_base_url or "").rstrip("/")
        self._client = None

    @property
    def client(self):
        if self._client is None:
            try:
                import boto3  # type: ignore
            except ImportError as exc:
                raise ValueError("S3 profile storage requires boto3 to be installed.") from exc
            self._client = boto3.client("s3", region_name=self.region)
        return self._client

    def store(self, user_id: int, image_bytes: bytes, extension: str, old_image: str | None = None) -> str:
        filename = f"user_{user_id}_{uuid.uuid4().hex}{extension.lower()}"
        key = f"{self.prefix}/{filename}" if self.prefix else filename
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=image_bytes,
            ContentType=get_profile_image_content_type(extension),
        )
        self.delete(old_image)
        return self._to_public_url(key)

    def delete(self, image_value: str | None) -> None:
        key = self._extract_managed_key(image_value)
        if not key:
            return
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except Exception:
            pass

    def _to_public_url(self, key: str) -> str:
        if self.public_base_url:
            return f"{self.public_base_url}/{key}"
        return f"https://{self.bucket}.s3.{self.region}.amazonaws.com/{key}"

    def _extract_managed_key(self, image_value: str | None) -> str | None:
        if not image_value:
            return None

        value = image_value.strip()
        if not value:
            return None

        if self.public_base_url and value.startswith(f"{self.public_base_url}/"):
            return value[len(self.public_base_url) + 1:]

        canonical_base = f"https://{self.bucket}.s3.{self.region}.amazonaws.com/"
        if value.startswith(canonical_base):
            return value[len(canonical_base):]

        if self.prefix and value.startswith(f"{self.prefix}/"):
            return value

        return None

