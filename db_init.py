import sqlite3
import os

def init_database():
    # delete the database if it already exists
    try:
        os.remove('speechviz.sqlite3')
    except FileNotFoundError:
        pass

    conn = sqlite3.connect('speechviz.sqlite3')
    c = conn.cursor()

    # create audiofiles table
    c.execute('''CREATE TABLE IF NOT EXISTS audiofiles(
        id INTEGER PRIMARY KEY,
        audiofile TEXT,
        UNIQUE(audiofile)
    )''')
    conn.commit()

    # create users table
    c.execute('''CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY,
        user TEXT,
        password TEXT,
        UNIQUE(user)
    )''')
    
    # add 'user' to users
    c.execute("INSERT INTO users(user, password) VALUES('user', 'pass')")
    conn.commit()

    # create labels table
    c.execute('''CREATE TABLE IF NOT EXISTS labels(
        id INTEGER PRIMARY KEY,
        label TEXT,
        UNIQUE(label)
    )''')
    conn.commit()

    # create paths table
    c.execute('''CREATE TABLE IF NOT EXISTS paths(
        id INTEGER PRIMARY KEY,
        path TEXT,
        UNIQUE(path)
    )''')

    # create annotations table
    c.execute('''CREATE TABLE IF NOT EXISTS annotations(
        fileId INTEGER,
        userId INTEGER,
        startTime REAL,
        endTime REAL,
        editable INTEGER(1),
        labelId INTEGER,
        id TEXT,
        pathId INTEGER,
        treeText TEXT,
        removable INTEGER(1),
        FOREIGN KEY(fileId) references audiofiles(id),
        FOREIGN KEY(userId) references users(id),
        FOREIGN KEY(labelId) references labels(id),
        FOREIGN KEY(pathId) references paths(id)
    )''')
    conn.commit()

    conn.close()

if __name__ == "__main__":
    init_database()
