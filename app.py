import os
import secrets
import bcrypt
from flask import (Flask, render_template, request, redirect, url_for,
                   session, flash, send_from_directory)
from flask_socketio import SocketIO, join_room, emit

import database as db
import game_manager as gm
from flipa.flipa import Player

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def login_required(f):
    from functools import wraps
    @wraps(f)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return wrapped


def current_user():
    uid = session.get("user_id")
    return db.get_user_by_id(uid) if uid else None


def socket_user():
    uid = session.get("user_id")
    return db.get_user_by_id(uid) if uid else None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    if "user_id" in session:
        return redirect(url_for("menu"))
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = db.get_user_by_username(username)
        if user and bcrypt.checkpw(password.encode(), user["password"].encode()):
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            return redirect(url_for("menu"))
        flash("Utilizador ou password incorretos.")
    return render_template("login.html")


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if not username or not password:
            flash("Preenche todos os campos.")
        elif len(username) < 3:
            flash("Username deve ter pelo menos 3 caracteres.")
        elif len(password) < 4:
            flash("Password deve ter pelo menos 4 caracteres.")
        elif db.get_user_by_username(username):
            flash("Username já existe.")
        else:
            hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
            uid = db.create_user(username, hashed)
            session["user_id"] = uid
            session["username"] = username
            return redirect(url_for("menu"))
    return render_template("register.html")


@app.route("/logout", methods=["POST"])
def logout():
    # Remove from matchmaking queue if present
    uid = session.get("user_id")
    if uid:
        gm.dequeue(uid)
    session.clear()
    return redirect(url_for("login"))


@app.route("/menu")
@login_required
def menu():
    user = current_user()
    leaderboard = db.get_leaderboard(10)
    for entry in leaderboard:
        entry["rank"] = gm.get_rank(entry["mmr"])
    user["rank"] = gm.get_rank(user["mmr"])
    return render_template("menu.html", user=user, leaderboard=leaderboard,
                           skin_count=gm.SKIN_COUNT)


@app.route("/skin", methods=["POST"])
@login_required
def save_skin():
    skin = int(request.form.get("skin", 1))
    skin = max(1, min(skin, gm.SKIN_COUNT))
    db.update_skin(session["user_id"], skin)
    return "", 204


@app.route("/training/start", methods=["POST"])
@login_required
def training_start():
    depth_map = {"min": 1, "mid": 5, "max": 10}
    difficulty = request.form.get("difficulty", "max")
    depth = depth_map.get(difficulty, 10)
    user = current_user()
    room_id = gm.create_training_game(
        user["id"], user["username"], user["mmr"], depth, skin=user.get("skin", 1)
    )
    return redirect(url_for("game", room_id=room_id))


@app.route("/game/<room_id>")
@login_required
def game(room_id):
    user = current_user()
    game_data = gm.get_game(room_id)
    if not game_data:
        flash("Jogo não encontrado.")
        return redirect(url_for("menu"))
    side = gm.get_player_side(room_id, user["id"])
    if not side:
        flash("Não tens acesso a este jogo.")
        return redirect(url_for("menu"))
    difficulty_name = {1: "Mínima", 5: "Média", 10: "Máxima"}.get(game_data.get("bot_depth"), "")
    return render_template("game.html", room_id=room_id, side=side,
                           user=user, game_type=game_data["game_type"],
                           difficulty_name=difficulty_name)


@app.route("/history")
@login_required
def history():
    user = current_user()
    records = db.get_user_history(user["id"], 30)
    return render_template("history.html", user=user, records=records)


@app.route("/imgs/<path:filename>")
def serve_imgs(filename):
    return send_from_directory(os.path.join(BASE_DIR, "imgs"), filename)


# ---------------------------------------------------------------------------
# SocketIO — Game events
# ---------------------------------------------------------------------------

def _finish_game(room_id, winner):
    game = gm.GAMES[room_id]
    game_type = game["game_type"]
    pa = game["player_a"]
    pb = game["player_b"]

    mmr_change_a = None
    mmr_change_b = None

    if game_type == "ranked":
        if winner == "A":
            delta_w, delta_l, new_w, new_l = gm.calculate_elo(pa["mmr"], pb["mmr"])
            mmr_change_a, mmr_change_b = delta_w, delta_l
            db.update_mmr(pa["id"], new_w)
            db.update_mmr(pb["id"], new_l)
        else:
            delta_w, delta_l, new_w, new_l = gm.calculate_elo(pb["mmr"], pa["mmr"])
            mmr_change_b, mmr_change_a = delta_w, delta_l
            db.update_mmr(pb["id"], new_w)
            db.update_mmr(pa["id"], new_l)

    db.save_game(
        room_id=room_id,
        player_a_id=pa["id"],
        player_b_id=pb["id"],
        winner=winner,
        game_type=game_type,
        mmr_change_a=mmr_change_a,
        mmr_change_b=mmr_change_b,
        bot_depth=game.get("bot_depth"),
    )

    payload = {
        "winner": winner,
        "mmr_change_a": mmr_change_a,
        "mmr_change_b": mmr_change_b,
        "player_a": pa["username"],
        "player_b": pb["username"],
    }
    socketio.emit("game_over", payload, to=room_id)
    del gm.GAMES[room_id]


