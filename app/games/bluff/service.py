"""Business logic for the Bluff game."""

from __future__ import annotations

import random
import uuid
from typing import Dict, List, Optional

from app.core.exceptions import InvalidVoteError, PlayerNotFoundError, RoomNotFoundError
from app.core.utils import generate_room_code
from app.games.bluff.constants import BLUFF_CATEGORIES
from app.games.bluff.domain import BluffAnswerOption, BluffPlayer, BluffRoom
from app.repositories.room_repository import RoomRepository
from app.services.room_storage import get_room_repository


class BluffGameService:
    """
    Service layer for managing Bluff game rooms and actions.
    """

    def __init__(self, room_repository: RoomRepository | None = None) -> None:
        self.room_repository = room_repository or get_room_repository()

    def create_room(
        self,
        host_name: str,
        player_count: int,
        total_rounds: int,
        categories: list[str],
    ) -> BluffRoom:
        categories = list(dict.fromkeys(categories))

        if not categories:
            raise ValueError("At least one category must be selected.")

        if len(categories) > 12:
            raise ValueError("You can select up to 12 categories only.")

        invalid_categories = [category for category in categories if category not in BLUFF_CATEGORIES]
        if invalid_categories:
            raise ValueError(f"Invalid categories: {', '.join(invalid_categories)}")

        room_code = generate_room_code()
        host_id = str(uuid.uuid4())

        room = BluffRoom(
            room_code=room_code,
            host_id=host_id,
            categories=categories,
            player_count=player_count,
            total_rounds=total_rounds,
        )

        room.players[host_id] = BluffPlayer(id=host_id, name=host_name)
        room.scores[host_id] = 0

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def join_room(self, room_code: str, player_name: str) -> BluffRoom:
        room = self._get_room(room_code)

        if room.started:
            raise ValueError("Game already started.")

        if len(room.players) >= room.player_count:
            raise ValueError("Room is full.")

        player_id = str(uuid.uuid4())
        room.players[player_id] = BluffPlayer(id=player_id, name=player_name)
        room.scores[player_id] = 0

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def leave_room(self, room_code: str, player_id: str) -> Optional[BluffRoom]:
        room = self._get_room(room_code)

        if player_id not in room.players:
            raise PlayerNotFoundError("Player not found.")

        if player_id == room.host_id:
            raise ValueError("Host cannot leave the room. Host must delete the room.")

        if room.started:
            raise ValueError("Players cannot leave after the game has started.")

        del room.players[player_id]
        room.scores.pop(player_id, None)

        if not room.players:
            self.room_repository.delete_room(room_code)
            return None

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def delete_room(self, room_code: str, player_id: str) -> None:
        room = self._get_room(room_code)

        if player_id != room.host_id:
            raise ValueError("Only the host can delete the room.")

        self.room_repository.delete_room(room_code)

    def start_game(self, room_code: str) -> BluffRoom:
        room = self._get_room(room_code)

        if len(room.players) != room.player_count:
            raise ValueError("Room is not full yet.")

        room.started = True
        room.ended = False
        room.winner_ids = []
        room.current_round = 1
        room.phase = "writing"
        room.used_prompt_indices = []
        room.submissions = {}
        room.answer_options = []
        room.votes = {}
        room.last_round_message = None
        room.last_round_correct_option_id = None
        room.last_round_score_changes = {}

        for player_id in room.players:
            room.scores[player_id] = 0

        self._start_new_round(room)

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def get_room_state(self, room_code: str) -> BluffRoom:
        return self._get_room(room_code)

    def submit_answer(self, room_code: str, player_id: str, answer_text: str) -> BluffRoom:
        room = self._get_room(room_code)

        if room.ended:
            raise ValueError("Game has already ended.")

        if room.phase != "writing":
            raise ValueError("This is not the answer submission phase.")

        if player_id not in room.players:
            raise PlayerNotFoundError("Player not found.")

        cleaned_answer = answer_text.strip()
        if not cleaned_answer:
            raise ValueError("Answer cannot be empty.")

        if self._normalize_text(cleaned_answer) == self._normalize_text(room.correct_answer):
            raise ValueError("You cannot submit the exact correct answer.")

        room.submissions[player_id] = cleaned_answer

        if self._all_players_submitted(room):
            self._build_answer_options(room)
            room.phase = "voting"

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def submit_vote(self, room_code: str, player_id: str, option_id: str) -> BluffRoom:
        room = self._get_room(room_code)

        if room.ended:
            raise InvalidVoteError("Game has already ended.")

        if room.phase != "voting":
            raise InvalidVoteError("This is not the voting phase.")

        if player_id not in room.players:
            raise PlayerNotFoundError("Player not found.")

        option = self._get_option_by_id(room, option_id)
        if option is None:
            raise InvalidVoteError("Selected option does not exist.")

        if player_id in option.author_ids:
            raise InvalidVoteError("You cannot vote for your own bluff.")

        room.votes[player_id] = option_id

        if self._all_players_voted(room):
            self._resolve_round(room)

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def advance_round(self, room_code: str, player_id: str) -> BluffRoom:
        room = self._get_room(room_code)

        if player_id != room.host_id:
            raise ValueError("Only the host can advance to the next round.")

        if room.ended:
            raise ValueError("Game has already ended.")

        if room.phase != "round_result":
            raise ValueError("The round is not ready to advance.")

        if room.current_round >= room.total_rounds:
            self._finish_game(room)
        else:
            room.current_round += 1
            self._start_new_round(room)

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def restart_game(self, room_code: str, categories: list[str], total_rounds: int) -> BluffRoom:
        room = self._get_room(room_code)

        categories = list(dict.fromkeys(categories))

        if not categories:
            raise ValueError("At least one category must be selected.")

        if len(categories) > 12:
            raise ValueError("You can select up to 12 categories only.")

        invalid_categories = [category for category in categories if category not in BLUFF_CATEGORIES]
        if invalid_categories:
            raise ValueError(f"Invalid categories: {', '.join(invalid_categories)}")

        room.categories = categories
        room.total_rounds = total_rounds
        room.started = False
        room.ended = False
        room.winner_ids = []
        room.current_round = 1
        room.phase = "waiting"
        room.current_question = ""
        room.correct_answer = ""
        room.used_prompt_indices = []
        room.submissions = {}
        room.answer_options = []
        room.votes = {}
        room.last_round_message = None
        room.last_round_correct_option_id = None
        room.last_round_score_changes = {}

        for player_id in room.players:
            room.scores[player_id] = 0

        self.room_repository.save_room(room_code, self._serialize_room(room))
        return room

    def _start_new_round(self, room: BluffRoom) -> None:
        prompts = []
        for category in room.categories:
            prompts.extend(BLUFF_CATEGORIES[category])
        available_indices = [i for i in range(len(prompts)) if i not in room.used_prompt_indices]

        if not available_indices:
            room.used_prompt_indices = []
            available_indices = list(range(len(prompts)))

        prompt_index = random.choice(available_indices)
        room.used_prompt_indices.append(prompt_index)

        prompt = prompts[prompt_index]
        room.current_question = prompt["question"]
        room.correct_answer = prompt["answer"]

        room.phase = "writing"
        room.submissions = {}
        room.answer_options = []
        room.votes = {}
        room.last_round_message = None
        room.last_round_correct_option_id = None
        room.last_round_score_changes = {}

    def _build_answer_options(self, room: BluffRoom) -> None:
        """
        Merge identical bluff texts into one displayed option.
        All authors of the same bluff keep full fooled points later.
        """
        merged_fake_options: Dict[str, BluffAnswerOption] = {}

        for player_id, answer_text in room.submissions.items():
            normalized = self._normalize_text(answer_text)

            if normalized not in merged_fake_options:
                merged_fake_options[normalized] = BluffAnswerOption(
                    id=str(uuid.uuid4()),
                    text=answer_text.strip(),
                    is_correct=False,
                    author_ids=[player_id],
                    votes_received=0,
                )
            else:
                merged_fake_options[normalized].author_ids.append(player_id)

        options = list(merged_fake_options.values())

        correct_option = BluffAnswerOption(
            id=str(uuid.uuid4()),
            text=room.correct_answer,
            is_correct=True,
            author_ids=[],
            votes_received=0,
        )
        options.append(correct_option)

        random.shuffle(options)
        room.answer_options = options

    def _resolve_round(self, room: BluffRoom) -> None:
        for option in room.answer_options:
            option.votes_received = 0

        option_map = {option.id: option for option in room.answer_options}

        for option_id in room.votes.values():
            if option_id in option_map:
                option_map[option_id].votes_received += 1

        score_changes = {player_id: 0 for player_id in room.players.keys()}
        correct_option = next((option for option in room.answer_options if option.is_correct), None)

        if correct_option is None:
            raise ValueError("Correct answer option is missing.")

        room.last_round_correct_option_id = correct_option.id

        for voter_id, option_id in room.votes.items():
            chosen_option = option_map.get(option_id)
            if chosen_option is None:
                continue

            if chosen_option.is_correct:
                room.scores[voter_id] += 2
                score_changes[voter_id] += 2
            else:
                for author_id in chosen_option.author_ids:
                    room.scores[author_id] += 1
                    score_changes[author_id] += 1

        room.last_round_score_changes = {
            player_id: delta
            for player_id, delta in score_changes.items()
            if delta != 0
        }
        room.last_round_message = "تم إنهاء الجولة وعرض النتائج."
        room.phase = "round_result"

    def _finish_game(self, room: BluffRoom) -> None:
        room.ended = True
        room.phase = "game_over"

        if not room.scores:
            room.winner_ids = []
            return

        max_score = max(room.scores.values(), default=0)
        room.winner_ids = [
            player_id
            for player_id, score in room.scores.items()
            if score == max_score
        ]

    def _all_players_submitted(self, room: BluffRoom) -> bool:
        return len(room.submissions) == len(room.players)

    def _all_players_voted(self, room: BluffRoom) -> bool:
        return len(room.votes) == len(room.players)

    def _get_option_by_id(self, room: BluffRoom, option_id: str) -> Optional[BluffAnswerOption]:
        for option in room.answer_options:
            if option.id == option_id:
                return option
        return None

    def _normalize_text(self, text: str) -> str:
        return " ".join(text.strip().lower().split())

    def _get_room(self, room_code: str) -> BluffRoom:
        raw_room = self.room_repository.get_room(room_code)
        if not raw_room:
            raise RoomNotFoundError("Room not found.")
        return self._deserialize_room(raw_room)

    def _serialize_room(self, room: BluffRoom) -> dict:
        return {
            "room_code": room.room_code,
            "host_id": room.host_id,
            "categories": room.categories,
            "player_count": room.player_count,
            "total_rounds": room.total_rounds,
            "started": room.started,
            "ended": room.ended,
            "winner_ids": room.winner_ids,
            "current_round": room.current_round,
            "phase": room.phase,
            "current_question": room.current_question,
            "correct_answer": room.correct_answer,
            "used_prompt_indices": room.used_prompt_indices,
            "scores": room.scores,
            "submissions": room.submissions,
            "votes": room.votes,
            "last_round_message": room.last_round_message,
            "last_round_correct_option_id": room.last_round_correct_option_id,
            "last_round_score_changes": room.last_round_score_changes,
            "players": {
                player_id: {
                    "id": player.id,
                    "name": player.name,
                }
                for player_id, player in room.players.items()
            },
            "answer_options": [
                {
                    "id": option.id,
                    "text": option.text,
                    "is_correct": option.is_correct,
                    "author_ids": option.author_ids,
                    "votes_received": option.votes_received,
                }
                for option in room.answer_options
            ],
        }

    def _deserialize_room(self, data: dict) -> BluffRoom:
        room = BluffRoom(
            room_code=data["room_code"],
            host_id=data["host_id"],
            categories=data.get("categories", [data["category"]] if "category" in data else []),
            player_count=data["player_count"],
            total_rounds=data["total_rounds"],
            started=data.get("started", False),
            ended=data.get("ended", False),
            winner_ids=data.get("winner_ids", []),
            current_round=data.get("current_round", 1),
            phase=data.get("phase", "waiting"),
            current_question=data.get("current_question", ""),
            correct_answer=data.get("correct_answer", ""),
            used_prompt_indices=data.get("used_prompt_indices", []),
            scores=data.get("scores", {}),
            submissions=data.get("submissions", {}),
            votes=data.get("votes", {}),
            last_round_message=data.get("last_round_message"),
            last_round_correct_option_id=data.get("last_round_correct_option_id"),
            last_round_score_changes=data.get("last_round_score_changes", {}),
        )

        for player_id, player_data in data.get("players", {}).items():
            room.players[player_id] = BluffPlayer(
                id=player_data["id"],
                name=player_data["name"],
            )

        for option_data in data.get("answer_options", []):
            room.answer_options.append(
                BluffAnswerOption(
                    id=option_data["id"],
                    text=option_data["text"],
                    is_correct=option_data.get("is_correct", False),
                    author_ids=option_data.get("author_ids", []),
                    votes_received=option_data.get("votes_received", 0),
                )
            )

        return room