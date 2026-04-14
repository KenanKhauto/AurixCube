"""Custom application exceptions."""


class GameError(Exception):
    """Base exception for game-related errors."""


class RoomNotFoundError(GameError):
    """Raised when a room cannot be found."""


class InvalidVoteError(GameError):
    """Raised when a vote is invalid."""


class PlayerNotFoundError(GameError):
    """Raised when a player is not found."""


class StaleRoomVersionError(GameError):
    """Raised when a room update is based on an outdated room version."""
