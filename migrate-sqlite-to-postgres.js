const { DatabaseSync } = require("node:sqlite");
const { Pool } = require("pg");
const path = require("path");
require("dotenv").config();

if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL en .env");
}

// =========================
// SQLITE
// =========================

const sqlitePath = path.join(__dirname, "data", "crm.db");

const sqlite = new DatabaseSync(sqlitePath);

// =========================
// POSTGRESQL
// =========================

const postgres = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false,
  },

  max: 5,
});

// =========================
// MIGRACIÓN
// =========================

async function migrate() {
  const client = await postgres.connect();

  try {
    console.log("Iniciando migración...");
    console.log("SQLite:", sqlitePath);

    // =========================
    // LEER SQLITE
    // =========================

    const conversations = sqlite
      .prepare(
        `
        SELECT *
        FROM conversations
        ORDER BY id ASC
      `,
      )
      .all();

    const messages = sqlite
      .prepare(
        `
        SELECT *
        FROM messages
        ORDER BY id ASC
      `,
      )
      .all();

    console.log(`Conversaciones encontradas: ${conversations.length}`);

    console.log(`Mensajes encontrados: ${messages.length}`);

    await client.query("BEGIN");

    // Relacionamos el ID viejo de SQLite
    // con el nuevo ID generado por PostgreSQL.
    const conversationIdMap = new Map();

    // =========================
    // MIGRAR CONVERSACIONES
    // =========================

    for (const conversation of conversations) {
      const result = await client.query(
        `
          INSERT INTO conversations (
            whatsapp_number,
            name,
            whatsapp_name,
            custom_name,
            initials,
            last_message,
            last_message_at,
            created_at
          )
          VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8
          )

          ON CONFLICT (whatsapp_number)
          DO UPDATE SET
            name = EXCLUDED.name,
            whatsapp_name = EXCLUDED.whatsapp_name,
            custom_name = EXCLUDED.custom_name,
            initials = EXCLUDED.initials,
            last_message = EXCLUDED.last_message,
            last_message_at = EXCLUDED.last_message_at

          RETURNING id
        `,
        [
          conversation.whatsapp_number,
          conversation.name,
          conversation.whatsapp_name || null,
          conversation.custom_name || null,
          conversation.initials || null,
          conversation.last_message || null,
          conversation.last_message_at || null,
          conversation.created_at,
        ],
      );

      const postgresConversationId = Number(result.rows[0].id);

      conversationIdMap.set(Number(conversation.id), postgresConversationId);
    }

    console.log("Conversaciones migradas.");

    // =========================
    // MIGRAR MENSAJES
    // =========================

    for (const message of messages) {
      const postgresConversationId = conversationIdMap.get(
        Number(message.conversation_id),
      );

      if (!postgresConversationId) {
        console.warn(
          `Se omitió mensaje ${message.id}: conversación inexistente`,
        );

        continue;
      }

      await client.query(
        `
          INSERT INTO messages (
            whatsapp_message_id,
            conversation_id,
            direction,
            type,
            text,
            timestamp,
            status,
            media_id,
            media_type,
            reaction
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10
          )

          ON CONFLICT (whatsapp_message_id)
          DO UPDATE SET
            conversation_id = EXCLUDED.conversation_id,
            direction = EXCLUDED.direction,
            type = EXCLUDED.type,
            text = EXCLUDED.text,
            timestamp = EXCLUDED.timestamp,
            status = EXCLUDED.status,
            media_id = EXCLUDED.media_id,
            media_type = EXCLUDED.media_type,
            reaction = EXCLUDED.reaction
        `,
        [
          message.whatsapp_message_id || null,
          postgresConversationId,
          message.direction,
          message.type,
          message.text || "",
          message.timestamp,
          message.status || null,
          message.media_id || null,
          message.media_type || null,
          message.reaction || null,
        ],
      );
    }

    console.log("Mensajes migrados.");

    await client.query("COMMIT");

    // =========================
    // VERIFICAR
    // =========================

    const postgresConversations = await client.query(`
        SELECT COUNT(*) AS total
        FROM conversations
      `);

    const postgresMessages = await client.query(`
        SELECT COUNT(*) AS total
        FROM messages
      `);

    console.log("");
    console.log("==============================");
    console.log("MIGRACIÓN TERMINADA");
    console.log("==============================");

    console.log(
      "Conversaciones en PostgreSQL:",
      postgresConversations.rows[0].total,
    );

    console.log("Mensajes en PostgreSQL:", postgresMessages.rows[0].total);

    console.log("==============================");
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("");
    console.error("ERROR DURANTE LA MIGRACIÓN:");
    console.error(error);

    process.exitCode = 1;
  } finally {
    client.release();

    await postgres.end();

    sqlite.close();
  }
}

migrate();
