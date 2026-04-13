"""Redis-backed room repository implementation."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

import redis

from app.repositories.room_repository import RoomRepository


class RedisRoomRepository(RoomRepository):
    """
    Redis-backed repository for room storage.

    Rooms are stored as JSON strings under a prefixed key.
    """

    def __init__(
        self,
        redis_url: str,
        key_prefix: str = "room:",
        ttl_seconds: int = 60 * 60 * 6,
    ) -> None:
        """
        Initialize Redis room repository.

        Args:
            redis_url: Redis connection URL.
            key_prefix: Prefix used for room keys.
            ttl_seconds: Expiration time for rooms in seconds.
        """
        self._client = redis.Redis.from_url(redis_url, decode_responses=True)
        self._key_prefix = key_prefix
        self._ttl_seconds = ttl_seconds

    def _make_key(self, room_code: str) -> str:
        """
        Build the Redis key for a room.
        """
        return f"{self._key_prefix}{room_code}"

    def save_room(self, room_code: str, room_data: dict) -> None:
        """
        Save or update a room in Redis.
        """
        key = self._make_key(room_code)
        existing = self.get_room(room_code) or {}
        now_iso = datetime.now(timezone.utc).isoformat()
        payload_data = dict(room_data)
        payload_data["_meta_created_at"] = existing.get("_meta_created_at", now_iso)
        payload_data["_meta_updated_at"] = now_iso
        payload = json.dumps(payload_data)
        self._client.set(name=key, value=payload, ex=self._ttl_seconds)

    def get_room(self, room_code: str) -> Optional[dict]:
        """
        Retrieve a room from Redis.
        """
        key = self._make_key(room_code)
        payload = self._client.get(key)
        if payload is None:
            return None
        return json.loads(payload)

    def delete_room(self, room_code: str) -> None:
        """
        Delete a room from Redis.
        """
        key = self._make_key(room_code)
        self._client.delete(key)

    def list_rooms(self) -> dict[str, dict]:
        """
        Return all rooms currently stored in Redis with this key prefix.
        """
        rooms: dict[str, dict] = {}
        for key in self._client.scan_iter(match=f"{self._key_prefix}*"):
            payload = self._client.get(key)
            if payload is None:
                continue
            room_code = key.replace(self._key_prefix, "", 1)
            try:
                rooms[room_code] = json.loads(payload)
            except json.JSONDecodeError:
                continue
        return rooms
