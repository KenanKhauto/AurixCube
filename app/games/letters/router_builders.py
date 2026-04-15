"""Shared response builders for the letters router."""

from __future__ import annotations

from app.games.letters.schemas import LettersAnswerEntryView, LettersPlayerView, LettersRoomStateResponse
from app.games.letters.service import LettersGameService

service = LettersGameService()


def build_room_response(room, viewer_player_id: str | None = None) -> LettersRoomStateResponse:
    reveal_answers = room.phase in {"reveal", "voting", "round_result", "finished"} or room.ended
    masked_submissions = {}
    for player_id in room.players.keys():
        answers = list(room.submissions.get(player_id, []))
        if reveal_answers or player_id == viewer_player_id:
            masked_submissions[player_id] = answers
        else:
            masked_submissions[player_id] = ["" for _ in room.active_categories]

    return LettersRoomStateResponse(
        room_code=room.room_code,
        room_version=room.room_version,
        host_id=room.host_id,
        max_player_count=room.max_player_count,
        total_rounds=room.total_rounds,
        answer_timer_seconds=room.answer_timer_seconds,
        no_timer=room.no_timer,
        min_done_seconds=room.min_done_seconds,
        preset_category_ids=room.preset_category_ids,
        custom_categories=room.custom_categories,
        active_categories=room.active_categories,
        allowed_letters=room.allowed_letters,
        started=room.started,
        ended=room.ended,
        end_reason=room.end_reason,
        winner_ids=room.winner_ids,
        current_round=room.current_round,
        phase=room.phase,
        phase_started_at=room.phase_started_at,
        phase_deadline_at=room.phase_deadline_at,
        done_available_at=room.done_available_at,
        chooser_order=room.chooser_order,
        current_chooser_id=room.current_chooser_id,
        current_letter=room.current_letter,
        used_letters=room.used_letters,
        last_round_letter=room.last_round_letter,
        last_round_locked_by=room.last_round_locked_by,
        last_round_locked_by_player_id=room.last_round_locked_by_player_id,
        last_round_score_changes=room.last_round_score_changes,
        last_round_player_stats=room.last_round_player_stats,
        players=[
            LettersPlayerView(
                id=player.id,
                name=player.name,
                username=player.username,
                character_id=player.character_id,
                score=room.scores.get(player.id, 0),
            )
            for player in room.players.values()
        ],
        submissions=masked_submissions,
        answer_entries=[
            LettersAnswerEntryView(**entry)
            for entry in service.build_answer_entries(room, viewer_player_id=viewer_player_id)
        ] if reveal_answers else [],
    )
