"""Business logic for the drawing guess game."""

from __future__ import annotations

import random
import re
import time
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from app.core.exceptions import PlayerNotFoundError, RoomNotFoundError
from app.core.utils import generate_room_code
from app.games.draw_guess.constants import DRAW_CATEGORIES
from app.games.draw_guess.domain import (
    DrawGuessGuessMessage,
    DrawGuessPlayer,
    DrawGuessRoom,
    DrawGuessStroke,
    DrawGuessWordOption,
)
from app.repositories.room_repository import RoomRepository
from app.services.room_storage import get_room_repository


class DrawGuessGameService:
    def __init__(self, room_repository: RoomRepository | None = None) -> None:
        self.room_repository = room_repository or get_room_repository()

    def create_room(
        self,
        host_name: str,
        character_id: str,
        auth_username: str | None,
        max_player_count: int,
        total_rounds: int,
        categories: List[str],
        language: str,
        round_timer_seconds: int,
    ) -> DrawGuessRoom:
        categories = self._validate_categories(categories, allow_empty=True)
        self._validate_language(language)
        self._validate_timer(round_timer_seconds)

        room_code = generate_room_code()
        host_id = str(uuid.uuid4())

        room = DrawGuessRoom(
            room_code=room_code,
            host_id=host_id,
            max_player_count=max_player_count,
            total_rounds=total_rounds,
            categories=categories,
            language=language,
            round_timer_seconds=round_timer_seconds,
        )

        room.players[host_id] = DrawGuessPlayer(
            id=host_id,
            name=host_name,
            username=auth_username,
            character_id=character_id,
        )
        room.scores[host_id] = 0

        self._save_room(room)
        return room

    def join_room(self, room_code: str, player_name: str, character_id: str, auth_username: str | None) -> DrawGuessRoom:
        room = self._get_room(room_code)

        if room.ended:
            raise ValueError("Game has ended.")

        # Check if room is at max capacity
        if len(room.players) >= room.max_player_count:
            raise ValueError("Room is full.")

        # Allow joining mid-game, new player starts with 0 points
        player_id = str(uuid.uuid4())
        room.players[player_id] = DrawGuessPlayer(
            id=player_id,
            name=player_name,
            username=auth_username,
            character_id=character_id,
        )
        room.scores[player_id] = 0

        # If game is already started and player joins mid-game, add them to drawer order if they won't get a turn too soon
        if room.started and len(room.drawer_order) > 0:
            # Add at a position so they get their turn eventually
            room.drawer_order.append(player_id)

        self._save_room(room)
        return room

    def update_character(self, room_code: str, player_id: str, character_id: str) -> DrawGuessRoom:
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

    def leave_room(self, room_code: str, player_id: str) -> Optional[DrawGuessRoom]:
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

    def update_categories(self, room_code: str, host_id: str, categories: List[str]) -> DrawGuessRoom:
        room = self._get_room(room_code)

        if host_id != room.host_id:
            raise ValueError("Only the host can update categories.")

        if room.started:
            raise ValueError("Categories can only be updated before the game starts.")

        room.categories = self._validate_categories(categories, allow_empty=True)
        self._save_room(room)
        return room

    def remove_player(self, room_code: str, host_id: str, player_id_to_remove: str) -> DrawGuessRoom:
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

    def _cleanup_inactive_players(self, room: DrawGuessRoom) -> None:
        now = datetime.now()
        inactive_player_ids = [
            pid for pid, player in room.players.items()
            if (now - player.last_seen).total_seconds() > 60  # 1 minute
        ]
        for pid in inactive_player_ids:
            del room.players[pid]
            room.scores.pop(pid, None)
        if inactive_player_ids and not room.players:
            self.room_repository.delete_room(room.room_code)
        elif inactive_player_ids and room.started and not self._has_sufficient_players(room):
            self._end_game_insufficient_players(room)
    def heartbeat(self, room_code: str, player_id: str) -> None:
        room = self._get_room(room_code)
        if player_id in room.players:
            room.players[player_id].last_seen = datetime.now()
            self._save_room(room)

    def delete_room(self, room_code: str, player_id: str) -> None:
        room = self._get_room(room_code)

        if player_id != room.host_id:
            raise ValueError("Only the host can delete the room.")

        room.ended = True
        room.end_reason = "host_deleted"
        self._save_room(room)
        self.room_repository.delete_room(room_code)

    def start_game(self, room_code: str) -> DrawGuessRoom:
        room = self._get_room(room_code)

        # Require minimum 2 players to start, can be less than max_player_count
        if len(room.players) < 2:
            raise ValueError("At least 2 players are required to start the game.")

        if not room.categories:
            raise ValueError("At least one category must be selected.")

        room.started = True
        room.ended = False
        room.end_reason = None
        room.winner_ids = []
        room.current_round = 1
        room.drawer_order = list(room.players.keys())

        for player_id in room.players:
            room.scores[player_id] = 0

        self._start_word_choice_phase(room)
        self._save_room(room)
        return room

    def get_room_state(self, room_code: str) -> DrawGuessRoom:
        room = self._get_room(room_code)
        self._cleanup_inactive_players(room)
        self._apply_timeouts(room)
        self._save_room(room)
        return room

    def select_word(self, room_code: str, player_id: str, chosen_word_en: str) -> DrawGuessRoom:
        room = self._get_room(room_code)
        self._apply_timeouts(room)

        if room.phase != "word_choice":
            raise ValueError("This is not the word choice phase.")

        if player_id != room.current_drawer_id:
            raise ValueError("Only the current drawer can choose the word.")

        chosen = next(
            (option for option in room.current_word_choices if option.word_en == chosen_word_en),
            None,
        )
        if chosen is None:
            raise ValueError("Chosen word is invalid.")

        room.current_word = chosen
        room.phase = "drawing"
        room.phase_deadline_at = time.time() + room.round_timer_seconds
        room.strokes = []
        room.guesses = []
        room.guessed_correctly_player_ids = []
        room.last_round_score_changes = {}

        self._save_room(room)
        return room

    def add_stroke(self, room_code: str, player_id: str, stroke: DrawGuessStroke) -> DrawGuessRoom:
        room = self._get_room(room_code)
        self._apply_timeouts(room)

        if room.phase != "drawing":
            raise ValueError("Drawing is not active.")

        if player_id != room.current_drawer_id:
            raise ValueError("Only the current drawer can draw.")

        room.strokes.append(stroke)
        self._save_room(room)
        return room

    def submit_guess(self, room_code: str, player_id: str, guess_text: str) -> DrawGuessRoom:
        room = self._get_room(room_code)
        self._apply_timeouts(room)

        if room.phase != "drawing":
            raise ValueError("Guessing is not active.")

        if player_id == room.current_drawer_id:
            raise ValueError("Drawer cannot submit guesses.")

        if player_id in room.guessed_correctly_player_ids:
            raise ValueError("Player already guessed correctly.")

        if player_id not in room.players:
            raise PlayerNotFoundError("Player not found.")

        guess_text = guess_text.strip()
        if not guess_text:
            raise ValueError("Guess cannot be empty.")

        player = room.players[player_id]
        is_correct = self._is_correct_guess(room, guess_text)

        room.guesses.append(
            DrawGuessGuessMessage(
                player_id=player_id,
                player_name=player.name,
                text=guess_text,
                is_correct=is_correct,
            )
        )

        if is_correct:
            room.guessed_correctly_player_ids.append(player_id)
            
            # Check if all non-drawer players have guessed correctly
            non_drawer_count = len(room.players) - 1
            if len(room.guessed_correctly_player_ids) == non_drawer_count:
                self._resolve_round(room)

        self._save_room(room)
        return room

    def advance_round(self, room_code: str, player_id: str) -> DrawGuessRoom:
        room = self._get_room(room_code)

        if player_id != room.host_id:
            raise ValueError("Only the host can advance the round.")

        if room.phase != "round_result":
            raise ValueError("Round results are not ready yet.")

        if room.current_round >= room.total_rounds:
            self._finish_game(room)
        else:
            room.current_round += 1
            self._start_word_choice_phase(room)

        self._save_room(room)
        return room

    def restart_game(
        self,
        room_code: str,
        categories: List[str],
        total_rounds: int,
        language: str,
        round_timer_seconds: int,
    ) -> DrawGuessRoom:
        room = self._get_room(room_code)

        categories = self._validate_categories(categories)
        self._validate_language(language)
        self._validate_timer(round_timer_seconds)

        room.categories = categories
        room.total_rounds = total_rounds
        room.language = language
        room.round_timer_seconds = round_timer_seconds

        room.started = False
        room.ended = False
        room.end_reason = None
        room.winner_ids = []
        room.current_round = 1
        room.phase = "waiting"
        room.drawer_order = []
        room.current_drawer_id = None
        room.current_word_choices = []
        room.current_word = None
        room.phase_deadline_at = None
        room.strokes = []
        room.guesses = []
        room.guessed_correctly_player_ids = []
        room.last_round_word_en = None
        room.last_round_word_ar = None
        room.last_round_score_changes = {}

        for player_id in room.players:
            room.scores[player_id] = 0

        self._save_room(room)
        return room

    def _start_word_choice_phase(self, room: DrawGuessRoom) -> None:
        drawer_index = (room.current_round - 1) % len(room.drawer_order)
        room.current_drawer_id = room.drawer_order[drawer_index]
        room.phase = "word_choice"
        room.phase_deadline_at = None
        room.current_word = None
        room.current_word_choices = self._get_word_choices(room)
        room.strokes = []
        room.guesses = []
        room.guessed_correctly_player_ids = []
        room.last_round_word_en = None
        room.last_round_word_ar = None
        room.last_round_score_changes = {}

    def _resolve_round(self, room: DrawGuessRoom) -> None:
        room.phase = "round_result"
        room.phase_deadline_at = None

        if room.current_word:
            room.last_round_word_en = room.current_word.word_en
            room.last_round_word_ar = room.current_word.word_ar

        score_changes = {player_id: 0 for player_id in room.players.keys()}

        if room.current_word:
            deadline = room.round_timer_seconds
            for guess in room.guesses:
                if not guess.is_correct:
                    continue

                guess_index = room.guessed_correctly_player_ids.index(guess.player_id)
                bonus = max(20, 100 - (guess_index * 15))
                room.scores[guess.player_id] += bonus
                score_changes[guess.player_id] += bonus

            if room.current_drawer_id:
                drawer_points = 20 * len(room.guessed_correctly_player_ids)
                room.scores[room.current_drawer_id] += drawer_points
                score_changes[room.current_drawer_id] += drawer_points

        room.last_round_score_changes = {
            player_id: delta
            for player_id, delta in score_changes.items()
            if delta != 0
        }

    def _finish_game(self, room: DrawGuessRoom) -> None:
        room.ended = True
        room.end_reason = "game_completed"
        room.phase = "game_over"
        room.phase_deadline_at = None

        if not room.scores:
            room.winner_ids = []
            return

        max_score = max(room.scores.values(), default=0)
        room.winner_ids = [
            player_id
            for player_id, score in room.scores.items()
            if score == max_score
        ]

    def _remove_player_from_room(self, room: DrawGuessRoom, player_id: str) -> None:
        del room.players[player_id]
        room.scores.pop(player_id, None)
        room.drawer_order = [pid for pid in room.drawer_order if pid != player_id]
        room.guessed_correctly_player_ids = [
            pid for pid in room.guessed_correctly_player_ids if pid != player_id
        ]
        room.guesses = [guess for guess in room.guesses if guess.player_id != player_id]
        room.last_round_score_changes.pop(player_id, None)
        room.winner_ids = [pid for pid in room.winner_ids if pid != player_id]

        if room.current_drawer_id == player_id:
            room.current_drawer_id = None

    def _finalize_room_after_player_removal(self, room: DrawGuessRoom) -> None:
        if room.started and not self._has_sufficient_players(room):
            self._end_game_insufficient_players(room)
            return

        if not room.started:
            return

        if room.phase in {"word_choice", "drawing"} and room.current_drawer_id not in room.players:
            if room.drawer_order:
                self._start_word_choice_phase(room)
            else:
                self._end_game_insufficient_players(room)
            return

        if room.phase == "drawing":
            remaining_guessers = [
                pid for pid in room.players.keys()
                if pid != room.current_drawer_id
            ]
            room.guessed_correctly_player_ids = [
                pid for pid in room.guessed_correctly_player_ids
                if pid in remaining_guessers
            ]

            if room.current_drawer_id and len(room.guessed_correctly_player_ids) >= len(remaining_guessers):
                self._resolve_round(room)
                return

        if room.phase == "game_over" and room.end_reason != "insufficient_players":
            self._finish_game(room)

    def _has_sufficient_players(self, room: DrawGuessRoom) -> bool:
        """Check if the game can continue with the current number of players."""
        return len(room.players) >= 2

    def _end_game_insufficient_players(self, room: DrawGuessRoom) -> None:
        """End the game due to insufficient players."""
        room.ended = True
        room.end_reason = "insufficient_players"
        room.phase = "game_over"
        room.phase_deadline_at = None

    def _apply_timeouts(self, room: DrawGuessRoom) -> None:
        if room.phase_deadline_at is None:
            return
        if time.time() < room.phase_deadline_at:
            return
        if room.phase == "drawing":
            self._resolve_round(room)

    def _get_word_choices(self, room: DrawGuessRoom) -> List[DrawGuessWordOption]:
        pool: List[DrawGuessWordOption] = []

        for category in room.categories:
            for item in DRAW_CATEGORIES.get(category, []):
                pool.append(
                    DrawGuessWordOption(
                        word_en=item["word_en"],
                        word_ar=item["word_ar"],
                        aliases_en=item.get("aliases_en", []),
                        aliases_ar=item.get("aliases_ar", []),
                        difficulty=item.get("difficulty", "easy"),
                    )
                )

        if len(pool) < 3:
            raise ValueError("Not enough words to generate choices.")

        return random.sample(pool, 3)

    def _is_correct_guess(self, room: DrawGuessRoom, guess_text: str) -> bool:
        if room.current_word is None:
            return False

        valid_answers = {
            self._normalize_text(room.current_word.word_en),
            self._normalize_text(room.current_word.word_ar),
        }

        valid_answers.update(self._normalize_text(x) for x in room.current_word.aliases_en)
        valid_answers.update(self._normalize_text(x) for x in room.current_word.aliases_ar)

        return self._normalize_text(guess_text) in valid_answers

    def _normalize_text(self, text: str) -> str:
        return " ".join(text.strip().lower().split())

    def _validate_categories(self, categories: List[str], allow_empty: bool = False) -> List[str]:
        categories = list(dict.fromkeys(categories))

        if not categories and not allow_empty:
            raise ValueError("At least one category must be selected.")

        invalid = [category for category in categories if category not in DRAW_CATEGORIES]
        if invalid:
            raise ValueError(f"Invalid categories: {', '.join(invalid)}")

        return categories

    def _validate_language(self, language: str) -> None:
        if language not in {"en", "ar"}:
            raise ValueError("Language must be 'en' or 'ar'.")

    def _validate_timer(self, round_timer_seconds: int) -> None:
        if round_timer_seconds not in {30, 60, 90}:
            raise ValueError("Round timer must be 30, 60, or 90 seconds.")

    def _get_room(self, room_code: str) -> DrawGuessRoom:
        raw_room = self.room_repository.get_room(room_code)
        if not raw_room:
            raise RoomNotFoundError("Room not found.")
        return self._deserialize_room(raw_room)

    def _save_room(self, room: DrawGuessRoom) -> None:
        self.room_repository.save_room(room.room_code, self._serialize_room(room))

    def _serialize_room(self, room: DrawGuessRoom) -> dict:
        return {
            "room_code": room.room_code,
            "host_id": room.host_id,
            "max_player_count": room.max_player_count,
            "total_rounds": room.total_rounds,
            "categories": room.categories,
            "language": room.language,
            "round_timer_seconds": room.round_timer_seconds,
            "started": room.started,
            "ended": room.ended,
            "end_reason": room.end_reason,
            "winner_ids": room.winner_ids,
            "current_round": room.current_round,
            "phase": room.phase,
            "scores": room.scores,
            "drawer_order": room.drawer_order,
            "current_drawer_id": room.current_drawer_id,
            "phase_deadline_at": room.phase_deadline_at,
            "guessed_correctly_player_ids": room.guessed_correctly_player_ids,
            "last_round_word_en": room.last_round_word_en,
            "last_round_word_ar": room.last_round_word_ar,
            "last_round_score_changes": room.last_round_score_changes,
            "players": {
                player_id: {
                    "id": player.id,
                    "name": player.name,
                    "username": player.username,
                    "character_id": player.character_id,
                }
                for player_id, player in room.players.items()
            },
            "current_word_choices": [
                {
                    "word_en": option.word_en,
                    "word_ar": option.word_ar,
                    "aliases_en": option.aliases_en,
                    "aliases_ar": option.aliases_ar,
                    "difficulty": option.difficulty,
                }
                for option in room.current_word_choices
            ],
            "current_word": (
                {
                    "word_en": room.current_word.word_en,
                    "word_ar": room.current_word.word_ar,
                    "aliases_en": room.current_word.aliases_en,
                    "aliases_ar": room.current_word.aliases_ar,
                    "difficulty": room.current_word.difficulty,
                }
                if room.current_word
                else None
            ),
            "strokes": [
                {
                    "x0": s.x0,
                    "y0": s.y0,
                    "x1": s.x1,
                    "y1": s.y1,
                    "color": s.color,
                    "width": s.width,
                    "tool": s.tool,
                }
                for s in room.strokes
            ],
            "guesses": [
                {
                    "player_id": g.player_id,
                    "player_name": g.player_name,
                    "text": g.text,
                    "is_correct": g.is_correct,
                }
                for g in room.guesses
            ],
        }

    def _deserialize_room(self, data: dict) -> DrawGuessRoom:
        room = DrawGuessRoom(
            room_code=data["room_code"],
            host_id=data["host_id"],
            max_player_count=data["max_player_count"],
            total_rounds=data["total_rounds"],
            categories=data.get("categories", []),
            language=data.get("language", "en"),
            round_timer_seconds=data.get("round_timer_seconds", 60),
            started=data.get("started", False),
            ended=data.get("ended", False),
            end_reason=data.get("end_reason"),
            winner_ids=data.get("winner_ids", []),
            current_round=data.get("current_round", 1),
            phase=data.get("phase", "waiting"),
            scores=data.get("scores", {}),
            drawer_order=data.get("drawer_order", []),
            current_drawer_id=data.get("current_drawer_id"),
            phase_deadline_at=data.get("phase_deadline_at"),
            guessed_correctly_player_ids=data.get("guessed_correctly_player_ids", []),
            last_round_word_en=data.get("last_round_word_en"),
            last_round_word_ar=data.get("last_round_word_ar"),
            last_round_score_changes=data.get("last_round_score_changes", {}),
        )

        for player_id, player_data in data.get("players", {}).items():
            room.players[player_id] = DrawGuessPlayer(
                id=player_data["id"],
                name=player_data["name"],
                username=player_data.get("username"),
                character_id=player_data.get("character_id", "char1"),
            )

        for item in data.get("current_word_choices", []):
            room.current_word_choices.append(
                DrawGuessWordOption(
                    word_en=item["word_en"],
                    word_ar=item["word_ar"],
                    aliases_en=item.get("aliases_en", []),
                    aliases_ar=item.get("aliases_ar", []),
                    difficulty=item.get("difficulty", "easy"),
                )
            )

        current_word = data.get("current_word")
        if current_word:
            room.current_word = DrawGuessWordOption(
                word_en=current_word["word_en"],
                word_ar=current_word["word_ar"],
                aliases_en=current_word.get("aliases_en", []),
                aliases_ar=current_word.get("aliases_ar", []),
                difficulty=current_word.get("difficulty", "easy"),
            )

        for item in data.get("strokes", []):
            room.strokes.append(
                DrawGuessStroke(
                    x0=item["x0"],
                    y0=item["y0"],
                    x1=item["x1"],
                    y1=item["y1"],
                    color=item["color"],
                    width=item["width"],
                    tool=item.get("tool", "pen"),
                )
            )

        for item in data.get("guesses", []):
            room.guesses.append(
                DrawGuessGuessMessage(
                    player_id=item["player_id"],
                    player_name=item["player_name"],
                    text=item["text"],
                    is_correct=item.get("is_correct", False),
                )
            )

        return room
