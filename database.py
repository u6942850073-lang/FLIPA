import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "flipa.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                username   TEXT NOT NULL UNIQUE,
                password   TEXT NOT NULL,
                mmr        INTEGER NOT NULL DEFAULT 0,
                skin       INTEGER NOT NULL DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS games (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id       TEXT NOT NULL UNIQUE,
                player_a_id   INTEGER NOT NULL REFERENCES users(id),
                player_b_id   INTEGER,
                winner        TEXT NOT NULL,
                game_type     TEXT NOT NULL,
                mmr_change_a  INTEGER,
                mmr_change_b  INTEGER,
                bot_depth     INTEGER,
                played_at     TEXT DEFAULT (datetime('now'))
            );
        """)
        # Migrate existing DB: add skin column if missing
        cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "skin" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN skin INTEGER NOT NULL DEFAULT 1")


def get_user_by_username(username):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def create_user(username, hashed_pw):
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO users (username, password) VALUES (?, ?)",
            (username, hashed_pw)
        )
        return cur.lastrowid


def update_mmr(user_id, new_mmr):
    with get_conn() as conn:
        conn.execute("UPDATE users SET mmr = ? WHERE id = ?", (new_mmr, user_id))


def update_skin(user_id, skin):
    with get_conn() as conn:
        conn.execute("UPDATE users SET skin = ? WHERE id = ?", (skin, user_id))


def save_game(room_id, player_a_id, player_b_id, winner, game_type,
              mmr_change_a, mmr_change_b, bot_depth):
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO games
                (room_id, player_a_id, player_b_id, winner, game_type,
                 mmr_change_a, mmr_change_b, bot_depth)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (room_id, player_a_id, player_b_id, winner, game_type,
              mmr_change_a, mmr_change_b, bot_depth))


def get_user_history(user_id, limit=20):
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT
                g.room_id, g.winner, g.game_type, g.mmr_change_a, g.mmr_change_b,
                g.bot_depth, g.played_at,
                ua.username AS username_a,
                ub.username AS username_b,
                CASE WHEN g.player_a_id = ? THEN 'A' ELSE 'B' END AS your_side
            FROM games g
            JOIN users ua ON ua.id = g.player_a_id
            LEFT JOIN users ub ON ub.id = g.player_b_id
            WHERE g.player_a_id = ? OR g.player_b_id = ?
            ORDER BY g.played_at DESC
            LIMIT ?
        """, (user_id, user_id, user_id, limit)).fetchall()
        return [dict(r) for r in rows]


def get_leaderboard(limit=10):
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT username, mmr, skin,
                   (SELECT COUNT(*) FROM games
                    WHERE (player_a_id = u.id OR player_b_id = u.id)
                    AND game_type = 'ranked') AS games_played,
                   (SELECT COUNT(*) FROM games
                    WHERE game_type = 'ranked'
                    AND ((player_a_id = u.id AND winner = 'A')
                      OR (player_b_id = u.id AND winner = 'B'))) AS wins
            FROM users u
            ORDER BY mmr DESC
            LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]
