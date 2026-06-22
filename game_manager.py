import uuid
import re
import os
import random
from flipa.flipa import Board, Player

GAMES = {}
QUEUE = []

ROWS = ["A", "B", "C"]
COLS = ["1", "2", "3", "4"]

# Hue rotations applied when both players share the same skin number
# Each index = alternative colour tint for player B (degrees)
ALT_HUES = [180, 120, 240, 60, 300, 30]


def _count_skin_types():
    imgs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "imgs")
    count = 0
    for i in range(1, 20):
        if os.path.exists(os.path.join(imgs_dir, f"{i}.png")):
            count = i
        else:
            break
    return max(count, 1)

SKIN_COUNT = _count_skin_types()

THEME_COUNT = 8


def _parse_board(board):
    lines = str(board).strip().split("\n")
    grid = []
    for line in lines[1:]:
        cells = re.findall(r"\[([^\]]+)\]", line)
        grid.append([c.strip() for c in cells])
    return grid


def serialize_board(board):
    return _parse_board(board)


def count_player_cards(board, side):
    grid = _parse_board(board)
    count = 0
    for row in grid:
        for cell in row:
            if cell.startswith(side) and cell not in ("XXXXXX", "--"):
                count += 1
    return count


def get_legal_sources(board, side):
    """Return set of source positions the player can initiate a move from."""
    player = Player.A if side == "A" else Player.B
    moves = board.get_legal_moves(player)
    return set(m[:2] for m in moves)


def get_rank(mmr):
    if mmr >= 500:
        return "Master"
    if mmr >= 300:
        return "Diamond"
    if mmr >= 200:
        return "Platinum"
    if mmr >= 100:
        return "Gold"
    if mmr >= 50:
        return "Silver"
    return "Bronze"


def calculate_elo(winner_mmr, loser_mmr, K=32):
    E_winner = 1 / (1 + 10 ** ((loser_mmr - winner_mmr) / 400))
    winner_delta = round(K * (1 - E_winner))
    loser_delta = round(K * (0 - (1 - E_winner)))
    new_winner = max(0, winner_mmr + winner_delta)
    new_loser = max(0, loser_mmr + loser_delta)
    return winner_delta, loser_delta, new_winner, new_loser


def _make_game(board, player_a, player_b, game_type, bot_depth):
    skin_a = player_a.get("skin", 1)
    skin_b = player_b.get("skin", 1)
    # If skins clash, pick a hue rotation for player B so colours differ visually
    hue_b = 0
    if skin_a == skin_b:
        # Pick a hue that isn't used by A (A has hue 0)
        hue_b = ALT_HUES[0]
    first = random.choice(["A", "B"])
    return {
        "board": board,
        "player_a": player_a,
        "player_b": player_b,
        "current_turn": first,
        "game_type": game_type,
        "bot_depth": bot_depth,
        "skin_a": skin_a,
        "skin_b": skin_b,
        "hue_b": hue_b,   # CSS hue-rotate degrees for player B when skins clash
        "status": "active",
        "winner": None,
    }


def create_training_game(user_id, username, mmr, bot_depth, skin=1):
    room_id = str(uuid.uuid4())[:8]
    board = Board()
    bot_skin = random.randint(1, SKIN_COUNT)
    GAMES[room_id] = _make_game(
        board,
        player_a={"id": user_id, "username": username, "mmr": mmr, "skin": skin},
        player_b={"id": None, "username": "Bot", "mmr": 800, "skin": bot_skin},
        game_type="training",
        bot_depth=bot_depth,
    )
    return room_id


def create_ranked_game(player_a, player_b):
    room_id = str(uuid.uuid4())[:8]
    board = Board()
    GAMES[room_id] = _make_game(
        board,
        player_a={"id": player_a["id"], "username": player_a["username"],
                  "mmr": player_a["mmr"], "skin": player_a.get("skin", 1)},
        player_b={"id": player_b["id"], "username": player_b["username"],
                  "mmr": player_b["mmr"], "skin": player_b.get("skin", 1)},
        game_type="ranked",
        bot_depth=None,
    )
    return room_id


def get_game(room_id):
    return GAMES.get(room_id)