@socketio.on("join_game")
def on_join_game(data):
    user = socket_user()
    if not user:
        return
    room_id = data.get("room_id")
    game = gm.get_game(room_id)
    if not game:
        return
    side = gm.get_player_side(room_id, user["id"])
    if not side:
        return
    join_room(room_id)
    state = gm.build_game_state(room_id, side)
    emit("game_state", state)

    # Se é jogo de treino e o bot começa primeiro, arranca-o agora
    if game["game_type"] == "training" and game["current_turn"] == "B" and game["status"] == "active":
        def bot_first_move():
            import time
            time.sleep(1.0)
            game2 = gm.get_game(room_id)
            if not game2 or game2["status"] != "active" or game2["current_turn"] != "B":
                return
            bot_move = gm.get_bot_move(room_id)
            try:
                gm.apply_move(room_id, bot_move, "B")
            except Exception:
                return
            gm.switch_turn(room_id)
            winner = gm.check_game_over(room_id)
            if winner:
                socketio.emit("game_state", gm.build_game_state(room_id, "A"), to=room_id)
                _finish_game(room_id, winner)
                return
            socketio.emit("game_state", gm.build_game_state(room_id, "A"), to=room_id)
        socketio.start_background_task(bot_first_move)


@socketio.on("request_moves")
def on_request_moves(data):
    user = socket_user()
    if not user:
        return
    room_id = data.get("room_id")
    position = data.get("position")
    game = gm.get_game(room_id)
    if not game or game["status"] != "active":
        return
    side = gm.get_player_side(room_id, user["id"])
    if side != game["current_turn"]:
        emit("error", {"message": "Não é o teu turno."})
        return

    board = game["board"]
    player = Player.A if side == "A" else Player.B
    all_moves = board.get_legal_moves(player)

    # Parse board grid to identify cell type at position
    grid = gm.serialize_board(board)
    row_idx = ord(position[0]) - ord("A")
    col_idx = int(position[1]) - 1
    cell = grid[row_idx][col_idx]

    if cell.endswith("F"):
        # Figure: find all moves starting with this position
        relevant = [m for m in all_moves if m.startswith(position)]
        destinations = [m[2:] for m in relevant]
        move_strings = relevant
    else:
        # Normal card: the move is just the position itself
        if position in all_moves:
            destinations = [position]
            move_strings = [position]
        else:
            destinations = []
            move_strings = []

    emit("legal_moves", {
        "position": position,
        "destinations": destinations,
        "move_strings": move_strings,
    })


@socketio.on("play_move")
def on_play_move(data):
    user = socket_user()
    if not user:
        return
    room_id = data.get("room_id")
    move_str = data.get("move_str")
    game = gm.get_game(room_id)
    if not game or game["status"] != "active":
        return
    side = gm.get_player_side(room_id, user["id"])
    if side != game["current_turn"]:
        emit("error", {"message": "Não é o teu turno."})
        return

    # Validate move is in legal moves
    board = game["board"]
    player = Player.A if side == "A" else Player.B
    legal = board.get_legal_moves(player)
    if move_str not in legal:
        emit("error", {"message": "Jogada inválida."})
        return

    try:
        gm.apply_move(room_id, move_str, side)
    except Exception as e:
        emit("error", {"message": str(e)})
        return

    gm.switch_turn(room_id)

    # Check if the next player has no moves (game over)
    winner = gm.check_game_over(room_id)
    if winner:
        socketio.emit("game_state", gm.build_game_state(room_id, "A"), to=room_id)
        _finish_game(room_id, winner)
        return

    # Emit updated state to all in room
    socketio.emit("game_state", gm.build_game_state(room_id, "A"), to=room_id)

    # If training and now bot's turn, compute bot move in background
    if game["game_type"] == "training" and game["current_turn"] == "B":
        def bot_move_task():
            import time
            time.sleep(1.0)   # small pause so player sees state update first
            game2 = gm.get_game(room_id)
            if not game2 or game2["status"] != "active":
                return
            bot_move = gm.get_bot_move(room_id)  # depth 10, ~1-5s compute
            try:
                gm.apply_move(room_id, bot_move, "B")
            except Exception:
                return
            gm.switch_turn(room_id)
            winner2 = gm.check_game_over(room_id)
            if winner2:
                socketio.emit("game_state", gm.build_game_state(room_id, "A"), to=room_id)
                _finish_game(room_id, winner2)
                return
            socketio.emit("game_state", gm.build_game_state(room_id, "A"), to=room_id)

        socketio.start_background_task(bot_move_task)


# ---------------------------------------------------------------------------
# SocketIO — Matchmaking
# ---------------------------------------------------------------------------

@socketio.on("join_queue")
def on_join_queue():
    user = socket_user()
    if not user:
        return
    # Refresh from DB
    fresh = db.get_user_by_id(user["id"])
    gm.enqueue(fresh["id"], fresh["username"], fresh["mmr"], fresh.get("skin", 1), request.sid)
    emit("queue_update", {"in_queue": True})

    pair = gm.try_match()
    if pair:
        p_a, p_b = pair
        room_id = gm.create_ranked_game(p_a, p_b)
        socketio.emit("matched", {"room_id": room_id, "side": "A"}, to=p_a["sid"])
        socketio.emit("matched", {"room_id": room_id, "side": "B"}, to=p_b["sid"])


@socketio.on("leave_queue")
def on_leave_queue():
    user = socket_user()
    if not user:
        return
    gm.dequeue(user["id"])
    emit("queue_update", {"in_queue": False})


@socketio.on("disconnect")
def on_disconnect():
    user = socket_user()
    if user:
        gm.dequeue(user["id"])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    db.init_db()
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, debug=False, host="0.0.0.0", port=port)
