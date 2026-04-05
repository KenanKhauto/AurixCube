"""Pydantic schemas for the Undercover game API."""

from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class CreateRoomRequest(BaseModel):
    """Request body for creating a room."""

    host_name: str = Field(..., min_length=1, max_length=50)
    player_count: int = Field(..., ge=3, le=20)
    undercover_count: int = Field(..., ge=1, le=4)
    categories: list[str]


class JoinRoomRequest(BaseModel):
    """Request body for joining a room."""

    player_name: str = Field(..., min_length=1, max_length=50)


class VoteRequest(BaseModel):
    """Request body for submitting votes."""

    voter_id: str
    voted_player_ids: List[str]


class RevealWordRequest(BaseModel):
    """Request body for retrieving player secret word."""

    player_id: str


class RestartRoomRequest(BaseModel):
    """Request body for restarting the room."""

    categories: list[str]
    undercover_count: int


class PlayerView(BaseModel):
    """Serializable player representation for API responses."""

    id: str
    name: str
    is_eliminated: bool
    votes_received: int


class RoomStateResponse(BaseModel):
    """Serialized room state."""

    room_code: str
    host_id: str
    categories: list[str]
    player_count: int
    undercover_count: int
    started: bool
    ended: bool
    winner: Optional[str]
    players: List[PlayerView]
    votes: Dict[str, List[str]]
    eliminated_player_id: Optional[str] = None
    eliminated_player_is_undercover: Optional[bool] = None
    current_asker_id: Optional[str] = None
    current_target_id: Optional[str] = None
    round_number: int
    last_vote_result: str | None = None

class LeaveRoomRequest(BaseModel):
    """Request body for leaving a room."""

    player_id: str


class DeleteRoomRequest(BaseModel):
    """Request body for deleting a room."""

    player_id: str