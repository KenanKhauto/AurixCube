"""Business logic for the Undercover game."""

from __future__ import annotations

import random
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from app.core.exceptions import InvalidVoteError, PlayerNotFoundError, RoomNotFoundError
from app.core.utils import choose_random_players, generate_room_code
from app.games.undercover.constants import CATEGORIES
from app.games.undercover.domain import Player, UndercoverRoom
from app.repositories.room_repository import RoomRepository
from app.services.room_storage import get_room_repository


class UndercoverGameService:
    """
    Service layer for managing Undercover game rooms and actions.
    """

    def __init__(self, room_repository: RoomRepository | None = None) -> None:
        """
        Initialize the service with a room repository.

        Args:
            room_repository: Repository implementation for room storage.
                If not provided, the configured default repository is used.
        """
        self.room_repository = room_repository or get_room_repository()

    def create_room(
        self,
        host_name: str,
        player_count: int,
        undercover_count: int,
        categories: list[str],
    ) -> UndercoverRoom:
        """
        Create a new room and add the host as the first player.
        """
        categories = list(dict.fromkeys(categories))

        if not categories:
            raise ValueError("At least one category must be selected.")

        if len(categories) > 12:
            raise ValueError("You can select up to 12 categories only.")

        invalid_categories = [category for category in categories if category not in CATEGORIES]
        if invalid_categories:
            raise ValueError(f"Invalid categories: {', '.join(invalid_categories)}")

        room_code = generate_room_code()
        host_id = str(uuid.uuid4())

        room = UndercoverRoom(
            room_code=room_code,
            host_id=host_id,
            categories=categories,
            player_count=player_count,
            undercover_count=undercover_count,
        )
        room.players[host_id] = Player(id=host_id, name=host_name)

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def join_room(self, room_code: str, player_name: str) -> UndercoverRoom:
        """
        Join an existing room.
        """
        room = self._get_room(room_code)

        if room.started:
            raise ValueError("Game already started.")

        if len(room.players) >= room.player_count:
            raise ValueError("Room is full.")

        player_id = str(uuid.uuid4())
        room.players[player_id] = Player(id=player_id, name=player_name)

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def leave_room(self, room_code: str, player_id: str) -> Optional[UndercoverRoom]:
        """
        Allow a non-host player to leave at any time.

        Returns:
            The updated room if it still exists, otherwise None.
        """
        room = self._get_room(room_code)

        if player_id not in room.players:
            raise PlayerNotFoundError("Player not found.")

        if player_id == room.host_id:
            raise ValueError("Hosts cannot leave. Use delete-room instead.")

        del room.players[player_id]

        if not room.players:
            self.room_repository.delete_room(room_code)
            return None

        # Check for insufficient players after someone leaves
        if room.started and not self._has_sufficient_players(room):
            self._end_game_insufficient_players(room)

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def heartbeat(self, room_code: str, player_id: str) -> None:
        room = self._get_room(room_code)
        if player_id in room.players:
            room.players[player_id].last_seen = datetime.now()
            self.room_repository.save_room(room_code, self._serialize_room(room))

    def delete_room(self, room_code: str, player_id: str) -> None:
        """
        Allow the host to delete the room at any time.
        """
        room = self._get_room(room_code)

        if player_id != room.host_id:
            raise ValueError("Only the host can delete the room.")

        room.ended = True
        room.end_reason = "host_deleted"
        self.room_repository.save_room(room_code, self._serialize_room(room))
        self.room_repository.delete_room(room_code)

    def _cleanup_inactive_players(self, room: UndercoverRoom) -> None:
        now = datetime.now()
        inactive_player_ids = [
            pid for pid, player in room.players.items()
            if (now - player.last_seen).total_seconds() > 60  # 1 minute
        ]
        for pid in inactive_player_ids:
            del room.players[pid]
        if inactive_player_ids and not room.players:
            self.room_repository.delete_room(room.room_code)
        elif inactive_player_ids and room.started and not self._has_sufficient_players(room):
            self._end_game_insufficient_players(room)

    def start_game(self, room_code: str) -> UndercoverRoom:
        """
        Start the game by assigning words and undercover players.
        """
        room = self._get_room(room_code)

        if len(room.players) != room.player_count:
            raise ValueError("Room is not full yet.")

        words = []
        for category in room.categories:
            words.extend(CATEGORIES[category])

        if not words:
            raise ValueError("No words available in selected categories.")

        chosen_word = random.choice(words)
        chosen_word = random.choice(words)
        player_ids = list(room.players.keys())
        undercover_ids = choose_random_players(player_ids, room.undercover_count)

        for player in room.players.values():
            player.secret_word = chosen_word
            player.is_undercover = False
            player.is_eliminated = False

        for player_id in undercover_ids:
            room.players[player_id].secret_word = "أنت المندس"
            room.players[player_id].is_undercover = True

        room.started = True
        room.votes = {player_id: [] for player_id in room.players.keys()}
        room.ended = False
        room.winner = None
        room.eliminated_player_id = None
        room.eliminated_player_is_undercover = None
        room.last_vote_result = None
        room.round_number = 1
        self._assign_round_pair(room)

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def get_room_state(self, room_code: str) -> UndercoverRoom:
        """
        Retrieve current room state.
        """
        room = self._get_room(room_code)
        self._cleanup_inactive_players(room)
        return room

    def get_player_secret(self, room_code: str, player_id: str) -> Dict[str, str]:
        """
        Get the secret word or undercover label for a player.
        """
        room = self._get_room(room_code)
        player = room.players.get(player_id)

        if not player:
            raise PlayerNotFoundError("Player not found.")

        return {
            "player_id": player.id,
            "player_name": player.name,
            "secret_word": player.secret_word,
        }

    def submit_vote(self, room_code: str, voter_id: str, voted_player_ids: List[str]) -> UndercoverRoom:
        """
        Submit or replace a player's votes.

        A player can vote for up to `undercover_count` targets.
        Votes are only resolved once all active players have submitted.
        """
        room = self._get_room(room_code)

        if room.ended:
            raise InvalidVoteError("Game has already ended.")

        if voter_id not in room.players:
            raise PlayerNotFoundError("Voter not found.")

        if room.players[voter_id].is_eliminated:
            raise InvalidVoteError("Eliminated players cannot vote.")

        if len(voted_player_ids) == 0:
            raise InvalidVoteError("You must vote for at least one player.")

        if len(voted_player_ids) > room.undercover_count:
            raise InvalidVoteError("Too many votes selected.")

        if len(voted_player_ids) != len(set(voted_player_ids)):
            raise InvalidVoteError("Duplicate votes are not allowed.")

        for target_id in voted_player_ids:
            if target_id not in room.players:
                raise PlayerNotFoundError("A selected player does not exist.")
            if target_id == voter_id:
                raise InvalidVoteError("A player cannot vote for themselves.")
            if room.players[target_id].is_eliminated:
                raise InvalidVoteError("You cannot vote for an eliminated player.")

        room.votes[voter_id] = voted_player_ids
        self._resolve_votes(room)

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def restart_game(self, room_code: str, categories: list[str], undercover_count: int) -> UndercoverRoom:
        """
        Restart the current room while keeping the same players.

        Undercover assignments are randomized again.
        """
        room = self._get_room(room_code)

        categories = list(dict.fromkeys(categories))

        if not categories:
            raise ValueError("At least one category must be selected.")

        if len(categories) > 12:
            raise ValueError("You can select up to 12 categories only.")

        invalid_categories = [category for category in categories if category not in CATEGORIES]
        if invalid_categories:
            raise ValueError(f"Invalid categories: {', '.join(invalid_categories)}")

        room.categories = categories
        room.undercover_count = undercover_count

        for player in room.players.values():
            player.secret_word = ""
            player.is_undercover = False
            player.is_eliminated = False

        room.started = False
        room.ended = False
        room.winner = None
        room.votes = {}
        room.eliminated_player_id = None
        room.eliminated_player_is_undercover = None
        room.last_vote_result = None
        room.current_asker_id = None
        room.current_target_id = None
        room.round_number = 1

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def _assign_round_pair(self, room: UndercoverRoom) -> None:
        """
        Assign a random asker and a different random target
        from active (non-eliminated) players.
        """
        active_players = [player for player in room.players.values() if not player.is_eliminated]

        if len(active_players) < 2:
            room.current_asker_id = None
            room.current_target_id = None
            return

        asker = random.choice(active_players)
        possible_targets = [player for player in active_players if player.id != asker.id]
        target = random.choice(possible_targets)

        room.current_asker_id = asker.id
        room.current_target_id = target.id

    def _resolve_votes(self, room: UndercoverRoom) -> None:
        """
        Resolve votes only when all active players have voted.

        Rules:
        - The player with the highest unique vote count is eliminated.
        - If the highest vote count is tied, nobody is eliminated.
        - Tie starts a new round.
        - If all undercovers are eliminated, normal players win.
        - If active undercovers are greater than or equal to active innocents,
          undercovers win.
        - Otherwise the game continues to the next round.
        """
        active_players = [p for p in room.players.values() if not p.is_eliminated]
        active_player_ids = {p.id for p in active_players}

        room.eliminated_player_id = None
        room.eliminated_player_is_undercover = None
        room.last_vote_result = None

        all_active_players_voted = all(
            player_id in room.votes and len(room.votes[player_id]) > 0
            for player_id in active_player_ids
        )

        if not all_active_players_voted:
            return

        target_counts: Dict[str, int] = {player.id: 0 for player in active_players}

        for voter_id, voted_targets in room.votes.items():
            if voter_id not in room.players or room.players[voter_id].is_eliminated:
                continue

            for target_id in voted_targets:
                if target_id in target_counts:
                    target_counts[target_id] += 1

        max_votes = max(target_counts.values(), default=0)
        top_targets = [target_id for target_id, count in target_counts.items() if count == max_votes]

        # Tie or no valid winner: nobody eliminated, start next round
        if max_votes == 0 or len(top_targets) != 1:
            room.last_vote_result = "tie"
            room.votes = {
                player.id: []
                for player in room.players.values()
                if not player.is_eliminated
            }
            room.round_number += 1
            self._assign_round_pair(room)
            return

        eliminated_player_id = top_targets[0]
        eliminated_player = room.players[eliminated_player_id]
        eliminated_player.is_eliminated = True

        room.eliminated_player_id = eliminated_player_id
        room.eliminated_player_is_undercover = eliminated_player.is_undercover
        room.last_vote_result = "eliminated"

        alive_undercovers = [
            p for p in room.players.values()
            if p.is_undercover and not p.is_eliminated
        ]
        alive_innocents = [
            p for p in room.players.values()
            if not p.is_undercover and not p.is_eliminated
        ]

        if not alive_undercovers:
            room.ended = True
            room.winner = "players"
            room.current_asker_id = None
            room.current_target_id = None
            room.votes = {}
            return

        if len(alive_undercovers) >= len(alive_innocents):
            room.ended = True
            room.winner = "undercover"
            room.current_asker_id = None
            room.current_target_id = None
            room.votes = {}
            return

        room.votes = {
            player.id: []
            for player in room.players.values()
            if not player.is_eliminated
        }
        room.round_number += 1
        self._assign_round_pair(room)

    def _has_sufficient_players(self, room: UndercoverRoom) -> bool:
        """Check if the game can continue with the current number of players."""
        return len(room.players) >= 2

    def _end_game_insufficient_players(self, room: UndercoverRoom) -> None:
        """End the game due to insufficient players."""
        room.ended = True
        room.end_reason = "insufficient_players"

    def _get_room(self, room_code: str) -> UndercoverRoom:
        """
        Get and deserialize a room from storage.
        """
        raw_room = self.room_repository.get_room(room_code)
        if not raw_room:
            raise RoomNotFoundError("Room not found.")
        return self._deserialize_room(raw_room)

    def _serialize_room(self, room: UndercoverRoom) -> dict:
        """Convert room object into serializable dictionary."""
        return {
            "room_code": room.room_code,
            "host_id": room.host_id,
            "categories": room.categories,
            "player_count": room.player_count,
            "undercover_count": room.undercover_count,
            "started": room.started,
            "ended": room.ended,
            "winner": room.winner,
            "votes": room.votes,
            "eliminated_player_id": room.eliminated_player_id,
            "eliminated_player_is_undercover": room.eliminated_player_is_undercover,
            "last_vote_result": room.last_vote_result,
            "current_asker_id": room.current_asker_id,
            "current_target_id": room.current_target_id,
            "round_number": room.round_number,
            "players": {
                player_id: {
                    "id": player.id,
                    "name": player.name,
                    "secret_word": player.secret_word,
                    "is_undercover": player.is_undercover,
                    "is_eliminated": player.is_eliminated,
                }
                for player_id, player in room.players.items()
            },
        }

    def _deserialize_room(self, data: dict) -> UndercoverRoom:
        """Convert serialized data back to UndercoverRoom."""
        room = UndercoverRoom(
            room_code=data["room_code"],
            host_id=data["host_id"],
            categories=data.get("categories", [data["category"]] if "category" in data else []),
            player_count=data["player_count"],
            undercover_count=data["undercover_count"],
            started=data["started"],
            ended=data["ended"],
            winner=data["winner"],
            votes=data["votes"],
            eliminated_player_id=data.get("eliminated_player_id"),
            eliminated_player_is_undercover=data.get("eliminated_player_is_undercover"),
            last_vote_result=data.get("last_vote_result"),
            current_asker_id=data.get("current_asker_id"),
            current_target_id=data.get("current_target_id"),
            round_number=data.get("round_number", 1),
        )

        for player_id, player_data in data["players"].items():
            room.players[player_id] = Player(
                id=player_data["id"],
                name=player_data["name"],
                secret_word=player_data["secret_word"],
                is_undercover=player_data["is_undercover"],
                is_eliminated=player_data["is_eliminated"],
            )

        return room