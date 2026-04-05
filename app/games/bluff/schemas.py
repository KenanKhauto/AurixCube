"""Schemas for the Bluff game."""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class BluffCreateRoomRequest(BaseModel):
    host_name: str
    player_count: int = Field(..., ge=2, le=10)
    total_rounds: int = Field(..., ge=1, le=10)
    categories: list[str]


class BluffJoinRoomRequest(BaseModel):
    player_name: str


class BluffSubmitAnswerRequest(BaseModel):
    player_id: str
    answer_text: str


class BluffSubmitVoteRequest(BaseModel):
    player_id: str
    option_id: str


class BluffAdvanceRoundRequest(BaseModel):
    player_id: str


class BluffRestartGameRequest(BaseModel):
    categories: list[str]
    total_rounds: int = Field(..., ge=1, le=10)


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


class BluffRoomStateResponse(BaseModel):
    room_code: str
    host_id: str
    categories: list[str]
    player_count: int
    total_rounds: int
    started: bool
    ended: bool
    winner_ids: List[str]
    current_round: int
    phase: str
    current_question: str
    submissions_count: int
    votes_count: int
    last_round_message: Optional[str]
    last_round_correct_option_id: Optional[str]
    last_round_score_changes: Dict[str, int]
    players: List[BluffPlayerView]
    answer_options: List[BluffAnswerOptionView]
    votes: Dict[str, str]