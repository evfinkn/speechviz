import argparse
import sqlite3

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Adds / updates / deletes users from the database"
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help=(
            "If passed, the user will be deleted. Otherwise, the user will be added if"
            " they don't exist, or their password will be updated if they already exist"
        ),
    )
    parser.add_argument("user", help="The user to add / update / delete")
    parser.add_argument(
        "password",
        nargs="?",
        help="The password to give the user. Not used if deleting the user",
    )

    args = parser.parse_args()
    delete = args.delete
    user = args.user
    conn = sqlite3.connect("speechviz.sqlite3")
    c = conn.cursor()
    if delete:
        c.execute("DELETE FROM users WHERE user=?", (user,))
        print(f"Deleted user '{user}'")
    else:
        password = args.password
        c.execute("SELECT * FROM users WHERE user=?", (user,))
        results = c.fetchall()
        if len(results) == 0:
            c.execute("INSERT INTO users(user, password) VALUES(?,?)", (user, password))
            print(f"Added user '{user}'")
        else:
            c.execute("UPDATE users SET password=? WHERE user=?", (password, user))
            print(f"Updated password for user '{user}'")
    conn.commit()
    conn.close()
