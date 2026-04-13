"""Business logic for the Who Am I game."""

from __future__ import annotations

import random
import re
import uuid
from datetime import datetime
from typing import Optional

from app.core.exceptions import PlayerNotFoundError, RoomNotFoundError
from app.core.utils import generate_room_code
from app.games.who_am_i.constants import CATEGORIES
from app.games.who_am_i.domain import WhoAmIPlayer, WhoAmIRoom
from app.repositories.room_repository import RoomRepository
from app.services.room_storage import get_room_repository
from app.core.guess_matcher import is_correct_guess


class WhoAmIService:
    """
    Service layer for managing Who Am I game rooms and actions.
    """

    def __init__(self, room_repository: RoomRepository | None = None) -> None:
        """
        Initialize the service with a room repository.
        """
        self.room_repository = room_repository or get_room_repository()

    def create_room(
        self,
        host_name: str,
        character_id:str,
        auth_username: str | None,
        max_player_count: int,
        categories: list[str],
    ) -> WhoAmIRoom:
        """
        Create a new room and add the host as the first player.
        """
        categories = self._validate_categories(categories, allow_empty=True)

        room_code = generate_room_code()
        host_id = str(uuid.uuid4())

        room = WhoAmIRoom(
            room_code=room_code,
            host_id=host_id,
            categories=categories,
            max_player_count=max_player_count,
        )
        room.players[host_id] = WhoAmIPlayer(
            id=host_id,
            name=host_name,
            username=auth_username,
            character_id=character_id,
        )

        self._save_room(room)
        return room

    def join_room(self, room_code: str, player_name: str, character_id:str, auth_username: str | None) -> WhoAmIRoom:
        """
        Join an existing room. Allow joining even during active gameplay.
        """
        room = self._get_room(room_code)

        if room.ended:
            raise ValueError("Game has ended.")

        if len(room.players) >= room.max_player_count:
            raise ValueError("Room is full.")

        if any(player.name == player_name for player in room.players.values()):
            raise ValueError("Player name already exists in this room.")

        # Allow joining mid-game
        player_id = str(uuid.uuid4())
        room.players[player_id] = WhoAmIPlayer(
            id=player_id,
            name=player_name,
            username=auth_username,
            character_id=character_id,
        )

        # If game is already started, add player to turn order
        if room.started:
            room.full_turn_order.append(player_id)
            room.active_turn_order.append(player_id)

        self._save_room(room)
        return room

    def update_character(self, room_code: str, player_id: str, character_id: str) -> WhoAmIRoom:
        room = self._get_room(room_code)

        if room.started:
            raise ValueError("Character can only be changed in lobby.")
        if player_id not in room.players:
            raise PlayerNotFoundError("Player not found.")
        if not re.fullmatch(r"char([1-9]|1[0-2])", character_id):
            raise ValueError("Invalid character.")

        room.players[player_id].character_id = character_id
        self._save_room(room)
        return room

    def leave_room(self, room_code: str, player_id: str) -> Optional[WhoAmIRoom]:
        """
        Allow a non-host player to leave at any time.
        """
        room = self._get_room(room_code)

        if player_id not in room.players:
            raise PlayerNotFoundError("Player not found.")

        if player_id == room.host_id:
            raise ValueError("Hosts cannot leave. Use delete-room instead.")

        self._remove_player_from_room(room, player_id)

        if not room.players:
            self.room_repository.delete_room(room_code)
            return None

        self._finalize_room_after_player_removal(room)

        self._save_room(room)
        return room

    def update_categories(self, room_code: str, host_id: str, categories: list[str]) -> WhoAmIRoom:
        room = self._get_room(room_code)

        if host_id != room.host_id:
            raise ValueError("Only the host can update categories.")

        if room.started:
            raise ValueError("Categories can only be updated before the game starts.")

        room.categories = self._validate_categories(categories, allow_empty=True)
        self._save_room(room)
        return room

    def remove_player(self, room_code: str, host_id: str, player_id_to_remove: str) -> WhoAmIRoom:
        room = self._get_room(room_code)

        if host_id != room.host_id:
            raise ValueError("Only the host can remove players.")

        if player_id_to_remove not in room.players:
            raise PlayerNotFoundError("Player not found.")

        if player_id_to_remove == room.host_id:
            raise ValueError("Host cannot remove themselves.")

        self._remove_player_from_room(room, player_id_to_remove)

        if not room.players:
            self.room_repository.delete_room(room_code)
            return room

        self._finalize_room_after_player_removal(room)

        self._save_room(room)
        return room

    def heartbeat(self, room_code: str, player_id: str) -> None:
        room = self._get_room(room_code)
        if player_id in room.players:
            room.players[player_id].last_seen = datetime.now()
            self._save_room(room, bump_version=False)

    def delete_room(self, room_code: str, player_id: str) -> None:
        """
        Allow the host to delete the room at any time.
        """
        room = self._get_room(room_code)

        if player_id != room.host_id:
            raise ValueError("Only the host can delete the room.")

        room.ended = True
        room.end_reason = "host_deleted"
        self._save_room(room)
        self.room_repository.delete_room(room_code)

    def _cleanup_inactive_players(self, room: WhoAmIRoom) -> None:
        now = datetime.now()
        inactive_player_ids = [
            pid for pid, player in room.players.items()
            if (now - player.last_seen).total_seconds() > 60  # 1 minute
        ]
        for pid in inactive_player_ids:
            if pid in room.players:
                self._remove_player_from_room(room, pid)
        if inactive_player_ids and not room.players:
            self.room_repository.delete_room(room.room_code)
        elif inactive_player_ids:
            self._finalize_room_after_player_removal(room)

    def start_game(self, room_code: str) -> WhoAmIRoom:
        """
        Start the game by assigning identities and entering the controlled reveal phase.
        Require minimum 2 players, can be less than max_player_count.
        """
        room = self._get_room(room_code)

        if len(room.players) < 2:
            raise ValueError("At least 2 players are required to start the game.")

        if not room.categories:
            raise ValueError("At least one category must be selected.")

        identities_pool = []
        for category in room.categories:
            identities_pool.extend(CATEGORIES[category])
        if len(identities_pool) < len(room.players):
            raise ValueError("Not enough identities in selected category.")

        random.shuffle(identities_pool)

        for index, player in enumerate(room.players.values()):
            player.identity = identities_pool[index]["label"]
            player.has_guessed_correctly = False
            player.guess_count = 0
            player.latest_guess_text = ""
            player.solved_order = None

        reveal_order = list(room.players.keys())
        random.shuffle(reveal_order)

        full_turn_order = list(room.players.keys())
        random.shuffle(full_turn_order)

        room.started = True
        room.ended = False
        room.end_reason = None

        room.reveal_phase_active = True
        room.reveal_order = reveal_order
        room.current_reveal_player_id = reveal_order[0] if reveal_order else None

        room.full_turn_order = full_turn_order
        room.active_turn_order = full_turn_order[:]
        room.current_turn_player_id = None
        room.turn_number = 1

        room.solve_counter = 0

        self._save_room(room)
        return room


    def get_reveal_view(self, room_code: str, viewer_player_id: str) -> dict:
        """
        Return the reveal-phase view for the requesting player.

        During reveal phase:
        - current reveal player does not see their identity
        - all other players do

        After the player solves correctly:
        - they may see their own identity
        """
        room = self._get_room(room_code)

        if viewer_player_id not in room.players:
            raise PlayerNotFoundError("Player not found.")

        viewer = room.players[viewer_player_id]

        if not room.reveal_phase_active:
            if viewer.has_guessed_correctly:
                return {
                    "mode": "solved_self_reveal",
                    "target_player_id": viewer.id,
                    "target_player_name": viewer.name,
                    "identity": viewer.identity,
                    "message": "لقد خمنت هويتك بشكل صحيح.",
                }

            raise ValueError("Reveal phase has already ended.")

        target_player_id = room.current_reveal_player_id
        if not target_player_id:
            raise ValueError("No current reveal player.")

        target_player = room.players[target_player_id]

        if viewer_player_id == target_player_id:
            return {
                "mode": "hidden_for_target",
                "target_player_id": target_player.id,
                "target_player_name": target_player.name,
                "identity": None,
                "message": "لا تنظر. الآخرون يرون هويتك الآن.",
            }

        return {
            "mode": "visible_for_others",
            "target_player_id": target_player.id,
            "target_player_name": target_player.name,
            "identity": target_player.identity,
            "message": f"هوية اللاعب {target_player.name} ظاهرة لك الآن.",
        }


    def confirm_reveal(self, room_code: str, player_id: str) -> WhoAmIRoom:
        """
        Allow only the host to move the reveal phase to the next player.
        """
        room = self._get_room(room_code)

        if not room.reveal_phase_active:
            raise ValueError("Reveal phase is not active.")

        if player_id != room.host_id:
            raise ValueError("Only the host can advance the reveal sequence.")

        if room.current_reveal_player_id is None:
            raise ValueError("No current reveal player.")

        current_index = room.reveal_order.index(room.current_reveal_player_id)
        next_index = current_index + 1

        if next_index < len(room.reveal_order):
            room.current_reveal_player_id = room.reveal_order[next_index]
        else:
            room.reveal_phase_active = False
            room.current_reveal_player_id = None
            room.current_turn_player_id = room.active_turn_order[0] if room.active_turn_order else None

        self._save_room(room)
        return room

    def submit_guess(self, room_code: str, player_id: str, guess_text: str) -> WhoAmIRoom:
        """
        Submit one optional guess for the current turn player.
        """
        room = self._get_room(room_code)

        if room.ended:
            raise ValueError("Game already ended.")

        if room.reveal_phase_active:
            raise ValueError("Game is still in reveal phase.")

        if room.current_turn_player_id != player_id:
            raise ValueError("It is not this player's turn.")

        player = room.players.get(player_id)
        if not player:
            raise PlayerNotFoundError("Player not found.")

        if player.has_guessed_correctly:
            raise ValueError("Player has already guessed correctly.")

        player.guess_count += 1
        player.latest_guess_text = guess_text.strip()

        all_entries = []
        for category in room.categories:
            all_entries.extend(CATEGORIES[category])

        target_entry = next(
            (entry for entry in all_entries if entry["label"] == player.identity),
            None,
        )

        if target_entry is None:
            raise ValueError("Target identity entry not found.")

        if is_correct_guess(
            guess=guess_text,
            target_label=target_entry["label"],
            aliases=target_entry.get("aliases", []),
        ):
            player.has_guessed_correctly = True
            room.solve_counter += 1
            player.solved_order = room.solve_counter

            self._advance_turn(room, solved_player_id=player_id)

            if not room.active_turn_order:
                room.ended = True
                room.end_reason = "game_completed"
                room.current_turn_player_id = None
        else:
            self._advance_turn(room)

        self._save_room(room)
        return room

    def restart_game(self, room_code: str, categories: list[str]) -> WhoAmIRoom:
        """
        Restart the room with the same players and a new category.
        """
        room = self._get_room(room_code)
        categories = self._validate_categories(categories)

        room.categories = categories
        room.started = False
        room.ended = False
        room.end_reason = None

        room.reveal_phase_active = False
        room.reveal_order = []
        room.current_reveal_player_id = None

        room.current_turn_player_id = None
        room.active_turn_order = []
        room.full_turn_order = []
        room.turn_number = 1

        room.solve_counter = 0

        for player in room.players.values():
            player.identity = ""
            player.has_guessed_correctly = False
            player.guess_count = 0
            player.latest_guess_text = ""
            player.solved_order = None

        self._save_room(room)
        return room

    def _validate_categories(self, categories: list[str], allow_empty: bool = False) -> list[str]:
        categories = list(dict.fromkeys(categories))

        if not categories and not allow_empty:
            raise ValueError("At least one category must be selected.")

        if len(categories) > 12:
            raise ValueError("You can select up to 12 categories only.")

        invalid_categories = [category for category in categories if category not in CATEGORIES]
        if invalid_categories:
            raise ValueError(f"Invalid categories: {', '.join(invalid_categories)}")

        return categories

    def get_room_state(self, room_code: str) -> WhoAmIRoom:
        """
        Retrieve current room state.
        """
        room = self._get_room(room_code)
        self._cleanup_inactive_players(room)
        if room.players:
            self._save_room(room)
        return room

    def _advance_turn(self, room: WhoAmIRoom, solved_player_id: str | None = None) -> None:
        """
        Advance to the next active player's turn while preserving round fairness.
        Each player gets exactly one turn per round.
        """

        # Handle solved player removal
        if solved_player_id and solved_player_id in room.active_turn_order:
            solved_index = room.active_turn_order.index(solved_player_id)
            room.active_turn_order.remove(solved_player_id)
            if solved_player_id == room.current_turn_player_id:
                # The current player solved, advance past their position
                if room.active_turn_order:
                    next_index = solved_index
                    if next_index >= len(room.active_turn_order):
                        next_index = 0
                        room.turn_number += 1
                    room.current_turn_player_id = room.active_turn_order[next_index]
                else:
                    room.current_turn_player_id = None
                return

        if not room.active_turn_order:
            room.current_turn_player_id = None
            return

        # First turn initialization
        if room.current_turn_player_id is None:
            room.current_turn_player_id = room.active_turn_order[0]
            return

        # Find current index safely
        if room.current_turn_player_id in room.active_turn_order:
            current_index = room.active_turn_order.index(room.current_turn_player_id)
        else:
            # If current player was removed (solved), continue from previous index
            current_index = -1

        next_index = current_index + 1

        # New round if we reached the end
        if next_index >= len(room.active_turn_order):
            next_index = 0
            room.turn_number += 1

        room.current_turn_player_id = room.active_turn_order[next_index]

    def _remove_player_from_room(self, room: WhoAmIRoom, player_id: str) -> None:
        reveal_index = room.reveal_order.index(player_id) if player_id in room.reveal_order else None
        turn_index = room.active_turn_order.index(player_id) if player_id in room.active_turn_order else None

        del room.players[player_id]

        room.reveal_order = [pid for pid in room.reveal_order if pid != player_id]
        room.full_turn_order = [pid for pid in room.full_turn_order if pid != player_id]
        room.active_turn_order = [pid for pid in room.active_turn_order if pid != player_id]

        if room.current_reveal_player_id == player_id:
            if room.reveal_order:
                next_index = reveal_index if reveal_index is not None else 0
                if next_index >= len(room.reveal_order):
                    next_index = len(room.reveal_order) - 1
                room.current_reveal_player_id = room.reveal_order[next_index]
            else:
                room.current_reveal_player_id = None

        if room.current_turn_player_id == player_id:
            if room.active_turn_order:
                next_index = turn_index if turn_index is not None else 0
                if next_index >= len(room.active_turn_order):
                    next_index = 0
                    room.turn_number += 1
                room.current_turn_player_id = room.active_turn_order[next_index]
            else:
                room.current_turn_player_id = None

    def _finalize_room_after_player_removal(self, room: WhoAmIRoom) -> None:
        if room.started and not self._has_sufficient_players(room):
            self._end_game_insufficient_players(room)
            return

        if not room.started:
            return

        if room.reveal_phase_active:
            room.reveal_order = [pid for pid in room.reveal_order if pid in room.players]
            if room.current_reveal_player_id not in room.players:
                room.current_reveal_player_id = room.reveal_order[0] if room.reveal_order else None

            if not room.reveal_order:
                room.reveal_phase_active = False
                room.current_reveal_player_id = None
                room.current_turn_player_id = room.active_turn_order[0] if room.active_turn_order else None
            return

        room.active_turn_order = [pid for pid in room.active_turn_order if pid in room.players]
        room.full_turn_order = [pid for pid in room.full_turn_order if pid in room.players]

        if room.current_turn_player_id not in room.players:
            room.current_turn_player_id = room.active_turn_order[0] if room.active_turn_order else None

        if not room.active_turn_order and room.started:
            room.ended = True
            room.end_reason = "game_completed"
            room.current_turn_player_id = None

    def _has_sufficient_players(self, room: WhoAmIRoom) -> bool:
        """Check if the game can continue with the current number of players."""
        return len(room.players) >= 2

    def _end_game_insufficient_players(self, room: WhoAmIRoom) -> None:
        """End the game due to insufficient players."""
        room.ended = True
        room.end_reason = "insufficient_players"

    def _get_room(self, room_code: str) -> WhoAmIRoom:
        """
        Get and deserialize a room from storage.
        """
        raw_room = self.room_repository.get_room(room_code)
        if not raw_room:
            raise RoomNotFoundError("Room not found.")
        return self._deserialize_room(raw_room)

    def _serialize_room(self, room: WhoAmIRoom) -> dict:
        """
        Convert room object into serializable dictionary.
        """
        return {
            "room_code": room.room_code,
            "room_version": room.room_version,
            "host_id": room.host_id,
            "categories": room.categories,
            "max_player_count": room.max_player_count,
            "started": room.started,
            "ended": room.ended,
            "end_reason": room.end_reason,
            "reveal_phase_active": room.reveal_phase_active,
            "reveal_order": room.reveal_order,
            "current_reveal_player_id": room.current_reveal_player_id,
            "current_turn_player_id": room.current_turn_player_id,
            "active_turn_order": room.active_turn_order,
            "full_turn_order": room.full_turn_order,
            "turn_number": room.turn_number,
            "solve_counter": room.solve_counter,
            "players": {
                player_id: {
                    "id": player.id,
                    "name": player.name,
                    "username": player.username,
                    "identity": player.identity,
                    "has_guessed_correctly": player.has_guessed_correctly,
                    "guess_count": player.guess_count,
                    "latest_guess_text": player.latest_guess_text,
                    "solved_order": player.solved_order,
                    "character_id": player.character_id,
                }
                for player_id, player in room.players.items()
            },
        }

    def _deserialize_room(self, data: dict) -> WhoAmIRoom:
        """
        Convert serialized data back to WhoAmIRoom.
        """
        room = WhoAmIRoom(
            room_code=data["room_code"],
            host_id=data["host_id"],
            room_version=data.get("room_version", 0),
            categories=data.get("categories", []),
            max_player_count=data["max_player_count"],
            started=data["started"],
            ended=data["ended"],
            end_reason=data.get("end_reason"),
            reveal_phase_active=data.get("reveal_phase_active", False),
            reveal_order=data.get("reveal_order", []),
            current_reveal_player_id=data.get("current_reveal_player_id"),
            current_turn_player_id=data.get("current_turn_player_id"),
            active_turn_order=data.get("active_turn_order", []),
            full_turn_order=data.get("full_turn_order", []),
            turn_number=data.get("turn_number", 1),
            solve_counter=data.get("solve_counter", 0),
        )

        for player_id, player_data in data["players"].items():
            room.players[player_id] = WhoAmIPlayer(
                id=player_data["id"],
                name=player_data["name"],
                username=player_data.get("username"),
                identity=player_data.get("identity", ""),
                has_guessed_correctly=player_data.get("has_guessed_correctly", False),
                guess_count=player_data.get("guess_count", 0),
                latest_guess_text=player_data.get("latest_guess_text", ""),
                solved_order=player_data.get("solved_order"),
                character_id=player_data.get("character_id", "char1")
            )

        return room

    def _save_room(self, room: WhoAmIRoom, bump_version: bool = True) -> None:
        if bump_version:
            room.room_version += 1
        self.room_repository.save_room(room.room_code, self._serialize_room(room))
    
    def get_player_knowledge_view(self, room_code: str, viewer_player_id: str) -> list[dict]:
        """
        Return the player list as seen by a specific viewer.

        Rules:
        - every viewer sees all player names
        - every viewer sees all players' guess counts
        - a viewer sees identities of other players
        - a viewer does not see their own identity unless they guessed correctly
        """
        room = self._get_room(room_code)

        if viewer_player_id not in room.players:
            raise PlayerNotFoundError("Player not found.")

        visible_players = []

        for player in room.players.values():
            visible_identity = None

            if player.id != viewer_player_id:
                visible_identity = player.identity
            elif player.has_guessed_correctly:
                visible_identity = player.identity

            visible_players.append({
                "id": player.id,
                "name": player.name,
                "guess_count": player.guess_count,
                "latest_guess_text": player.latest_guess_text,
                "has_guessed_correctly": player.has_guessed_correctly,
                "solved_order": player.solved_order,
                "visible_identity": visible_identity,
                "character_id": player.character_id,
            })

        return visible_players
