"""Schemas for the Bluff game."""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class BluffCreateRoomRequest(BaseModel):
    host_name: str
    character_id: str = "char1"
    max_player_count: int = Field(..., ge=2, le=10)
    total_rounds: int = Field(..., ge=1, le=20)
    categories: List[str] = Field(default_factory=list)
    round_timer_seconds: int = Field(30, ge=30, le=90)


class BluffJoinRoomRequest(BaseModel):
    player_name: str
    character_id: str = "char1"


class BluffUpdateCharacterRequest(BaseModel):
    player_id: str
    character_id: str


class BluffSelectCategoryRequest(BaseModel):
    player_id: str
    category: str


class BluffSubmitAnswerRequest(BaseModel):
    player_id: str
    answer_text: str


class BluffSubmitPickRequest(BaseModel):
    player_id: str
    option_id: str


class BluffAdvanceRoundRequest(BaseModel):
    player_id: str


class BluffRestartGameRequest(BaseModel):
    categories: List[str]
    total_rounds: int = Field(..., ge=1, le=20)
    round_timer_seconds: int = Field(30, ge=30, le=90)


class BluffLeaveRoomRequest(BaseModel):
    player_id: str


class BluffRemovePlayerRequest(BaseModel):
    host_id: str
    player_id_to_remove: str


class BluffUpdateCategoriesRequest(BaseModel):
    host_id: str
    categories: List[str] = Field(default_factory=list)


class BluffDeleteRoomRequest(BaseModel):
    player_id: str


class BluffPlayerView(BaseModel):
    id: str
    name: str
    username: Optional[str] = None
    score: int
    character_id: str = "char1"


class BluffAnswerOptionView(BaseModel):
    id: str
    text: str
    is_correct: bool
    author_ids: List[str]
    votes_received: int
    is_bot_generated: bool


class BluffRoomStateResponse(BaseModel):
    room_code: str
    host_id: str
    max_player_count: int
    total_rounds: int
    categories: List[str]

    started: bool
    ended: bool
    end_reason: Optional[str] = None
    winner_ids: List[str]

    round_timer_seconds: int
    
    current_round: int
    phase: str

    current_category_chooser_id: Optional[str]
    current_round_category: str
    current_question: str
    phase_deadline_at: Optional[float]

    submissions_count: int
    picks_count: int
    submitted_player_ids: List[str]
    picked_player_ids: List[str]

    last_round_message: Optional[str]
    last_round_correct_option_id: Optional[str]
    last_round_score_changes: Dict[str, int]

    players: List[BluffPlayerView]
    answer_options: List[BluffAnswerOptionView]
    picks: Dict[str, str] = {}
