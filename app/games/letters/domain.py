"""Domain models for the Arabic letters category game."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional


@dataclass
class LettersPlayer:
    id: str
    name: str
    username: Optional[str] = None
    character_id: str = "char1"
    last_seen: datetime = field(default_factory=datetime.now)


@dataclass
class LettersVoteRecord:
    valid_player_ids: List[str] = field(default_factory=list)
    invalid_player_ids: List[str] = field(default_factory=list)


@dataclass
class LettersRoom:
    room_code: str
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

    session_id: str = ""
    room_version: int = 0
    started: bool = False
    ended: bool = False
    history_recorded: bool = False
    end_reason: Optional[str] = None
    winner_ids: List[str] = field(default_factory=list)

    current_round: int = 1
    phase: str = "waiting"
    phase_started_at: Optional[float] = None
    phase_deadline_at: Optional[float] = None
    done_available_at: Optional[float] = None

    chooser_order: List[str] = field(default_factory=list)
    chooser_rotation_index: int = 0
    current_chooser_id: Optional[str] = None
    used_letters: List[str] = field(default_factory=list)
    current_letter: Optional[str] = None

    players: Dict[str, LettersPlayer] = field(default_factory=dict)
    scores: Dict[str, int] = field(default_factory=dict)
    submissions: Dict[str, List[str]] = field(default_factory=dict)
    answer_votes: Dict[str, LettersVoteRecord] = field(default_factory=dict)
    round_answer_results: Dict[str, dict] = field(default_factory=dict)
    last_round_score_changes: Dict[str, int] = field(default_factory=dict)
    last_round_player_stats: Dict[str, dict] = field(default_factory=dict)
    last_round_letter: Optional[str] = None
    last_round_locked_by: Optional[str] = None
    last_round_locked_by_player_id: Optional[str] = None
