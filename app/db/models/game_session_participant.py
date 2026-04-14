"""Participants belonging to a persisted game session."""

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class GameSessionParticipant(Base):
    """Per-player snapshot for a completed game session."""

    __tablename__ = "game_session_participants"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_session_id: Mapped[int] = mapped_column(
        ForeignKey("game_sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)

    player_id: Mapped[str] = mapped_column(String(64), nullable=False)
    player_name: Mapped[str] = mapped_column(String(100), nullable=False)
    username: Mapped[str | None] = mapped_column(String(50), index=True, nullable=True)

    is_host: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_winner: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    guess_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    solved_order: Mapped[int | None] = mapped_column(Integer, nullable=True)

    game_session: Mapped["GameSession"] = relationship("GameSession", back_populates="participants")
