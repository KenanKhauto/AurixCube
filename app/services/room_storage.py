"""Room storage provider and repository selection."""

from __future__ import annotations

from functools import lru_cache

from app.config import settings
from app.repositories.in_memory_room_repository import InMemoryRoomRepository
from app.repositories.redis_room_repository import RedisRoomRepository
from app.repositories.room_repository import RoomRepository


class PrefixedRoomRepository(RoomRepository):
    """Game-scoped room repository wrapper using a stable key prefix."""

    def __init__(self, base_repository: RoomRepository, scope: str) -> None:
        self._base_repository = base_repository
        self._scope = scope
        self._scope_prefix = f"{scope}:"

    def _scoped_code(self, room_code: str) -> str:
        return f"{self._scope_prefix}{room_code}"

    def save_room(
        self,
        room_code: str,
        room_data: dict,
        expected_room_version: int | None = None,
    ) -> bool:
        payload = dict(room_data)
        payload.setdefault("game_type", self._scope)
        return self._base_repository.save_room(
            self._scoped_code(room_code),
            payload,
            expected_room_version=expected_room_version,
        )

    def get_room(self, room_code: str) -> dict | None:
        return self._base_repository.get_room(self._scoped_code(room_code))

    def delete_room(self, room_code: str) -> None:
        self._base_repository.delete_room(self._scoped_code(room_code))

    def list_rooms(self) -> dict[str, dict]:
        rooms = {}
        for scoped_code, room_data in self._base_repository.list_rooms().items():
            if scoped_code.startswith(self._scope_prefix):
                rooms[scoped_code[len(self._scope_prefix):]] = room_data
        return rooms


@lru_cache(maxsize=1)
def _get_base_room_repository() -> RoomRepository:
    """
    Return the configured room repository implementation.

    Uses Redis when enabled, otherwise falls back to in-memory storage.
    """
    if settings.use_redis_for_rooms:
        return RedisRoomRepository(
            redis_url=settings.redis_url,
            ttl_seconds=settings.room_ttl_seconds,
        )

    return InMemoryRoomRepository()


def get_room_repository(scope: str | None = None) -> RoomRepository:
    """
    Return the configured room repository implementation.

    When ``scope`` is provided, room keys are transparently namespaced.
    """
    base_repository = _get_base_room_repository()
    if not scope:
        return base_repository
    return PrefixedRoomRepository(base_repository, scope)
