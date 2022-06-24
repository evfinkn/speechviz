import sqlite3
import os

def init_database():
    try:
        os.remove('clinic.sqlite3')
    except FileNotFoundError:
        pass

    conn = sqlite3.connect('speechviz.sqlite3')
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS wavefiles(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    audiofile TEXT,
                    datafile TEXT,
                    UNIQUE(audiofile))''')
    conn.commit()

    # create the users and include the passwords
    c.execute('''CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT,
        password TEXT,
        UNIQUE(user)
    )''')
    c.execute("INSERT INTO users(user, password) VALUES('user', 'pass')")
    conn.commit()

    # create annotations tables
    c.execute('''CREATE TABLE IF NOT EXISTS annotations(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER,
            user_id INTEGER,
            start REAL,
            end REAL,
            label TEXT,
            UNIQUE(user_id, file_id, id),
            FOREIGN KEY(file_id) references wavefiles(id),
            FOREIGN KEY(user_id) references users(id)
            )''')

    conn.close()

if __name__ == "__main__":
    init_database()
