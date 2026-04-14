"""Persist and query completed game sessions for profile history."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session

from app.db.models.game_session import GameSession
from app.db.models.game_session_participant import GameSessionParticipant
from app.db.models.user import User
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)


def _to_player_list(room_state: dict[str, Any]) -> list[dict[str, Any]]:
    players = room_state.get("players") or {}
    if isinstance(players, dict):
        return list(players.values())
    return []


def _winner_ids(game_type: str, room_state: dict[str, Any], players: list[dict[str, Any]]) -> list[str]:
    raw_winner_ids = room_state.get("winner_ids")
    if isinstance(raw_winner_ids, list):
        return [str(player_id) for player_id in raw_winner_ids]

    if game_type == "who_am_i":
        solved_players = [
            player for player in players
            if player.get("has_guessed_correctly") and player.get("solved_order")
        ]
        if not solved_players:
            return []
        best_order = min(int(player["solved_order"]) for player in solved_players)
        return [str(player["id"]) for player in solved_players if int(player["solved_order"]) == best_order]

    return []


def _session_summary(
    game_type: str,
    room_state: dict[str, Any],
    players: list[dict[str, Any]],
    winner_ids: list[str],
) -> dict[str, Any]:
    scores = room_state.get("scores") or {}
    normalized_players: list[dict[str, Any]] = []
    for player in players:
        player_id = str(player.get("id", ""))
        normalized_players.append(
            {
                "id": player_id,
                "name": player.get("name"),
                "username": player.get("username"),
                "score": scores.get(player_id),
                "guess_count": player.get("guess_count"),
                "solved_order": player.get("solved_order"),
                "is_winner": player_id in winner_ids,
            }
        )

    return {
        "game_type": game_type,
        "end_reason": room_state.get("end_reason"),
        "winner_ids": winner_ids,
        "players": normalized_players,
        "current_round": room_state.get("current_round"),
        "total_rounds": room_state.get("total_rounds"),
        "turn_number": room_state.get("turn_number"),
        "winner": room_state.get("winner"),
    }


def _record_completed_room_with_db(db: Session, game_type: str, room_state: dict[str, Any]) -> None:
    if not room_state.get("ended"):
        return

    room_code = str(room_state.get("room_code", "")).upper()
    host_id = str(room_state.get("host_id", "")) if room_state.get("host_id") else None
    session_id = str(room_state.get("session_id") or f"{game_type}:{room_code}:{host_id or 'host'}")

    existing = db.execute(
        select(GameSession).where(GameSession.session_id == session_id)
    ).scalar_one_or_none()
    if existing:
        return

    players = _to_player_list(room_state)
    winner_ids = _winner_ids(game_type, room_state, players)
    summary = _session_summary(game_type, room_state, players, winner_ids)

    host_player = next((player for player in players if str(player.get("id")) == host_id), None)
    host_name = host_player.get("name") if host_player else None
    host_username = host_player.get("username") if host_player else None

    session = GameSession(
        session_id=session_id,
        game_type=game_type,
        room_code=room_code,
        host_player_id=host_id,
        host_player_name=host_name,
        host_username=host_username,
        player_count=len(players),
        end_reason=room_state.get("end_reason"),
        winner_ids=winner_ids,
        summary=summary,
        ended_at=datetime.now(timezone.utc),
    )
    db.add(session)
    db.flush()

    usernames = sorted(
        {
            str(player.get("username")).strip()
            for player in players
            if player.get("username")
        }
    )
    users_by_username: dict[str, User] = {}
    if usernames:
        matched_users = db.execute(
            select(User).where(User.username.in_(usernames))
        ).scalars().all()
        users_by_username = {user.username: user for user in matched_users}

    scores = room_state.get("scores") or {}
    for player in players:
        player_id = str(player.get("id", ""))
        username = player.get("username")
        user = users_by_username.get(username) if username else None
        db.add(
            GameSessionParticipant(
                game_session_id=session.id,
                user_id=user.id if user else None,
                player_id=player_id,
                player_name=str(player.get("name", "Player")),
                username=username,
                is_host=player_id == host_id,
                is_winner=player_id in winner_ids,
                score=scores.get(player_id),
                guess_count=player.get("guess_count"),
                solved_order=player.get("solved_order"),
            )
        )

    db.commit()


def record_completed_room(game_type: str, room_state: dict[str, Any]) -> None:
    """Persist a completed room to profile history. Safe to call repeatedly."""
    try:
        with SessionLocal() as db:
            _record_completed_room_with_db(db, game_type, room_state)
    except Exception as exc:
        logger.warning(
            "Game history record failed game=%s room=%s error=%s",
            game_type,
            room_state.get("room_code"),
            exc,
        )


def get_user_game_history(
    db: Session,
    user_id: int,
    username: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Return recent game sessions for one user."""
    participant_filter = (GameSessionParticipant.user_id == user_id)
    if username:
        participant_filter = or_(
            GameSessionParticipant.user_id == user_id,
            GameSessionParticipant.username == username,
        )

    raw_sessions = db.execute(
        select(GameSession)
        .join(GameSessionParticipant, GameSessionParticipant.game_session_id == GameSession.id)
        .where(participant_filter)
        .order_by(desc(GameSession.ended_at))
        .limit(limit)
    ).scalars().all()

    sessions: list[GameSession] = []
    seen_session_ids: set[int] = set()
    for session in raw_sessions:
        if session.id in seen_session_ids:
            continue
        seen_session_ids.add(session.id)
        sessions.append(session)

    if not sessions:
        return []

    session_ids = [session.id for session in sessions]
    participants = db.execute(
        select(GameSessionParticipant)
        .where(GameSessionParticipant.game_session_id.in_(session_ids))
    ).scalars().all()

    participants_by_session: dict[int, list[GameSessionParticipant]] = {}
    for participant in participants:
        participants_by_session.setdefault(participant.game_session_id, []).append(participant)

    payload: list[dict[str, Any]] = []
    for session in sessions:
        session_participants = participants_by_session.get(session.id, [])
        me = next((p for p in session_participants if p.user_id == user_id), None)
        payload.append(
            {
                "session_id": session.session_id,
                "game_type": session.game_type,
                "room_code": session.room_code,
                "ended_at": session.ended_at.isoformat(),
                "end_reason": session.end_reason,
                "player_count": session.player_count,
                "host_player_name": session.host_player_name,
                "winner_ids": session.winner_ids or [],
                "summary": session.summary or {},
                "me": (
                    {
                        "player_id": me.player_id,
                        "player_name": me.player_name,
                        "username": me.username,
                        "is_host": me.is_host,
                        "is_winner": me.is_winner,
                        "score": me.score,
                        "guess_count": me.guess_count,
                        "solved_order": me.solved_order,
                    }
                    if me
                    else None
                ),
                "participants": [
                    {
                        "player_id": participant.player_id,
                        "player_name": participant.player_name,
                        "username": participant.username,
                        "is_host": participant.is_host,
                        "is_winner": participant.is_winner,
                        "score": participant.score,
                        "guess_count": participant.guess_count,
                        "solved_order": participant.solved_order,
                    }
                    for participant in session_participants
                ],
            }
        )
    return payload
