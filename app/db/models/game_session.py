"""Persisted completed game sessions for profile history."""

from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class GameSession(Base):
    """Summary row for a completed game room/session."""

    __tablename__ = "game_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    session_id: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    game_type: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    room_code: Mapped[str] = mapped_column(String(32), index=True, nullable=False)

    host_player_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    host_player_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    host_username: Mapped[str | None] = mapped_column(String(50), nullable=True)

    player_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    end_reason: Mapped[str | None] = mapped_column(String(50), nullable=True)
    winner_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    ended_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    participants: Mapped[list["GameSessionParticipant"]] = relationship(
        "GameSessionParticipant",
        back_populates="game_session",
        cascade="all, delete-orphan",
    )
