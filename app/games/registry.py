"""Game registry for the home screen."""

GAMES = [
    {
        "id": "future_game",
        "name": "لعبتنا 🪐",
        "description": "لعبة الأسئلة والخداع الكبرى",
        "path": "#",
        "coming_soon": True,
        "disabled": True,
    },
    {
        "id": "undercover",
        "name": "لعبة المندس",
        "description": "لعبة جماعية فيها مندس أو أكثر، مع تصويت وكشف النتيجة.",
        "path": "/games/undercover",
        "coming_soon": False,
        "disabled": False,
    },
    {
        "id": "who_am_i",
        "name": "من أنا؟",
        "description": "لعبة اجتماعية خفيفة تحاول فيها معرفة هويتك من خلال الأسئلة والتخمين.",
        "path": "/games/who-am-i",
        "coming_soon": False,
        "disabled": False,
    }
]