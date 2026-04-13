"""Abstract repository contract for room storage."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional


class RoomRepository(ABC):
    """
    Abstract contract for storing and retrieving game rooms.
    """

    @abstractmethod
    def save_room(self, room_code: str, room_data: dict) -> None:
        """
        Save or update a room.

        Args:
            room_code: Unique room code.
            room_data: Serialized room state.
        """
        raise NotImplementedError

    @abstractmethod
    def get_room(self, room_code: str) -> Optional[dict]:
        """
        Fetch a room by code.

        Args:
            room_code: Unique room code.

        Returns:
            Serialized room data or None if not found.
        """
        raise NotImplementedError

    @abstractmethod
    def delete_room(self, room_code: str) -> None:
        """
        Delete a room by code.

        Args:
            room_code: Unique room code.
        """
        raise NotImplementedError

    @abstractmethod
    def list_rooms(self) -> dict[str, dict]:
        """
        Return all currently stored rooms.
        """
        raise NotImplementedError
