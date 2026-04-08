"""Domain models for the drawing guess game."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional


@dataclass
class DrawGuessPlayer:
    id: str
    name: str
    character_id: str = "char1"
    last_seen: datetime = field(default_factory=datetime.now)


@dataclass
class DrawGuessStroke:
    x0: float
    y0: float
    x1: float
    y1: float
    color: str
    width: float
    tool: str = "pen"


@dataclass
class DrawGuessGuessMessage:
    player_id: str
    player_name: str
    text: str
    is_correct: bool = False


@dataclass
class DrawGuessWordOption:
    word_en: str
    word_ar: str
    aliases_en: List[str] = field(default_factory=list)
    aliases_ar: List[str] = field(default_factory=list)
    difficulty: str = "easy"


@dataclass
class DrawGuessRoom:
    room_code: str
    host_id: str
    player_count: int
    total_rounds: int
    categories: List[str]
    language: str = "en"  # en | ar
    round_timer_seconds: int = 60

    started: bool = False
    ended: bool = False
    end_reason: Optional[str] = None  # e.g., "game_completed", "insufficient_players", "host_deleted"
    winner_ids: List[str] = field(default_factory=list)

    current_round: int = 1
    phase: str = "waiting"  # waiting | word_choice | drawing | round_result | game_over

    players: Dict[str, DrawGuessPlayer] = field(default_factory=dict)
    scores: Dict[str, int] = field(default_factory=dict)

    drawer_order: List[str] = field(default_factory=list)
    current_drawer_id: Optional[str] = None

    current_word_choices: List[DrawGuessWordOption] = field(default_factory=list)
    current_word: Optional[DrawGuessWordOption] = None
    phase_deadline_at: Optional[float] = None

    strokes: List[DrawGuessStroke] = field(default_factory=list)
    guesses: List[DrawGuessGuessMessage] = field(default_factory=list)
    guessed_correctly_player_ids: List[str] = field(default_factory=list)

    last_round_word_en: Optional[str] = None
    last_round_word_ar: Optional[str] = None
    last_round_score_changes: Dict[str, int] = field(default_factory=dict)