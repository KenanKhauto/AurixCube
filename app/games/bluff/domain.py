"""Domain models for the Bluff game."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class BluffPlayer:
    id: str
    name: str


@dataclass
class BluffAnswerOption:
    id: str
    text: str
    is_correct: bool = False
    author_ids: List[str] = field(default_factory=list)
    votes_received: int = 0


@dataclass
class BluffRoom:
    room_code: str
    host_id: str
    categories: list[str]
    player_count: int
    total_rounds: int

    started: bool = False
    ended: bool = False
    winner_ids: List[str] = field(default_factory=list)

    current_round: int = 1
    phase: str = "waiting"  # waiting | writing | voting | round_result | game_over

    current_question: str = ""
    correct_answer: str = ""
    used_prompt_indices: List[int] = field(default_factory=list)

    players: Dict[str, BluffPlayer] = field(default_factory=dict)
    scores: Dict[str, int] = field(default_factory=dict)

    submissions: Dict[str, str] = field(default_factory=dict)
    answer_options: List[BluffAnswerOption] = field(default_factory=list)
    votes: Dict[str, str] = field(default_factory=dict)  # voter_id -> option_id

    last_round_message: Optional[str] = None
    last_round_correct_option_id: Optional[str] = None
    last_round_score_changes: Dict[str, int] = field(default_factory=dict)