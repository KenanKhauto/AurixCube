"""Domain entities for the Undercover game."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class Player:
    """
    Represents a player in the Undercover game.
    """

    id: str
    name: str
    secret_word: str = ""
    is_undercover: bool = False
    is_eliminated: bool = False


@dataclass
class UndercoverRoom:
    """
    Represents the full game state for one room.
    """

    room_code: str
    host_id: str
    categories: list[str]    
    player_count: int
    undercover_count: int
    started: bool = False
    ended: bool = False
    winner: Optional[str] = None
    players: Dict[str, Player] = field(default_factory=dict)
    votes: Dict[str, List[str]] = field(default_factory=dict)
    eliminated_player_id: Optional[str] = None
    eliminated_player_is_undercover: Optional[bool] = None
    current_asker_id: Optional[str] = None
    current_target_id: Optional[str] = None
    round_number: int = 1
    last_vote_result: str | None = None