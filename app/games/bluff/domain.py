"""Domain models for the Bluff game."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional


@dataclass
class BluffPlayer:
    id: str
    name: str
    character_id: str = "char1" # the icon image
    last_seen: datetime = field(default_factory=datetime.now)


@dataclass
class BluffAnswerOption:
    id: str
    text: str
    is_correct: bool = False
    author_ids: List[str] = field(default_factory=list)
    votes_received: int = 0
    is_bot_generated: bool = False


@dataclass
class BluffRoom:
    room_code: str
    host_id: str
    player_count: int
    total_rounds: int
    categories: List[str]
    round_timer_seconds: int = 30

    started: bool = False
    ended: bool = False
    end_reason: Optional[str] = None  # e.g., "game_completed", "insufficient_players", "host_deleted"
    winner_ids: List[str] = field(default_factory=list)

    current_round: int = 1
    phase: str = "waiting"  # waiting | category_pick | submission | answer_pick | round_result | game_over

    chooser_order: List[str] = field(default_factory=list)
    current_category_chooser_id: Optional[str] = None
    current_round_category: str = ""

    current_question: str = ""
    correct_answer: str = ""
    used_prompt_keys: List[str] = field(default_factory=list)

    phase_deadline_at: Optional[float] = None  # unix timestamp

    players: Dict[str, BluffPlayer] = field(default_factory=dict)
    scores: Dict[str, int] = field(default_factory=dict)

    submissions: Dict[str, str] = field(default_factory=dict)  # player_id -> submitted bluff text
    answer_options: List[BluffAnswerOption] = field(default_factory=list)
    picks: Dict[str, str] = field(default_factory=dict)  # player_id -> option_id

    last_round_message: Optional[str] = None
    last_round_correct_option_id: Optional[str] = None
    last_round_score_changes: Dict[str, int] = field(default_factory=dict)