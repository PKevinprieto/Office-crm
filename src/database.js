const { Pool } = require("pg");
require("dotenv").config();

if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL en el archivo .env");
}

const db = new Pool({
  connectionString: process.env.DATABASE_URL,

  // Estamos conectando desde tu PC a Render.
  ssl: {
    rejectUnauthorized: false,
  },

  // Para esta etapa alcanza de sobra.
  max: 5,
});

async function initializeDatabase() {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id BIGSERIAL PRIMARY KEY,

        whatsapp_number TEXT NOT NULL UNIQUE,

        name TEXT NOT NULL,

        whatsapp_name TEXT,
        custom_name TEXT,

        initials TEXT,

        last_message TEXT,
        last_message_at BIGINT,

        created_at BIGINT NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,

        whatsapp_message_id TEXT UNIQUE,

        conversation_id BIGINT NOT NULL,

        direction TEXT NOT NULL
          CHECK(direction IN ('received', 'sent')),

        type TEXT NOT NULL DEFAULT 'text',

        text TEXT,

        timestamp BIGINT NOT NULL,

        status TEXT,

        media_id TEXT,
        media_type TEXT,

        reaction TEXT,

        CONSTRAINT fk_messages_conversation
          FOREIGN KEY (conversation_id)
          REFERENCES conversations(id)
          ON DELETE CASCADE
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp
      ON messages(timestamp);
    `);

    await client.query("COMMIT");

    console.log("✅ PostgreSQL conectado y tablas preparadas");
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("❌ Error inicializando PostgreSQL:", error);

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  db,
  initializeDatabase,
};