def build_game_state(room_id, your_side):
    game = GAMES[room_id]
    board = game["board"]
    clickable = list(get_legal_sources(board, game["current_turn"]))
    return {
        "room_id": room_id,
        "board": serialize_board(board),
        "skin_a": game["skin_a"],
        "skin_b": game["skin_b"],
        "hue_b": game["hue_b"],
        "clickable_sources": clickable,
        "current_turn": game["current_turn"],
        "last_move": game.get("last_move"),
        "player_a": {
            "username": game["player_a"]["username"],
            "mmr": game["player_a"]["mmr"],
            "rank": get_rank(game["player_a"]["mmr"]),
            "skin": game["skin_a"],
        },
        "player_b": {
            "username": game["player_b"]["username"],
            "mmr": game["player_b"]["mmr"],
            "rank": get_rank(game["player_b"]["mmr"]),
            "skin": game["skin_b"],
        },
        "game_type": game["game_type"],
        "your_side": your_side,
        "status": game["status"],
    }


def enqueue(user_id, username, mmr, skin, sid):
    dequeue(user_id)
    QUEUE.append({"id": user_id, "username": username, "mmr": mmr, "skin": skin, "sid": sid})


def dequeue(user_id):
    global QUEUE
    QUEUE = [p for p in QUEUE if p["id"] != user_id]


def try_match():
    if len(QUEUE) >= 2:
        p_a = QUEUE.pop(0)
        p_b = QUEUE.pop(0)
        return p_a, p_b
    return None


def get_player_side(room_id, user_id):
    game = GAMES.get(room_id)
    if not game:
        return None
    if game["player_a"]["id"] == user_id:
        return "A"
    if game["player_b"]["id"] == user_id:
        return "B"
    return None


def apply_move(room_id, move_str, side):
    game = GAMES[room_id]
    board = game["board"]
    player = Player.A if side == "A" else Player.B

    # Snapshot before to detect which cells changed
    before = _parse_board(board)
    board.play(move_str, player, room_id)
    after = _parse_board(board)

    rows = ROWS
    cols = COLS
    affected = []
    for ri, row in enumerate(rows):
        for ci, col in enumerate(cols):
            pos = row + col
            bv = before[ri][ci]
            av = after[ri][ci]
            if bv != av:
                affected.append(pos)

    is_figure = len(move_str) == 4
    src = move_str[:2] if is_figure else move_str
    dst = move_str[2:] if is_figure else None

    game["last_move"] = {
        "move_str": move_str,
        "side": side,
        "is_figure": is_figure,
        "src": src,
        "dst": dst,
        "affected": affected,
    }


def check_game_over(room_id):
    """Game is over when any player has no cards left, checked after every move."""
    game = GAMES[room_id]
    board = game["board"]
    current = game["current_turn"]   # player who is about to move
    just_played = "B" if current == "A" else "A"  # player who just moved

    cards_current    = count_player_cards(board, current)
    cards_just_played = count_player_cards(board, just_played)

    # Both players eliminated simultaneously (e.g. figure card mutual destruction)
    if cards_just_played == 0 and cards_current == 0:
        game["status"] = "finished"
        game["winner"] = "DRAW"
        return "DRAW"

    # Player who just moved lost all their cards
    if cards_just_played == 0:
        winner = current
        game["status"] = "finished"
        game["winner"] = winner
        return winner

    # Player who is about to move has no cards left
    if cards_current == 0:
        winner = just_played
        game["status"] = "finished"
        game["winner"] = winner
        return winner

    # Next player has no legal moves — check if the other also has none (draw)
    player_current = Player.A if current == "A" else Player.B
    if not board.get_legal_moves(player_current):
        player_just_played = Player.B if current == "A" else Player.A
        if not board.get_legal_moves(player_just_played):
            game["status"] = "finished"
            game["winner"] = "DRAW"
            return "DRAW"
        winner = just_played
        game["status"] = "finished"
        game["winner"] = winner
        return winner

    return None


def get_bot_move(room_id):
    game = GAMES[room_id]
    board = game["board"]
    depth = game["bot_depth"]
    return board.play_bot(Player.B, depth)


def switch_turn(room_id):
    game = GAMES[room_id]
    game["current_turn"] = "B" if game["current_turn"] == "A" else "A"
