"""Schemas for the Bluff game."""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class BluffCreateRoomRequest(BaseModel):
    host_name: str
    player_count: int = Field(..., ge=2, le=10)
    total_rounds: int = Field(..., ge=1, le=20)
    categories: List[str]


class BluffJoinRoomRequest(BaseModel):
    player_name: str


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


class BluffLeaveRoomRequest(BaseModel):
    player_id: str


class BluffDeleteRoomRequest(BaseModel):
    player_id: str


class BluffPlayerView(BaseModel):
    id: str
    name: str
    score: int


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
    player_count: int
    total_rounds: int
    categories: List[str]

    started: bool
    ended: bool
    winner_ids: List[str]

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