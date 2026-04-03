"""Domain entities for the Who Am I game."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class WhoAmIPlayer:
    """
    Represents a player in the Who Am I game.
    """

    id: str
    name: str
    identity: str = ""
    has_guessed_correctly: bool = False
    guess_count: int = 0
    solved_order: Optional[int] = None


@dataclass
class WhoAmIRoom:
    """
    Represents the full game state for one Who Am I room.
    """

    room_code: str
    host_id: str
    category: str
    player_count: int
    started: bool = False
    ended: bool = False

    reveal_phase_active: bool = False
    reveal_order: List[str] = field(default_factory=list)
    current_reveal_player_id: Optional[str] = None

    current_turn_player_id: Optional[str] = None
    active_turn_order: List[str] = field(default_factory=list)
    full_turn_order: List[str] = field(default_factory=list)
    turn_number: int = 1

    solve_counter: int = 0
    players: Dict[str, WhoAmIPlayer] = field(default_factory=dict)