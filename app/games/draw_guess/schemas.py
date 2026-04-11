"""Schemas for the drawing guess game."""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class DrawGuessCreateRoomRequest(BaseModel):
    host_name: str
    character_id: str = "char1"
    max_player_count: int = Field(..., ge=2, le=10)
    total_rounds: int = Field(..., ge=1, le=20)
    categories: List[str] = Field(default_factory=list, max_length=12)
    language: str = Field("en", pattern="^(en|ar)$")
    round_timer_seconds: int = Field(60, ge=30, le=120)


class DrawGuessJoinRoomRequest(BaseModel):
    player_name: str
    character_id: str = "char1"


class DrawGuessSelectWordRequest(BaseModel):
    player_id: str
    chosen_word_en: str


class DrawGuessAdvanceRoundRequest(BaseModel):
    player_id: str


class DrawGuessRestartGameRequest(BaseModel):
    categories: List[str]
    total_rounds: int = Field(..., ge=1, le=20)
    language: str = Field("en", pattern="^(en|ar)$")
    round_timer_seconds: int = Field(60, ge=30, le=120)


class DrawGuessLeaveRoomRequest(BaseModel):
    player_id: str


class DrawGuessDeleteRoomRequest(BaseModel):
    player_id: str


class DrawGuessRemovePlayerRequest(BaseModel):
    host_id: str
    player_id_to_remove: str


class DrawGuessUpdateCategoriesRequest(BaseModel):
    host_id: str
    categories: List[str] = Field(default_factory=list, max_length=12)


class DrawGuessPlayerView(BaseModel):
    id: str
    name: str
    character_id: str
    score: int


class DrawGuessWordOptionView(BaseModel):
    word_en: str
    word_ar: str
    difficulty: str


class DrawGuessGuessMessageView(BaseModel):
    player_id: str
    player_name: str
    text: str
    is_correct: bool


class DrawGuessStrokeView(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float
    color: str
    width: float


class DrawGuessRoomStateResponse(BaseModel):
    room_code: str
    host_id: str
    max_player_count: int
    total_rounds: int
    categories: List[str]
    language: str
    round_timer_seconds: int

    started: bool
    ended: bool
    end_reason: Optional[str] = None
    winner_ids: List[str]

    current_round: int
    phase: str
    current_drawer_id: Optional[str]
    phase_deadline_at: Optional[float]

    current_word_choices: List[DrawGuessWordOptionView]
    guessed_correctly_player_ids: List[str]

    last_round_word_en: Optional[str]
    last_round_word_ar: Optional[str]
    last_round_score_changes: Dict[str, int]

    players: List[DrawGuessPlayerView]
    guesses: List[DrawGuessGuessMessageView]
    strokes: List[DrawGuessStrokeView]
    current_word_en: Optional[str]
    current_word_ar: Optional[str]
