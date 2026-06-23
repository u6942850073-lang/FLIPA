import os
import sqlite3

DATABASE_URL = os.environ.get("DATABASE_URL")

if DATABASE_URL:
    import psycopg2
    import psycopg2.extras

    def get_conn():
        url = DATABASE_URL
        # Railway uses postgres://, psycopg2 needs postgresql://
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        conn = psycopg2.connect(url)
        return conn

    def _exec(conn, sql, params=()):
        sql = sql.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
        sql = sql.replace("datetime('now')", "NOW()")
        sql = sql.replace("?", "%s")
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        return cur

    def init_db():
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id         SERIAL PRIMARY KEY,
                    username   TEXT NOT NULL UNIQUE,
                    password   TEXT NOT NULL,
                    mmr        INTEGER NOT NULL DEFAULT 0,
                    skin       INTEGER NOT NULL DEFAULT 1,
                    theme      INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS games (
                    id            SERIAL PRIMARY KEY,
                    room_id       TEXT NOT NULL UNIQUE,
                    player_a_id   INTEGER NOT NULL REFERENCES users(id),
                    player_b_id   INTEGER,
                    winner        TEXT NOT NULL,
                    game_type     TEXT NOT NULL,
                    mmr_change_a  INTEGER,
                    mmr_change_b  INTEGER,
                    bot_depth     INTEGER,
                    played_at     TEXT DEFAULT NOW()
                )
            """)
            # One-time cleanup: remove bot games from existing data
            cur.execute("DELETE FROM games WHERE player_b_id IS NULL")
            # Migrations: add columns if they don't exist yet
            cur.execute("""
                DO $$ BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name='users' AND column_name='skin'
                    ) THEN
                        ALTER TABLE users ADD COLUMN skin INTEGER NOT NULL DEFAULT 1;
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name='users' AND column_name='theme'
                    ) THEN
                        ALTER TABLE users ADD COLUMN theme INTEGER NOT NULL DEFAULT 1;
                    END IF;
                END $$;
            """)
            conn.commit()

    def get_user_by_username(username):
        with get_conn() as conn:
            cur = _exec(conn, "SELECT * FROM users WHERE username = %s", (username,))
            row = cur.fetchone()
            return dict(row) if row else None

    def get_user_by_id(user_id):
        with get_conn() as conn:
            cur = _exec(conn, "SELECT * FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            return dict(row) if row else None

    def create_user(username, hashed_pw):
        with get_conn() as conn:
            cur = _exec(conn,
                "INSERT INTO users (username, password) VALUES (%s, %s) RETURNING id",
                (username, hashed_pw))
            conn.commit()
            return cur.fetchone()["id"]

    def update_mmr(user_id, new_mmr):
        with get_conn() as conn:
            _exec(conn, "UPDATE users SET mmr = %s WHERE id = %s", (new_mmr, user_id))
            conn.commit()

    def update_skin(user_id, skin):
        with get_conn() as conn:
            _exec(conn, "UPDATE users SET skin = %s WHERE id = %s", (skin, user_id))
            conn.commit()

    def update_theme(user_id, theme):
        with get_conn() as conn:
            _exec(conn, "UPDATE users SET theme = %s WHERE id = %s", (theme, user_id))
            conn.commit()

    def save_game(room_id, player_a_id, player_b_id, winner, game_type,
                  mmr_change_a, mmr_change_b, bot_depth):
        if player_b_id is None:
            return
        with get_conn() as conn:
            _exec(conn, """
                INSERT INTO games
                    (room_id, player_a_id, player_b_id, winner, game_type,
                     mmr_change_a, mmr_change_b, bot_depth)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (room_id, player_a_id, player_b_id, winner, game_type,
                  mmr_change_a, mmr_change_b, bot_depth))
            # Keep only the 10 most recent games per player
            for pid in (player_a_id, player_b_id):
                _exec(conn, """
                    DELETE FROM games
                    WHERE (player_a_id = %s OR player_b_id = %s)
                      AND id NOT IN (
                          SELECT id FROM games
                          WHERE player_a_id = %s OR player_b_id = %s
                          ORDER BY played_at DESC
                          LIMIT 10
                      )
                """, (pid, pid, pid, pid))
            conn.commit()

    def get_user_history(user_id, limit=10):
        with get_conn() as conn:
            cur = _exec(conn, """
                SELECT
                    g.room_id, g.winner, g.game_type, g.mmr_change_a, g.mmr_change_b,
                    g.bot_depth, g.played_at,
                    ua.username AS username_a,
                    ub.username AS username_b,
                    CASE WHEN g.player_a_id = %s THEN 'A' ELSE 'B' END AS your_side
                FROM games g
                JOIN users ua ON ua.id = g.player_a_id
                LEFT JOIN users ub ON ub.id = g.player_b_id
                WHERE (g.player_a_id = %s OR g.player_b_id = %s)
                  AND g.player_b_id IS NOT NULL
                ORDER BY g.played_at DESC
                LIMIT %s
            """, (user_id, user_id, user_id, limit))
            return [dict(r) for r in cur.fetchall()]

    def get_leaderboard(limit=10):
        with get_conn() as conn:
            cur = _exec(conn, """
                SELECT username, mmr, skin
                FROM users u
                ORDER BY mmr DESC
                LIMIT %s
            """, (limit,))
            return [dict(r) for r in cur.fetchall()]

else:
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
                    theme      INTEGER NOT NULL DEFAULT 1,
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
            cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
            if "skin" not in cols:
                conn.execute("ALTER TABLE users ADD COLUMN skin INTEGER NOT NULL DEFAULT 1")
            if "theme" not in cols:
                conn.execute("ALTER TABLE users ADD COLUMN theme INTEGER NOT NULL DEFAULT 1")

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

    def update_theme(user_id, theme):
        with get_conn() as conn:
            conn.execute("UPDATE users SET theme = ? WHERE id = ?", (theme, user_id))

    def save_game(room_id, player_a_id, player_b_id, winner, game_type,
                  mmr_change_a, mmr_change_b, bot_depth):
        if player_b_id is None:
            return
        with get_conn() as conn:
            conn.execute("""
                INSERT INTO games
                    (room_id, player_a_id, player_b_id, winner, game_type,
                     mmr_change_a, mmr_change_b, bot_depth)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (room_id, player_a_id, player_b_id, winner, game_type,
                  mmr_change_a, mmr_change_b, bot_depth))
            # Keep only the 10 most recent games per player
            for pid in (player_a_id, player_b_id):
                conn.execute("""
                    DELETE FROM games
                    WHERE (player_a_id = ? OR player_b_id = ?)
                      AND id NOT IN (
                          SELECT id FROM games
                          WHERE player_a_id = ? OR player_b_id = ?
                          ORDER BY played_at DESC
                          LIMIT 10
                      )
                """, (pid, pid, pid, pid))

    def get_user_history(user_id, limit=10):
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
                WHERE (g.player_a_id = ? OR g.player_b_id = ?)
                  AND g.player_b_id IS NOT NULL
                ORDER BY g.played_at DESC
                LIMIT ?
            """, (user_id, user_id, user_id, limit)).fetchall()
            return [dict(r) for r in rows]

    def get_leaderboard(limit=10):
        with get_conn() as conn:
            rows = conn.execute("""
                SELECT username, mmr, skin
                FROM users u
                ORDER BY mmr DESC
                LIMIT ?
            """, (limit,)).fetchall()
            return [dict(r) for r in rows]
