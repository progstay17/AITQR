/** Minimal asynchronous SQL adapter backed by Node's built-in SQLite. */
export class SqliteStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values) ?? null;
    if (column && row) return row[column] ?? null;
    return row;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      success: true,
      meta: {
        last_row_id: Number(result.lastInsertRowid ?? 0),
        changes: Number(result.changes ?? 0),
      },
    };
  }
}

export class SqliteDatabase {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new SqliteStatement(this.database, sql);
  }
}
