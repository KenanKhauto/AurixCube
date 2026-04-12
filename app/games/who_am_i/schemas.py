"""Pydantic schemas for the Who Am I game API."""

from typing import List, Optional
from pydantic import BaseModel, Field


class CreateRoomRequest(BaseModel):
    """Request body for creating a room."""

    host_name: str = Field(..., min_length=1, max_length=50)
    max_player_count: int = Field(..., ge=2, le=12)
    categories: list[str] = Field(default_factory=list, max_length=12)
    character_id: str = "char1"

class JoinRoomRequest(BaseModel):
    """Request body for joining a room."""

    player_name: str = Field(..., min_length=1, max_length=50)
    character_id: str = "char1"


class UpdateCharacterRequest(BaseModel):
    player_id: str
    character_id: str

class RevealIdentityRequest(BaseModel):
    """Request body for revealing the current player's identity."""

    player_id: str


class ConfirmRevealRequest(BaseModel):
    """Request body for confirming reveal completion."""

    player_id: str


class SubmitGuessRequest(BaseModel):
    """Request body for submitting a guess."""

    player_id: str
    guess_text: str = Field(..., min_length=1, max_length=100)


class RestartRoomRequest(BaseModel):
    """Request body for restarting a room."""

    categories: list[str]


class UpdateCategoriesRequest(BaseModel):
    """Request body for updating waiting-room categories."""

    host_id: str
    categories: list[str] = Field(default_factory=list, max_length=12)


class LeaveRoomRequest(BaseModel):
    """Request body for leaving a room."""

    player_id: str


class DeleteRoomRequest(BaseModel):
    """Request body for deleting a room."""

    player_id: str


class RemovePlayerRequest(BaseModel):
    """Request body for removing a player."""

    host_id: str
    player_id_to_remove: str


class PlayerView(BaseModel):
    """Serializable player representation for API responses."""

    id: str
    name: str
    username: Optional[str] = None
    has_guessed_correctly: bool
    guess_count: int
    solved_order: Optional[int]
    character_id: str = "char1"


class RoomStateResponse(BaseModel):
    """Serialized room state."""

    room_code: str
    host_id: str
    categories: list[str]
    max_player_count: int
    started: bool
    ended: bool
    end_reason: Optional[str] = None

    reveal_phase_active: bool
    reveal_order: List[str]
    current_reveal_player_id: Optional[str]

    current_turn_player_id: Optional[str]
    active_turn_order: List[str]
    full_turn_order: List[str]
    turn_number: int

    players: List[PlayerView]


class RevealViewRequest(BaseModel):
    """Request body for getting the viewer-specific reveal state."""

    player_id: str

class PlayerKnowledgeViewRequest(BaseModel):
    """Request body for getting the viewer-specific player knowledge list."""

    player_id: str
