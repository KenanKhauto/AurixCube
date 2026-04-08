"""Game registry for the home screen."""

GAMES = [
    {
        "id": "bluff",
        "name": "لعبتنا",
        "description": "لعبة الأسئلة والخداع الكبرى لعبة اجتماعية خفيفة ظريفة حارقة خارقة متفجرة.",
        "path": "/games/bluff",
        "coming_soon": False,
        "disabled": False,
        "outline_class": "game-outline-bluff",
        "theme_class": "theme-bluff",
        "logo": "/static/images/bluff-logo.png",
    },
    {
        "id": "undercover",
        "name": "لعبة المندس",
        "description": "لعبة جماعية فيها مندس أو أكثر، مع تصويت وكشف النتيجة.",
        "path": "#",
        "coming_soon": True,
        "disabled": True,
        "outline_class": "game-outline-undercover",
        "theme_class": "theme-undercover",
        "logo": "/static/images/undercover-logo.png",
    },
    {
        "id": "who_am_i",
        "name": "من أنا؟",
        "description": "لعبة اجتماعية خفيفة تحاول فيها معرفة هويتك من خلال الأسئلة والتخمين.",
        "path": "/games/who-am-i",
        "coming_soon": False,
        "disabled": False,
        "outline_class": "game-outline-whoami",
        "theme_class": "theme-whoami",
        "logo": "/static/images/who-am-i-logo.png",
    },
    {
        "id": "draw_guess",
        "name": "ارسم وخمن",
        "description": "لعبة اجتماعية خفيفة تحاول فيها تخمين ما يرسم امامك.",
        "path": "/games/draw-guess",
        "coming_soon": False,
        "disabled": False,
        "outline_class": "game-outline-draw-guess",
        "theme_class": "theme-draw-guess",
        "logo": "/static/images/draw_guess-logo.png",
    }
]