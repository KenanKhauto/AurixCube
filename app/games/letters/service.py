"""Business logic for the Arabic letters category game."""

from __future__ import annotations

import random
import re
import time
import uuid
from datetime import datetime
from typing import Optional

from app.core.exceptions import PlayerNotFoundError, RoomNotFoundError, StaleRoomVersionError
from app.core.utils import generate_room_code
from app.games.letters.constants import (
    ARABIC_LETTERS,
    MAX_ACTIVE_CATEGORIES,
    MAX_CATEGORY_LENGTH,
    MAX_CUSTOM_CATEGORIES,
    PRESET_CATEGORY_LABELS,
)
from app.games.letters.domain import LettersPlayer, LettersRoom, LettersVoteRecord
from app.repositories.room_repository import RoomRepository
from app.services.game_history_service import record_completed_room
from app.services.room_storage import get_room_repository


class LettersGameService:
    def __init__(self, room_repository: RoomRepository | None = None) -> None:
        self.room_repository = room_repository or get_room_repository("letters")

    def create_room(
        self,
        host_name: str,
        character_id: str,
        auth_username: str | None,
        max_player_count: int,
        total_rounds: int,
        answer_timer_seconds: int,
        no_timer: bool,
        min_done_seconds: int,
        preset_category_ids: list[str],
        custom_categories: list[str],
    ) -> LettersRoom:
        preset_ids, cleaned_custom, active_categories = self._prepare_categories(
            preset_category_ids, custom_categories
        )
        self._validate_settings(
            total_rounds,
            answer_timer_seconds,
            no_timer,
            min_done_seconds,
            active_categories,
            allow_empty_categories=True,
        )

        room_code = generate_room_code()
        host_id = str(uuid.uuid4())
        room = LettersRoom(
            room_code=room_code,
            host_id=host_id,
            session_id=str(uuid.uuid4()),
            max_player_count=max_player_count,
            total_rounds=total_rounds,
            answer_timer_seconds=answer_timer_seconds,
            no_timer=no_timer,
            min_done_seconds=min_done_seconds,
            preset_category_ids=preset_ids,
            custom_categories=cleaned_custom,
            active_categories=active_categories,
            allowed_letters=ARABIC_LETTERS[:],
        )
        room.players[host_id] = LettersPlayer(
            id=host_id,
            name=host_name,
            username=auth_username,
            character_id=character_id,
        )
        room.scores[host_id] = 0
        room.submissions[host_id] = self._blank_answers(active_categories)
        self._save_room(room)
        return room

    def join_room(self, room_code: str, player_name: str, character_id: str, auth_username: str | None) -> LettersRoom:
        room = self._get_room(room_code)
        self._apply_timeouts(room)
        if room.ended:
            raise ValueError("Game has ended.")
        if len(room.players) >= room.max_player_count:
            raise ValueError("Room is full.")
        if any(player.name == player_name for player in room.players.values()):
            raise ValueError("Player name already exists in this room.")

        player_id = str(uuid.uuid4())
        room.players[player_id] = LettersPlayer(
            id=player_id,
            name=player_name,
            username=auth_username,
            character_id=character_id,
        )
        room.scores[player_id] = room.scores.get(player_id, 0)
        room.submissions[player_id] = self._blank_answers(room.active_categories)
        if room.started:
            room.chooser_order.append(player_id)
        self._save_room(room)
        return room

    def update_character(self, room_code: str, player_id: str, character_id: str) -> LettersRoom:
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

    def update_settings(
        self,
        room_code: str,
        host_id: str,
        max_player_count: int,
        total_rounds: int,
        answer_timer_seconds: int,
        no_timer: bool,
        min_done_seconds: int,
        preset_category_ids: list[str],
        custom_categories: list[str],
    ) -> LettersRoom:
        room = self._get_room(room_code)
        if host_id != room.host_id:
            raise ValueError("Only the host can update settings.")
        if room.started:
            raise ValueError("Settings can only be updated before the game starts.")
        preset_ids, cleaned_custom, active_categories = self._prepare_categories(
            preset_category_ids, custom_categories
        )
        self._validate_settings(
            total_rounds,
            answer_timer_seconds,
            no_timer,
            min_done_seconds,
            active_categories,
            allow_empty_categories=True,
        )
        if max_player_count < len(room.players):
            raise ValueError("Max players cannot be lower than current player count.")

        room.max_player_count = max_player_count
        room.total_rounds = total_rounds
        room.answer_timer_seconds = answer_timer_seconds
        room.no_timer = no_timer
        room.min_done_seconds = min_done_seconds
        room.preset_category_ids = preset_ids
        room.custom_categories = cleaned_custom
        room.active_categories = active_categories
        for player_id in room.players:
            room.submissions[player_id] = self._resize_answers(room.submissions.get(player_id, []), active_categories)
        self._save_room(room)
        return room

    def leave_room(self, room_code: str, player_id: str) -> Optional[LettersRoom]:
        room = self._get_room(room_code)
        self._apply_timeouts(room)
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

    def remove_player(self, room_code: str, host_id: str, player_id_to_remove: str) -> LettersRoom:
        room = self._get_room(room_code)
        self._apply_timeouts(room)
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
        room = self._get_room(room_code)
        if player_id != room.host_id:
            raise ValueError("Only the host can delete the room.")
        room.ended = True
        room.history_recorded = False
        room.end_reason = "host_deleted"
        self._save_room(room)
        self.room_repository.delete_room(room_code)

    def start_game(self, room_code: str, host_id: str) -> LettersRoom:
        room = self._get_room(room_code)
        if host_id != room.host_id:
            raise ValueError("Only the host can start the game.")
        if len(room.players) < 2:
            raise ValueError("At least 2 players are required to start the game.")
        self._validate_settings(
            room.total_rounds,
            room.answer_timer_seconds,
            room.no_timer,
            room.min_done_seconds,
            room.active_categories,
        )
        room.started = True
        room.ended = False
        room.history_recorded = False
        room.end_reason = None
        room.winner_ids = []
        room.current_round = 1
        room.used_letters = []
        room.current_letter = None
        room.last_round_letter = None
        room.last_round_locked_by = None
        room.last_round_locked_by_player_id = None
        room.last_round_score_changes = {}
        room.last_round_player_stats = {}
        room.chooser_order = list(room.players.keys())
        random.shuffle(room.chooser_order)
        room.chooser_rotation_index = 0
        for player_id in room.players:
            room.scores[player_id] = 0
            room.submissions[player_id] = self._blank_answers(room.active_categories)
        self._start_choose_letter_phase(room)
        self._save_room(room)
        return room

    def restart_game(
        self,
        room_code: str,
        host_id: str,
        max_player_count: int,
        total_rounds: int,
        answer_timer_seconds: int,
        no_timer: bool,
        min_done_seconds: int,
        preset_category_ids: list[str],
        custom_categories: list[str],
    ) -> LettersRoom:
        room = self._get_room(room_code)
        if host_id != room.host_id:
            raise ValueError("Only the host can restart the room.")
        preset_ids, cleaned_custom, active_categories = self._prepare_categories(
            preset_category_ids, custom_categories
        )
        self._validate_settings(
            total_rounds,
            answer_timer_seconds,
            no_timer,
            min_done_seconds,
            active_categories,
            allow_empty_categories=True,
        )
        if max_player_count < len(room.players):
            raise ValueError("Max players cannot be lower than current player count.")
        room.max_player_count = max_player_count
        room.total_rounds = total_rounds
        room.answer_timer_seconds = answer_timer_seconds
        room.no_timer = no_timer
        room.min_done_seconds = min_done_seconds
        room.preset_category_ids = preset_ids
        room.custom_categories = cleaned_custom
        room.active_categories = active_categories
        room.allowed_letters = ARABIC_LETTERS[:]
        room.session_id = str(uuid.uuid4())
        room.started = False
        room.ended = False
        room.history_recorded = False
        room.end_reason = None
        room.winner_ids = []
        room.current_round = 1
        room.phase = "waiting"
        room.phase_started_at = None
        room.phase_deadline_at = None
        room.done_available_at = None
        room.chooser_order = []
        room.chooser_rotation_index = 0
        room.current_chooser_id = None
        room.current_letter = None
        room.used_letters = []
        room.answer_votes = {}
        room.round_answer_results = {}
        room.last_round_score_changes = {}
        room.last_round_player_stats = {}
        room.last_round_letter = None
        room.last_round_locked_by = None
        room.last_round_locked_by_player_id = None
        for player_id in room.players:
            room.scores[player_id] = 0
            room.submissions[player_id] = self._blank_answers(active_categories)
        self._save_room(room)
        return room

    def choose_letter(self, room_code: str, player_id: str, letter: str) -> LettersRoom:
        room = self._get_room(room_code)
        self._apply_timeouts(room)
        if room.phase != "choosing_letter":
            raise ValueError("It is not the letter selection phase.")
        if player_id != room.current_chooser_id:
            raise ValueError("Only the current chooser can select the letter.")
        normalized_letter = self._normalize_letter(letter)
        if normalized_letter not in room.allowed_letters:
            raise ValueError("Invalid letter.")
        if normalized_letter in room.used_letters:
            raise ValueError("This letter has already been used.")
        room.current_letter = normalized_letter
        room.used_letters.append(normalized_letter)
        self._start_answering_phase(room)
        self._save_room(room)
        return room

    def advance_phase(self, room_code: str, host_id: str) -> LettersRoom:
        room = self._get_room(room_code)
        self._apply_timeouts(room)
        if host_id != room.host_id:
            raise ValueError("Only the host can advance phases.")
        if not room.started or room.ended:
            raise ValueError("Game is not in an active phase.")

        if room.phase == "choosing_letter":
            available_letters = [letter for letter in room.allowed_letters if letter not in room.used_letters]
            if not available_letters:
                self._finish_game(room, end_reason="letters_exhausted")
            else:
                room.current_letter = random.choice(available_letters)
                room.used_letters.append(room.current_letter)
                self._start_answering_phase(room)
        elif room.phase == "answering":
            self._lock_answers(room, locked_by="host", locked_by_player_id=host_id)
        elif room.phase == "reveal":
            self._start_voting_phase(room)
        elif room.phase == "voting":
            self._resolve_round(room)
        elif room.phase == "round_result":
            self._advance_after_round_result(room)
        else:
            raise ValueError("Cannot advance this phase.")

        self._save_room(room)
        return room

    def submit_answers(self, room_code: str, player_id: str, answers: list[str]) -> LettersRoom:
        room = self._get_room(room_code)
        self._apply_timeouts(room)
        if room.phase != "answering":
            raise ValueError("Answer submission is not active.")
        if player_id not in room.players:
            raise PlayerNotFoundError("Player not found.")
        room.submissions[player_id] = self._sanitize_answers(answers, room.active_categories)
        self._save_room(room)
        return room

    def press_done(self, room_code: str, player_id: str, answers: list[str]) -> LettersRoom:
        room = self._get_room(room_code)
        self._apply_timeouts(room)
        if room.phase != "answering":
            raise ValueError("Answering phase is not active.")
        if player_id not in room.players:
            raise PlayerNotFoundError("Player not found.")
        now = time.time()
        if room.done_available_at and now < room.done_available_at:
            raise ValueError("Done button is not available yet.")
        room.submissions[player_id] = self._sanitize_answers(answers, room.active_categories)
        self._lock_answers(room, locked_by="done", locked_by_player_id=player_id)
        self._save_room(room)
        return room

    def submit_vote(self, room_code: str, player_id: str, answer_id: str, verdict: str) -> LettersRoom:
        room = self._get_room(room_code)
        self._apply_timeouts(room)
        if room.phase != "voting":
            raise ValueError("Voting phase is not active.")
        if player_id not in room.players:
            raise PlayerNotFoundError("Player not found.")
        if verdict not in {"valid", "invalid"}:
            raise ValueError("Invalid verdict.")
        entry = self._get_answer_entry(room, answer_id)
        if entry["is_empty"]:
            raise ValueError("Empty answers cannot be voted on.")
        if entry["player_id"] == player_id:
            raise ValueError("Players cannot vote on their own answers.")
        record = room.answer_votes.setdefault(answer_id, LettersVoteRecord())
        record.valid_player_ids = [pid for pid in record.valid_player_ids if pid != player_id]
        record.invalid_player_ids = [pid for pid in record.invalid_player_ids if pid != player_id]
        target_list = record.valid_player_ids if verdict == "valid" else record.invalid_player_ids
        target_list.append(player_id)
        if self._is_voting_complete(room):
            self._resolve_round(room)
        self._save_room(room)
        return room

    def get_room_state(self, room_code: str) -> LettersRoom:
        room = self._get_room(room_code)
        self._cleanup_inactive_players(room)
        self._apply_timeouts(room)
        if room.players:
            self._save_room(room)
        return room

    def list_preset_categories(self) -> list[dict]:
        return [{"id": key, "label": label} for key, label in PRESET_CATEGORY_LABELS.items()]

    def build_answer_entries(self, room: LettersRoom, viewer_player_id: str | None = None) -> list[dict]:
        entries: list[dict] = []
        for player_id, player in room.players.items():
            answers = room.submissions.get(player_id, self._blank_answers(room.active_categories))
            for category_index, category_label in enumerate(room.active_categories):
                answer_text = answers[category_index] if category_index < len(answers) else ""
                answer_id = self._answer_id(player_id, category_index)
                votes = room.answer_votes.get(answer_id, LettersVoteRecord())
                result = room.round_answer_results.get(answer_id, {})
                entries.append(
                    {
                        "answer_id": answer_id,
                        "player_id": player_id,
                        "player_name": player.name,
                        "category_index": category_index,
                        "category_label": category_label,
                        "answer_text": answer_text,
                        "normalized_answer": self._normalize_answer(answer_text),
                        "is_empty": not bool(answer_text.strip()),
                        "valid_votes": len(votes.valid_player_ids),
                        "invalid_votes": len(votes.invalid_player_ids),
                        "my_vote": self._get_my_vote(votes, viewer_player_id),
                        "final_status": result.get("final_status"),
                        "points_awarded": int(result.get("points_awarded", 0)),
                        "duplicate_count": int(result.get("duplicate_count", 0)),
                        "can_vote": (
                            room.phase == "voting"
                            and bool(answer_text.strip())
                            and viewer_player_id is not None
                            and viewer_player_id != player_id
                        ),
                    }
                )
        return entries

    def _cleanup_inactive_players(self, room: LettersRoom) -> None:
        now = datetime.now()
        inactive_player_ids = [
            pid for pid, player in room.players.items()
            if (now - player.last_seen).total_seconds() > 60
        ]
        for player_id in inactive_player_ids:
            self._remove_player_from_room(room, player_id)
        if inactive_player_ids and not room.players:
            self.room_repository.delete_room(room.room_code)
        elif inactive_player_ids:
            self._finalize_room_after_player_removal(room)

    def _start_choose_letter_phase(self, room: LettersRoom) -> None:
        if room.current_round > room.total_rounds or len(room.used_letters) >= len(room.allowed_letters):
            self._finish_game(room, end_reason="game_completed")
            return
        active_order = [player_id for player_id in room.chooser_order if player_id in room.players]
        if not active_order or len(room.players) < 2:
            self._end_game_insufficient_players(room)
            return
        room.chooser_order = active_order
        room.chooser_rotation_index = room.chooser_rotation_index % len(active_order)
        room.current_chooser_id = active_order[room.chooser_rotation_index]
        room.phase = "choosing_letter"
        room.phase_started_at = time.time()
        room.phase_deadline_at = None
        room.done_available_at = None
        room.current_letter = None
        room.answer_votes = {}
        room.round_answer_results = {}
        room.last_round_score_changes = {}
        room.last_round_player_stats = {}
        for player_id in room.players:
            room.submissions[player_id] = self._blank_answers(room.active_categories)

    def _start_answering_phase(self, room: LettersRoom) -> None:
        now = time.time()
        room.phase = "answering"
        room.phase_started_at = now
        room.phase_deadline_at = None
        room.done_available_at = now + room.min_done_seconds
        room.answer_votes = {}
        room.round_answer_results = {}
        room.last_round_score_changes = {}
        room.last_round_player_stats = {}
        for player_id in room.players:
            room.submissions[player_id] = self._resize_answers(room.submissions.get(player_id, []), room.active_categories)

    def _lock_answers(self, room: LettersRoom, locked_by: str, locked_by_player_id: str | None) -> None:
        room.last_round_letter = room.current_letter
        room.last_round_locked_by = locked_by
        room.last_round_locked_by_player_id = locked_by_player_id
        room.phase = "reveal"
        room.phase_started_at = time.time()
        room.phase_deadline_at = None
        room.done_available_at = None
        room.answer_votes = {}
        room.round_answer_results = {}

    def _start_voting_phase(self, room: LettersRoom) -> None:
        room.phase = "voting"
        room.phase_started_at = time.time()
        room.phase_deadline_at = None
        room.done_available_at = None
        for entry in self.build_answer_entries(room):
            if entry["is_empty"]:
                continue
            room.answer_votes.setdefault(entry["answer_id"], LettersVoteRecord())

    def _resolve_round(self, room: LettersRoom) -> None:
        answer_entries = self.build_answer_entries(room)
        valid_entries_by_category: dict[int, list[dict]] = {}
        room.round_answer_results = {}
        score_changes = {player_id: 0 for player_id in room.players}
        stats = {
            player_id: {"unique_answers": 0, "duplicate_answers": 0, "invalid_answers": 0}
            for player_id in room.players
        }

        for entry in answer_entries:
            answer_id = entry["answer_id"]
            if entry["is_empty"]:
                room.round_answer_results[answer_id] = {
                    "final_status": "empty",
                    "points_awarded": 0,
                    "duplicate_count": 0,
                }
                continue

            votes = room.answer_votes.get(answer_id, LettersVoteRecord())
            valid_votes = len(votes.valid_player_ids)
            invalid_votes = len(votes.invalid_player_ids)
            normalized = entry["normalized_answer"]

            if invalid_votes >= valid_votes and (valid_votes + invalid_votes) > 0:
                room.round_answer_results[answer_id] = {
                    "final_status": "invalid",
                    "points_awarded": 0,
                    "duplicate_count": 0,
                }
                stats[entry["player_id"]]["invalid_answers"] += 1
                continue

            if not self._starts_with_letter(entry["answer_text"], room.current_letter or ""):
                room.round_answer_results[answer_id] = {
                    "final_status": "invalid",
                    "points_awarded": 0,
                    "duplicate_count": 0,
                }
                stats[entry["player_id"]]["invalid_answers"] += 1
                continue

            room.round_answer_results[answer_id] = {
                "final_status": "valid",
                "points_awarded": 0,
                "duplicate_count": 1,
            }
            valid_entries_by_category.setdefault(entry["category_index"], []).append(
                {
                    "answer_id": answer_id,
                    "player_id": entry["player_id"],
                    "normalized_answer": normalized,
                }
            )

        for entries in valid_entries_by_category.values():
            counts: dict[str, int] = {}
            for entry in entries:
                counts[entry["normalized_answer"]] = counts.get(entry["normalized_answer"], 0) + 1
            for entry in entries:
                duplicate_count = counts.get(entry["normalized_answer"], 1)
                points = 10 if duplicate_count == 1 else 5
                room.round_answer_results[entry["answer_id"]]["points_awarded"] = points
                room.round_answer_results[entry["answer_id"]]["duplicate_count"] = duplicate_count
                score_changes[entry["player_id"]] += points
                if duplicate_count == 1:
                    stats[entry["player_id"]]["unique_answers"] += 1
                else:
                    stats[entry["player_id"]]["duplicate_answers"] += 1

        for player_id, delta in score_changes.items():
            room.scores[player_id] = room.scores.get(player_id, 0) + delta

        room.last_round_score_changes = {player_id: delta for player_id, delta in score_changes.items() if delta}
        room.last_round_player_stats = stats
        room.phase = "round_result"
        room.phase_started_at = time.time()
        room.phase_deadline_at = None
        room.done_available_at = None

    def _advance_after_round_result(self, room: LettersRoom) -> None:
        room.chooser_rotation_index += 1
        room.current_round += 1
        room.current_letter = None
        room.answer_votes = {}
        room.round_answer_results = {}
        if room.current_round > room.total_rounds or len(room.used_letters) >= len(room.allowed_letters):
            self._finish_game(room, end_reason="game_completed")
            return
        self._start_choose_letter_phase(room)

    def _finish_game(self, room: LettersRoom, end_reason: str) -> None:
        room.ended = True
        room.end_reason = end_reason
        room.phase = "finished"
        room.phase_started_at = time.time()
        room.phase_deadline_at = None
        room.done_available_at = None
        room.current_chooser_id = None
        if room.scores:
            max_score = max(room.scores.values(), default=0)
            room.winner_ids = [
                player_id
                for player_id, score in room.scores.items()
                if score == max_score
            ]
        else:
            room.winner_ids = []

    def _end_game_insufficient_players(self, room: LettersRoom) -> None:
        self._finish_game(room, end_reason="insufficient_players")

    def _apply_timeouts(self, room: LettersRoom) -> None:
        now = time.time()
        if room.phase == "answering" and room.phase_deadline_at and now >= room.phase_deadline_at:
            self._lock_answers(room, locked_by="timer", locked_by_player_id=None)
            return
        if room.phase == "voting" and room.phase_deadline_at and now >= room.phase_deadline_at:
            self._resolve_round(room)
            return

    def _is_voting_complete(self, room: LettersRoom) -> bool:
        entries = self.build_answer_entries(room)
        relevant_entries = [entry for entry in entries if not entry["is_empty"]]
        if not relevant_entries:
            return True
        current_player_ids = set(room.players.keys())
        for entry in relevant_entries:
            eligible_count = len([pid for pid in current_player_ids if pid != entry["player_id"]])
            votes = room.answer_votes.get(entry["answer_id"], LettersVoteRecord())
            cast_votes = {
                pid for pid in votes.valid_player_ids + votes.invalid_player_ids
                if pid in current_player_ids and pid != entry["player_id"]
            }
            if len(cast_votes) < eligible_count:
                return False
        return True

    def _finalize_room_after_player_removal(self, room: LettersRoom) -> None:
        if not room.players:
            return
        if room.host_id not in room.players:
            room.host_id = next(iter(room.players.keys()))
        if room.started and len(room.players) < 2:
            self._end_game_insufficient_players(room)
            return
        room.chooser_order = [player_id for player_id in room.chooser_order if player_id in room.players]
        if room.started and not room.chooser_order:
            room.chooser_order = list(room.players.keys())
        for player_id in room.players:
            room.scores[player_id] = room.scores.get(player_id, 0)
            room.submissions[player_id] = self._resize_answers(room.submissions.get(player_id, []), room.active_categories)
        if room.phase == "choosing_letter" and room.current_chooser_id not in room.players:
            active_order = [player_id for player_id in room.chooser_order if player_id in room.players]
            if active_order:
                room.chooser_rotation_index = room.chooser_rotation_index % len(active_order)
                room.current_chooser_id = active_order[room.chooser_rotation_index]
            else:
                self._end_game_insufficient_players(room)
            return
        if room.phase == "voting":
            for answer_id in list(room.answer_votes.keys()):
                author_id, _ = self._parse_answer_id(answer_id)
                if author_id not in room.players:
                    room.answer_votes.pop(answer_id, None)
                    room.round_answer_results.pop(answer_id, None)
                    continue
                votes = room.answer_votes[answer_id]
                votes.valid_player_ids = [pid for pid in votes.valid_player_ids if pid in room.players]
                votes.invalid_player_ids = [pid for pid in votes.invalid_player_ids if pid in room.players]
            if self._is_voting_complete(room):
                self._resolve_round(room)
                return

    def _remove_player_from_room(self, room: LettersRoom, player_id: str) -> None:
        room.players.pop(player_id, None)
        room.scores.pop(player_id, None)
        room.submissions.pop(player_id, None)
        room.chooser_order = [pid for pid in room.chooser_order if pid != player_id]
        for answer_id in list(room.answer_votes.keys()):
            author_id, _ = self._parse_answer_id(answer_id)
            if author_id == player_id:
                room.answer_votes.pop(answer_id, None)
                room.round_answer_results.pop(answer_id, None)
                continue
            votes = room.answer_votes[answer_id]
            votes.valid_player_ids = [pid for pid in votes.valid_player_ids if pid != player_id]
            votes.invalid_player_ids = [pid for pid in votes.invalid_player_ids if pid != player_id]
        if room.current_chooser_id == player_id:
            room.current_chooser_id = None

    def _prepare_categories(self, preset_category_ids: list[str], custom_categories: list[str]) -> tuple[list[str], list[str], list[str]]:
        clean_preset_ids: list[str] = []
        for category_id in preset_category_ids:
            value = str(category_id or "").strip()
            if value in PRESET_CATEGORY_LABELS and value not in clean_preset_ids:
                clean_preset_ids.append(value)
        normalized_seen = {self._normalize_category_label(PRESET_CATEGORY_LABELS[item]) for item in clean_preset_ids}
        clean_custom_categories: list[str] = []
        for raw_category in custom_categories[:MAX_CUSTOM_CATEGORIES]:
            cleaned = self._sanitize_category_label(raw_category)
            if not cleaned:
                continue
            normalized = self._normalize_category_label(cleaned)
            if normalized in normalized_seen:
                continue
            normalized_seen.add(normalized)
            clean_custom_categories.append(cleaned)
        active_categories = [PRESET_CATEGORY_LABELS[item] for item in clean_preset_ids] + clean_custom_categories
        if len(active_categories) > MAX_ACTIVE_CATEGORIES:
            active_categories = active_categories[:MAX_ACTIVE_CATEGORIES]
            clean_custom_categories = active_categories[len(clean_preset_ids):]
        return clean_preset_ids, clean_custom_categories, active_categories

    def _validate_settings(
        self,
        total_rounds: int,
        answer_timer_seconds: int,
        no_timer: bool,
        min_done_seconds: int,
        active_categories: list[str],
        allow_empty_categories: bool = False,
    ) -> None:
        if not active_categories and not allow_empty_categories:
            raise ValueError("At least one category must be selected.")
        if len(active_categories) > MAX_ACTIVE_CATEGORIES:
            raise ValueError(f"You can select up to {MAX_ACTIVE_CATEGORIES} categories only.")
        if total_rounds < 1 or total_rounds > 20:
            raise ValueError("Rounds must be between 1 and 20.")
        if answer_timer_seconds < 15 or answer_timer_seconds > 180:
            raise ValueError("Timer must be between 15 and 180 seconds.")
        if min_done_seconds < 0 or min_done_seconds > 120:
            raise ValueError("Minimum done time must be between 0 and 120 seconds.")
        if not no_timer and min_done_seconds >= answer_timer_seconds:
            raise ValueError("Minimum done time must be lower than the answer timer.")

    def _sanitize_answers(self, answers: list[str], active_categories: list[str]) -> list[str]:
        sanitized: list[str] = []
        for index in range(len(active_categories)):
            value = answers[index] if index < len(answers) else ""
            cleaned = " ".join(str(value or "").strip().split())
            sanitized.append(cleaned[:60])
        return sanitized

    def _blank_answers(self, active_categories: list[str]) -> list[str]:
        return ["" for _ in active_categories]

    def _resize_answers(self, answers: list[str], active_categories: list[str]) -> list[str]:
        values = list(answers[: len(active_categories)])
        while len(values) < len(active_categories):
            values.append("")
        return values

    def _sanitize_category_label(self, value: str) -> str:
        cleaned = " ".join(str(value or "").strip().split())
        return cleaned[:MAX_CATEGORY_LENGTH]

    def _normalize_category_label(self, value: str) -> str:
        return " ".join(str(value or "").strip().lower().split())

    def _normalize_letter(self, value: str) -> str:
        return str(value or "").strip()[:1]

    def _normalize_answer(self, value: str) -> str:
        return " ".join(str(value or "").strip().lower().split())

    def _starts_with_letter(self, answer_text: str, letter: str) -> bool:
        normalized_answer = str(answer_text or "").strip()
        if not normalized_answer or not letter:
            return False
        return normalized_answer.startswith(letter)

    def _answer_id(self, player_id: str, category_index: int) -> str:
        return f"{player_id}:{category_index}"

    def _parse_answer_id(self, answer_id: str) -> tuple[str, int]:
        player_id, _, raw_index = str(answer_id).partition(":")
        return player_id, int(raw_index or 0)

    def _get_answer_entry(self, room: LettersRoom, answer_id: str) -> dict:
        player_id, category_index = self._parse_answer_id(answer_id)
        if player_id not in room.players:
            raise PlayerNotFoundError("Answer owner not found.")
        if category_index < 0 or category_index >= len(room.active_categories):
            raise ValueError("Answer entry not found.")
        answers = room.submissions.get(player_id, self._blank_answers(room.active_categories))
        answer_text = answers[category_index] if category_index < len(answers) else ""
        return {
            "answer_id": answer_id,
            "player_id": player_id,
            "player_name": room.players[player_id].name,
            "category_index": category_index,
            "category_label": room.active_categories[category_index],
            "answer_text": answer_text,
            "is_empty": not bool(answer_text.strip()),
        }

    def _get_my_vote(self, votes: LettersVoteRecord, viewer_player_id: str | None) -> str | None:
        if not viewer_player_id:
            return None
        if viewer_player_id in votes.valid_player_ids:
            return "valid"
        if viewer_player_id in votes.invalid_player_ids:
            return "invalid"
        return None

    def _get_room(self, room_code: str) -> LettersRoom:
        raw_room = self.room_repository.get_room(room_code)
        if not raw_room:
            raise RoomNotFoundError("Room not found.")
        return self._deserialize_room(raw_room)

    def _serialize_room(self, room: LettersRoom) -> dict:
        return {
            "room_code": room.room_code,
            "session_id": room.session_id,
            "room_version": room.room_version,
            "host_id": room.host_id,
            "max_player_count": room.max_player_count,
            "total_rounds": room.total_rounds,
            "answer_timer_seconds": room.answer_timer_seconds,
            "no_timer": room.no_timer,
            "min_done_seconds": room.min_done_seconds,
            "preset_category_ids": room.preset_category_ids,
            "custom_categories": room.custom_categories,
            "active_categories": room.active_categories,
            "allowed_letters": room.allowed_letters,
            "started": room.started,
            "ended": room.ended,
            "history_recorded": room.history_recorded,
            "end_reason": room.end_reason,
            "winner_ids": room.winner_ids,
            "current_round": room.current_round,
            "phase": room.phase,
            "phase_started_at": room.phase_started_at,
            "phase_deadline_at": room.phase_deadline_at,
            "done_available_at": room.done_available_at,
            "chooser_order": room.chooser_order,
            "chooser_rotation_index": room.chooser_rotation_index,
            "current_chooser_id": room.current_chooser_id,
            "used_letters": room.used_letters,
            "current_letter": room.current_letter,
            "scores": room.scores,
            "submissions": room.submissions,
            "last_round_score_changes": room.last_round_score_changes,
            "last_round_player_stats": room.last_round_player_stats,
            "last_round_letter": room.last_round_letter,
            "last_round_locked_by": room.last_round_locked_by,
            "last_round_locked_by_player_id": room.last_round_locked_by_player_id,
            "round_answer_results": room.round_answer_results,
            "answer_votes": {
                answer_id: {
                    "valid_player_ids": vote_record.valid_player_ids,
                    "invalid_player_ids": vote_record.invalid_player_ids,
                }
                for answer_id, vote_record in room.answer_votes.items()
            },
            "players": {
                player_id: {
                    "id": player.id,
                    "name": player.name,
                    "username": player.username,
                    "character_id": player.character_id,
                }
                for player_id, player in room.players.items()
            },
        }

    def _deserialize_room(self, data: dict) -> LettersRoom:
        if data.get("game_type") not in (None, "letters"):
            raise RoomNotFoundError("Room not found.")
        room = LettersRoom(
            room_code=data["room_code"],
            host_id=data["host_id"],
            session_id=data.get("session_id") or f"letters:{data['room_code']}:{data['host_id']}",
            room_version=data.get("room_version", 0),
            max_player_count=data["max_player_count"],
            total_rounds=data.get("total_rounds", 5),
            answer_timer_seconds=data.get("answer_timer_seconds", 60),
            no_timer=data.get("no_timer", False),
            min_done_seconds=data.get("min_done_seconds", 10),
            preset_category_ids=data.get("preset_category_ids", []),
            custom_categories=data.get("custom_categories", []),
            active_categories=data.get("active_categories", []),
            allowed_letters=data.get("allowed_letters", ARABIC_LETTERS[:]),
            started=data.get("started", False),
            ended=data.get("ended", False),
            history_recorded=data.get("history_recorded", False),
            end_reason=data.get("end_reason"),
            winner_ids=data.get("winner_ids", []),
            current_round=data.get("current_round", 1),
            phase=data.get("phase", "waiting"),
            phase_started_at=data.get("phase_started_at"),
            phase_deadline_at=data.get("phase_deadline_at"),
            done_available_at=data.get("done_available_at"),
            chooser_order=data.get("chooser_order", []),
            chooser_rotation_index=data.get("chooser_rotation_index", 0),
            current_chooser_id=data.get("current_chooser_id"),
            used_letters=data.get("used_letters", []),
            current_letter=data.get("current_letter"),
            scores=data.get("scores", {}),
            submissions=data.get("submissions", {}),
            last_round_score_changes=data.get("last_round_score_changes", {}),
            last_round_player_stats=data.get("last_round_player_stats", {}),
            last_round_letter=data.get("last_round_letter"),
            last_round_locked_by=data.get("last_round_locked_by"),
            last_round_locked_by_player_id=data.get("last_round_locked_by_player_id"),
            round_answer_results=data.get("round_answer_results", {}),
        )
        for player_id, player_data in data.get("players", {}).items():
            room.players[player_id] = LettersPlayer(
                id=player_data["id"],
                name=player_data["name"],
                username=player_data.get("username"),
                character_id=player_data.get("character_id", "char1"),
            )
        for answer_id, vote_data in data.get("answer_votes", {}).items():
            room.answer_votes[answer_id] = LettersVoteRecord(
                valid_player_ids=list(vote_data.get("valid_player_ids", [])),
                invalid_player_ids=list(vote_data.get("invalid_player_ids", [])),
            )
        return room

    def _save_room(self, room: LettersRoom, bump_version: bool = True) -> None:
        previous_version = int(room.room_version)
        if bump_version:
            room.room_version += 1
        payload = self._serialize_room(room)
        saved = self.room_repository.save_room(
            room.room_code,
            payload,
            expected_room_version=previous_version,
        )
        if not saved:
            raise StaleRoomVersionError("Room state changed. Please resync.")
        if room.ended and not room.history_recorded:
            record_completed_room("letters", payload)
            room.history_recorded = True
            history_payload = self._serialize_room(room)
            history_saved = self.room_repository.save_room(
                room.room_code,
                history_payload,
                expected_room_version=room.room_version,
            )
            if not history_saved:
                raise StaleRoomVersionError("Room state changed. Please resync.")
