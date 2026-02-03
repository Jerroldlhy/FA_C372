const session = require("express-session");

class MySQLSessionStore extends session.Store {
  constructor(pool, options = {}) {
    super();
    this.pool = pool;
    this.ttlMs = Number(options.ttlMs || 2 * 60 * 60 * 1000);
  }

  async ensureTable() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR(128) NOT NULL PRIMARY KEY,
        sess TEXT NOT NULL,
        expires DATETIME(6) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sessions_expires (expires)
      )
    `);
  }

  async cleanupExpired() {
    await this.pool.query("DELETE FROM sessions WHERE expires <= UTC_TIMESTAMP(6)");
  }

  get(sid, callback) {
    this.pool
      .query(
        "SELECT sess FROM sessions WHERE sid = ? AND expires > UTC_TIMESTAMP(6) LIMIT 1",
        [sid]
      )
      .then(([rows]) => {
        if (!rows.length) return callback(null, null);
        try {
          return callback(null, JSON.parse(rows[0].sess));
        } catch (err) {
          return callback(err);
        }
      })
      .catch((err) => callback(err));
  }

  set(sid, sess, callback) {
    const expiresAt = this.getExpiration(sess);
    let payload;
    try {
      payload = JSON.stringify(sess);
    } catch (err) {
      callback(err);
      return;
    }

    this.pool
      .query(
        `
          INSERT INTO sessions (sid, sess, expires)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE sess = VALUES(sess), expires = VALUES(expires)
        `,
        [sid, payload, expiresAt]
      )
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  touch(sid, sess, callback) {
    const expiresAt = this.getExpiration(sess);
    this.pool
      .query("UPDATE sessions SET expires = ? WHERE sid = ?", [expiresAt, sid])
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  destroy(sid, callback) {
    this.pool
      .query("DELETE FROM sessions WHERE sid = ?", [sid])
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  getExpiration(sess) {
    const cookieExpiry = sess?.cookie?.expires;
    if (cookieExpiry) {
      const date = new Date(cookieExpiry);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
    return new Date(Date.now() + this.ttlMs);
  }
}

module.exports = MySQLSessionStore;
