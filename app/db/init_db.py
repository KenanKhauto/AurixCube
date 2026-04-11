"""Database initialization helper."""

from app.db.base import Base
from app.db.models import User, Friend, GameInvite  # noqa: F401
from app.db.session import engine
from sqlalchemy import text


def _ensure_profile_image_column() -> None:
    """Add the missing profile_image column for existing SQLite databases."""
    with engine.begin() as connection:
        result = connection.execute(text("PRAGMA table_info(users)"))
        columns = [row[1] for row in result.fetchall()]
        if "profile_image" not in columns:
            connection.execute(
                text("ALTER TABLE users ADD COLUMN profile_image VARCHAR(255)")
            )
            connection.execute(
                text(
                    "UPDATE users SET profile_image = :default_image WHERE profile_image IS NULL"
                ),
                {"default_image": "profile_img_default.png"},
            )


def _ensure_friend_status_column() -> None:
    """Add the missing status column for existing SQLite databases."""
    with engine.begin() as connection:
        result = connection.execute(text("PRAGMA table_info(friends)"))
        columns = [row[1] for row in result.fetchall()]
        if "status" not in columns:
            connection.execute(
                text("ALTER TABLE friends ADD COLUMN status VARCHAR(20) DEFAULT 'accepted'")
            )
            # For existing friendships, set them as accepted
            connection.execute(
                text("UPDATE friends SET status = 'accepted' WHERE status IS NULL")
            )


def init_db() -> None:
    """
    Create database tables.

    For now this uses SQLAlchemy create_all.
    Later you should replace this with Alembic migrations.
    """
    Base.metadata.create_all(bind=engine)
    _ensure_profile_image_column()
    _ensure_friend_status_column()
