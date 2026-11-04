import sqlite3

con = sqlite3.connect('/docker/tracert/data/database.sqlite')
cur = con.cursor()

print("=== COMMANDS FOR ROUTERS 2 AND 3 ===")
for r in cur.execute("SELECT id, router_id, command_type, status, created_at, executed_at FROM router_commands WHERE router_id IN (2, 3)"):
    print(r)
