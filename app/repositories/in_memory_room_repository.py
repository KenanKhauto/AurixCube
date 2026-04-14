"""In-memory room repository implementation."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, Optional

from app.repositories.room_repository import RoomRepository


class InMemoryRoomRepository(RoomRepository):
    """
    Simple in-memory repository for room storage.

    Suitable for local development and testing.
    """

    def __init__(self) -> None:
        self._rooms: Dict[str, dict] = {}

    def save_room(
        self,
        room_code: str,
        room_data: dict,
        expected_room_version: int | None = None,
    ) -> bool:
        """
        Save or update a room in memory.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        existing = self._rooms.get(room_code, {})
        current_version = int(existing.get("room_version", 0)) if existing else 0
        if expected_room_version is not None and current_version != expected_room_version:
            return False
        payload = dict(room_data)
        payload["_meta_created_at"] = existing.get("_meta_created_at", now_iso)
        payload["_meta_updated_at"] = now_iso
        self._rooms[room_code] = payload
        return True

    def get_room(self, room_code: str) -> Optional[dict]:
        """
        Retrieve a room from memory.
        """
        return self._rooms.get(room_code)

    def delete_room(self, room_code: str) -> None:
        """
        Delete a room from memory.
        """
        self._rooms.pop(room_code, None)

    def list_rooms(self) -> dict[str, dict]:
        """
        Return all rooms currently in memory.
        """
        return dict(self._rooms)
