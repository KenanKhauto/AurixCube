"""User database model."""

from datetime import datetime, timezone

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    """
    User model for authentication and profile data.
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    profile_image: Mapped[str | None] = mapped_column(String(255), nullable=True, default="profile_img_default.png")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Friend relationships
    friends: Mapped[list["Friend"]] = relationship(
        "Friend", foreign_keys="Friend.user_id", back_populates="user"
    )
    friend_of: Mapped[list["Friend"]] = relationship(
        "Friend", foreign_keys="Friend.friend_id", back_populates="friend"
    )