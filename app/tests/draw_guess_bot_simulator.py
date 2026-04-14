"""Draw Guess bot simulator entrypoint.

Draw Guess gameplay is WS-driven, so this wrapper delegates to the WS simulator.

Usage:
  python -m app.tests.draw_guess_bot_simulator --base-url http://127.0.0.1:8000 --sessions 20 --players 6 --rounds 6 --workers 5
"""

from app.tests.draw_guess_ws_bot_simulator import main


if __name__ == "__main__":
    raise SystemExit(main())
