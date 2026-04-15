"""Letters bot simulator entrypoint.

Letters gameplay is WS-driven, so this wrapper delegates to the WS simulator.

Usage:
  python -m app.tests.letters_bot_simulator --base-url http://127.0.0.1:8000 --sessions 20 --players 6 --rounds 6 --workers 5
"""

from app.tests.letters_ws_bot_simulator import main


if __name__ == "__main__":
    raise SystemExit(main())
