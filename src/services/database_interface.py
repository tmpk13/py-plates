import apsw
import json
from typing import Iterator, Optional, Any
from datetime import datetime

class Database:
    def __init__(self, db_path: str = "database.db"):
        self.conn = apsw.Connection(db_path)
        self._create_table()
    
    def _create_table(self):
        cursor = self.conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                date TEXT NOT NULL,
                content TEXT NOT NULL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_name ON entries(name)")
    
    def get_name(self, name: str) -> list[dict[str, Any]]:
        """Return all entries matching the given name"""
        cursor = self.conn.cursor()
        results = cursor.execute(
            "SELECT id, name, date, content FROM entries WHERE name = ?",
            (name,)
        )
        return [
            {
                "id": row[0],
                "name": row[1],
                "date": row[2],
                "content": json.loads(row[3])
            }
            for row in results
        ]
    
    def info(self, entry_id: int) -> Optional[dict[str, Any]]:
        """Dict-like access: db.info(33241) -> entry details"""
        cursor = self.conn.cursor()
        result = cursor.execute(
            "SELECT id, name, date, content FROM entries WHERE id = ?",
            (entry_id,)
        ).fetchone()
        
        if result:
            return {
                "id": result[0],
                "name": result[1],
                "date": result[2],
                "content": json.loads(result[3])
            }
        return None
    
    def all(self) -> Iterator[dict[str, Any]]:
        """Yield all entries one by one"""
        cursor = self.conn.cursor()
        for row in cursor.execute("SELECT id, name, date, content FROM entries"):
            yield {
                "id": row[0],
                "name": row[1],
                "date": row[2],
                "content": json.loads(row[3])
            }
    
    def insert(self, name: str, content: dict, date: Optional[str] = None) -> int:
        """Insert new entry, returns auto-generated ID"""
        if date is None:
            date = datetime.now().strftime("%m/%d/%y")
        
        cursor = self.conn.cursor()
        cursor.execute(
            "INSERT INTO entries (name, date, content) VALUES (?, ?, ?)",
            (name, date, json.dumps(content))
        )
        return self.conn.last_insert_rowid()
    
    def clear(self):
        """Delete all entries from database"""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM entries")
        cursor.execute("DELETE FROM sqlite_sequence WHERE name='entries'")  # Reset autoincrement counter

    def drop(self):
        """Drop entire table (nuclear option)"""
        cursor = self.conn.cursor()
        cursor.execute("DROP TABLE IF EXISTS entries")
        cursor.execute("DROP INDEX IF EXISTS idx_name")
        self._create_table()  # Recreate fresh table
    
    def __sizeof__(self) -> int:
        """Return database size in bytes"""
        cursor = self.conn.cursor()
        result = cursor.execute(
            "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()"
        ).fetchone()
        return result[0] if result else 0

"""
db = Database()

id1 = db.insert("123faf", {"key": "value"}, "2/12/23")  # Returns auto-gen ID
id2 = db.insert("123faf", {"another": "data"}, "2/12/23")
id3 = db.insert("gs21dk", {"more": "info"}, "2/13/23")

print(f"Inserted IDs: {id1}, {id2}, {id3}")

# Retrieve
print(db.info(id1))  # Get by auto-generated ID
print(db.get_name("123faf"))  # All entries with name

for entry in db.all():
    print(entry)
"""