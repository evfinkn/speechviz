import os
import sqlite3


def init_database():
    # delete the database if it already exists
    try:
        os.remove("speechviz.sqlite3")
    except FileNotFoundError:
        pass

    conn = sqlite3.connect("speechviz.sqlite3")
    c = conn.cursor()

    # create users table
    c.execute("""CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY,
        user TEXT,
        password TEXT,
        UNIQUE(user)
    )""")
    # add 'user' to users
    c.execute("INSERT INTO users(user, password) VALUES('user', 'pass')")

    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_database()
