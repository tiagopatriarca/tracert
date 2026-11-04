import sqlite3

con = sqlite3.connect('/docker/tracert/data/database.sqlite')
cur = con.cursor()

print("=== CLIENTS ===")
for row in cur.execute("SELECT * FROM clients"):
    print(row)
