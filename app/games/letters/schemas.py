"""Schemas for the Arabic letters category game."""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class LettersPresetCategoryView(BaseModel):
    id: str
    label: str


class LettersCreateRoomRequest(BaseModel):
    host_name: str
    character_id: str = "char1"
    max_player_count: int = Field(..., ge=2, le=10)
    total_rounds: int = Field(..., ge=1, le=20)
    answer_timer_seconds: int = Field(60, ge=15, le=180)
    no_timer: bool = False
    min_done_seconds: int = Field(10, ge=0, le=120)
    preset_category_ids: List[str] = Field(default_factory=list)
    custom_categories: List[str] = Field(default_factory=list)


class LettersJoinRoomRequest(BaseModel):
    player_name: str
    character_id: str = "char1"


class LettersUpdateCharacterRequest(BaseModel):
    player_id: str
    character_id: str


class LettersUpdateSettingsRequest(BaseModel):
    host_id: str
    max_player_count: int = Field(..., ge=2, le=10)
    total_rounds: int = Field(..., ge=1, le=20)
    answer_timer_seconds: int = Field(60, ge=15, le=180)
    no_timer: bool = False
    min_done_seconds: int = Field(10, ge=0, le=120)
    preset_category_ids: List[str] = Field(default_factory=list)
    custom_categories: List[str] = Field(default_factory=list)


class LettersStartGameRequest(BaseModel):
    host_id: str


class LettersNextPhaseRequest(BaseModel):
    host_id: str


class LettersChooseLetterRequest(BaseModel):
    player_id: str
    letter: str


class LettersSubmitAnswersRequest(BaseModel):
    player_id: str
    answers: List[str] = Field(default_factory=list)


class LettersDoneRequest(BaseModel):
    player_id: str
    answers: List[str] = Field(default_factory=list)


class LettersVoteRequest(BaseModel):
    player_id: str
    answer_id: str
    verdict: str = Field(..., pattern="^(valid|invalid)$")


class LettersRestartGameRequest(BaseModel):
    host_id: str
    max_player_count: int = Field(..., ge=2, le=10)
    total_rounds: int = Field(..., ge=1, le=20)
    answer_timer_seconds: int = Field(60, ge=15, le=180)
    no_timer: bool = False
    min_done_seconds: int = Field(10, ge=0, le=120)
    preset_category_ids: List[str] = Field(default_factory=list)
    custom_categories: List[str] = Field(default_factory=list)


class LettersLeaveRoomRequest(BaseModel):
    player_id: str


class LettersDeleteRoomRequest(BaseModel):
    player_id: str


class LettersRemovePlayerRequest(BaseModel):
    host_id: str
    player_id_to_remove: str


class LettersPlayerView(BaseModel):
    id: str
    name: str
    username: Optional[str] = None
    character_id: str
    score: int


class LettersAnswerEntryView(BaseModel):
    answer_id: str
    player_id: str
    player_name: str
    category_index: int
    category_label: str
    answer_text: str
    normalized_answer: str
    is_empty: bool
    valid_votes: int
    invalid_votes: int
    my_vote: Optional[str] = None
    final_status: Optional[str] = None
    points_awarded: int = 0
    duplicate_count: int = 0
    can_vote: bool = False


class LettersRoomStateResponse(BaseModel):
    room_code: str
    room_version: int
    host_id: str
    max_player_count: int
    total_rounds: int
    answer_timer_seconds: int
    no_timer: bool
    min_done_seconds: int
    preset_category_ids: List[str]
    custom_categories: List[str]
    active_categories: List[str]
    allowed_letters: List[str]
    started: bool
    ended: bool
    end_reason: Optional[str] = None
    winner_ids: List[str]
    current_round: int
    phase: str
    phase_started_at: Optional[float]
    phase_deadline_at: Optional[float]
    done_available_at: Optional[float]
    chooser_order: List[str]
    current_chooser_id: Optional[str]
    current_letter: Optional[str]
    used_letters: List[str]
    last_round_letter: Optional[str]
    last_round_locked_by: Optional[str]
    last_round_locked_by_player_id: Optional[str]
    last_round_score_changes: Dict[str, int]
    last_round_player_stats: Dict[str, dict]
    players: List[LettersPlayerView]
    submissions: Dict[str, List[str]]
    answer_entries: List[LettersAnswerEntryView]
