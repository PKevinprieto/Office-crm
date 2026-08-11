const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const http = require("http");
const { db, initializeDatabase } = require("./database");
const multer = require("multer");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});
io.use((socket, next) => {
  const clientKey = socket.handshake.auth?.clientKey;
  const expectedKey = process.env.OFFICE_CLIENT_KEY;

  if (!expectedKey) {
    console.error("Falta OFFICE_CLIENT_KEY para Socket.IO");

    return next(new Error("Error de configuración del servidor"));
  }

  if (clientKey !== expectedKey) {
    return next(new Error("No autorizado"));
  }

  next();
});

app.use(cors());
app.use(express.json());

function requireClientAuth(req, res, next) {
  const authorization = req.headers.authorization;

  const expectedKey = process.env.OFFICE_CLIENT_KEY;

  if (!expectedKey) {
    console.error("Falta OFFICE_CLIENT_KEY en las variables de entorno");

    return res.status(500).json({
      ok: false,
      message: "Error de configuración del servidor",
    });
  }

  if (!authorization) {
    return res.status(401).json({
      ok: false,
      message: "No autorizado",
    });
  }

  const expectedAuthorization = `Bearer ${expectedKey}`;

  if (authorization !== expectedAuthorization) {
    return res.status(401).json({
      ok: false,
      message: "No autorizado",
    });
  }

  next();
}
app.use("/api", requireClientAuth);

app.use(express.static(path.join(__dirname, "../public")));

function formatTime(timestamp) {
  return new Date(Number(timestamp)).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// =========================
// ESTADO DEL SERVIDOR
// =========================

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    message: "El servidor del CRM está funcionando",
  });
});

// =========================
// CONVERSACIONES
// =========================

app.get("/api/conversations", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        id,
        COALESCE(custom_name, whatsapp_name, name, whatsapp_number) AS name,
        whatsapp_number AS number,
        initials,
        last_message AS "lastMessage",
        last_message_at AS "lastMessageAt"
      FROM conversations
      ORDER BY last_message_at DESC NULLS LAST
    `);

    const result = rows.map((conversation) => ({
      ...conversation,
      id: Number(conversation.id),
      lastMessageAt: conversation.lastMessageAt
        ? Number(conversation.lastMessageAt)
        : null,
      time: conversation.lastMessageAt
        ? formatTime(conversation.lastMessageAt)
        : "",
    }));

    return res.json(result);
  } catch (error) {
    console.error("Error obteniendo conversaciones:", error);

    return res.status(500).json({
      ok: false,
      message: "No se pudieron obtener las conversaciones",
    });
  }
});

// =========================
// MENSAJES DE UNA CONVERSACIÓN
// =========================

app.get("/api/conversations/:id/messages", async (req, res) => {
  try {
    const conversationId = Number(req.params.id);

    const conversationResult = await db.query(
      `
        SELECT
          id,
          COALESCE(custom_name, whatsapp_name, name, whatsapp_number) AS name,
          whatsapp_number AS number,
          initials,
          custom_name AS "customName",
          whatsapp_name AS "whatsappName"
        FROM conversations
        WHERE id = $1
      `,
      [conversationId],
    );

    const conversation = conversationResult.rows[0];

    if (!conversation) {
      return res.status(404).json({
        ok: false,
        message: "Conversación no encontrada",
      });
    }

    const messagesResult = await db.query(
      `
        SELECT
          id,
          whatsapp_message_id AS "whatsappMessageId",
          direction AS type,
          text,
          timestamp,
          status,
          media_id AS "mediaId",
          media_type AS "mediaType",
          reaction
        FROM messages
        WHERE conversation_id = $1
        ORDER BY timestamp ASC
      `,
      [conversationId],
    );

    const messages = messagesResult.rows.map((message) => ({
      ...message,
      id: Number(message.id),
      timestamp: Number(message.timestamp),
      time: formatTime(message.timestamp),
    }));

    return res.json({
      ...conversation,
      id: Number(conversation.id),
      messages,
    });
  } catch (error) {
    console.error("Error obteniendo mensajes:", error);

    return res.status(500).json({
      ok: false,
      message: "No se pudieron obtener los mensajes",
    });
  }
});

// =========================
// EDITAR / AGENDAR CONTACTO
// =========================

app.patch("/api/conversations/:id/contact", async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const { name } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        ok: false,
        message: "El nombre no puede estar vacío",
      });
    }

    const conversationResult = await db.query(
      `
        SELECT *
        FROM conversations
        WHERE id = $1
      `,
      [conversationId],
    );

    const conversation = conversationResult.rows[0];

    if (!conversation) {
      return res.status(404).json({
        ok: false,
        message: "Conversación no encontrada",
      });
    }

    const customName = name.trim();

    const initials = customName
      .split(" ")
      .map((word) => word[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    await db.query(
      `
        UPDATE conversations
        SET
          custom_name = $1,
          initials = $2
        WHERE id = $3
      `,
      [customName, initials, conversationId],
    );

    return res.json({
      ok: true,
      conversation: {
        id: conversationId,
        name: customName,
        initials,
      },
    });
  } catch (error) {
    console.error("Error editando contacto:", error);

    return res.status(500).json({
      ok: false,
      message: "No se pudo editar el contacto",
    });
  }
});
// =========================
// ENVIAR MENSAJE DE TEXTO
// =========================

app.post("/api/messages", async (req, res) => {
  const { conversationId, text } = req.body;

  if (!conversationId || !text?.trim()) {
    return res.status(400).json({
      ok: false,
      message: "Faltan conversationId o text",
    });
  }

  try {
    const conversationResult = await db.query(
      `
        SELECT *
        FROM conversations
        WHERE id = $1
      `,
      [Number(conversationId)],
    );

    const conversation = conversationResult.rows[0];

    if (!conversation) {
      return res.status(404).json({
        ok: false,
        message: "Conversación no encontrada",
      });
    }

    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const apiVersion = process.env.WHATSAPP_API_VERSION;

    if (!token || !phoneNumberId || !apiVersion) {
      return res.status(500).json({
        ok: false,
        message: "Faltan credenciales de WhatsApp en el archivo .env",
      });
    }

    const recipient = conversation.whatsapp_number.replace(/\D/g, "");

    const whatsappResponse = await axios.post(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: {
          preview_url: false,
          body: text.trim(),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    const whatsappMessageId = whatsappResponse.data.messages?.[0]?.id || null;

    const timestamp = Date.now();

    await db.query(
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
          media_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        whatsappMessageId,
        Number(conversation.id),
        "sent",
        "text",
        text.trim(),
        timestamp,
        "sent",
        null,
        null,
      ],
    );

    await db.query(
      `
        UPDATE conversations
        SET
          last_message = $1,
          last_message_at = $2
        WHERE id = $3
      `,
      [text.trim(), timestamp, Number(conversation.id)],
    );

    const newMessage = {
      id: whatsappMessageId || Date.now(),
      type: "sent",
      text: text.trim(),
      time: formatTime(timestamp),
      status: "sent",
    };

    io.emit("new-message", {
      conversationId: Number(conversation.id),
    });

    return res.status(201).json({
      ok: true,
      message: newMessage,
      whatsappMessageId,
    });
  } catch (error) {
    console.error(
      "Error enviando/guardando mensaje:",
      error.response?.data || error,
    );

    return res.status(error.response?.status || 500).json({
      ok: false,
      message:
        error.response?.data?.error?.message ||
        "No se pudo enviar o guardar el mensaje",
      details: error.response?.data || null,
    });
  }
});

// =========================
// VERIFICACIÓN DEL WEBHOOK
// =========================

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado correctamente");
    return res.status(200).send(challenge);
  }

  console.log("Falló la verificación del webhook");
  return res.sendStatus(403);
});

// =========================
// WEBHOOK DE WHATSAPP
// =========================

app.post("/webhook", async (req, res) => {
  try {
    console.log("Evento recibido desde WhatsApp:");
    console.dir(req.body, { depth: null });

    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const incomingMessage = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    // Meta también envía estados:
    // enviado, entregado, leído, etc.
    if (!incomingMessage) {
      return res.sendStatus(200);
    }

    console.log("MENSAJE COMPLETO:");
    console.dir(incomingMessage, { depth: null });

    // =========================
    // REACCIONES
    // =========================

    if (incomingMessage.type === "reaction") {
      const reactedMessageId = incomingMessage.reaction?.message_id;

      const emoji = incomingMessage.reaction?.emoji || "";

      if (!reactedMessageId) {
        return res.sendStatus(200);
      }

      const originalMessageResult = await db.query(
        `
          SELECT *
          FROM messages
          WHERE whatsapp_message_id = $1
        `,
        [reactedMessageId],
      );

      const originalMessage = originalMessageResult.rows[0];

      if (!originalMessage) {
        console.log(
          "No se encontró el mensaje original de la reacción:",
          reactedMessageId,
        );

        return res.sendStatus(200);
      }

      await db.query(
        `
          UPDATE messages
          SET reaction = $1
          WHERE whatsapp_message_id = $2
        `,
        [emoji, reactedMessageId],
      );

      console.log("Reacción guardada:", emoji, "en mensaje:", reactedMessageId);

      io.emit("new-message", {
        conversationId: Number(originalMessage.conversation_id),
      });

      return res.sendStatus(200);
    }

    // =========================
    // DATOS DEL MENSAJE
    // =========================

    const senderNumber = incomingMessage.from;

    const senderName = contact?.profile?.name || senderNumber;

    let messageText = "";
    let mediaId = null;
    let mediaType = null;

    if (incomingMessage.type === "text") {
      messageText = incomingMessage.text?.body || "";
    } else if (incomingMessage.type === "image") {
      messageText = incomingMessage.image?.caption || "";

      mediaId = incomingMessage.image?.id || null;

      mediaType = "image";

      console.log("ID de imagen recibido:", mediaId);
    } else {
      messageText = `[${incomingMessage.type}]`;
    }

    const timestamp = Number(incomingMessage.timestamp) * 1000;

    console.log("Nombre:", senderName);
    console.log("Número:", senderNumber);
    console.log("Mensaje:", messageText);

    // =========================
    // BUSCAR / CREAR CONVERSACIÓN
    // =========================

    let conversationResult = await db.query(
      `
        SELECT *
        FROM conversations
        WHERE whatsapp_number = $1
      `,
      [senderNumber],
    );

    let conversation = conversationResult.rows[0];

    if (!conversation) {
      const initials = senderName
        .split(" ")
        .map((word) => word[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

      const insertConversationResult = await db.query(
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
            RETURNING *
          `,
        [
          senderNumber,
          senderName,
          senderName,
          null,
          initials,
          messageText,
          timestamp,
          Date.now(),
        ],
      );

      conversation = insertConversationResult.rows[0];
    } else {
      const updatedConversationResult = await db.query(
        `
            UPDATE conversations
            SET
              whatsapp_name = $1,
              name = $1,
              last_message = $2,
              last_message_at = $3
            WHERE id = $4
            RETURNING *
          `,
        [senderName, messageText, timestamp, Number(conversation.id)],
      );

      conversation = updatedConversationResult.rows[0];
    }

    // =========================
    // GUARDAR MENSAJE
    // =========================

    await db.query(
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
          media_type
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9
        )
        ON CONFLICT (whatsapp_message_id)
        DO NOTHING
      `,
      [
        incomingMessage.id,
        Number(conversation.id),
        "received",
        incomingMessage.type,
        messageText,
        timestamp,
        "received",
        mediaId,
        mediaType,
      ],
    );

    io.emit("new-message", {
      conversationId: Number(conversation.id),
    });

    return res.sendStatus(200);
  } catch (error) {
    console.error("Error procesando webhook:", error);

    return res.sendStatus(500);
  }
});
// =========================
// OBTENER MULTIMEDIA
// =========================

app.get("/api/media/:mediaId", async (req, res) => {
  try {
    const { mediaId } = req.params;

    const token = process.env.WHATSAPP_TOKEN;
    const apiVersion = process.env.WHATSAPP_API_VERSION;

    const mediaInfo = await axios.get(
      `https://graph.facebook.com/${apiVersion}/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const mediaUrl = mediaInfo.data.url;

    const mediaResponse = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const contentType =
      mediaResponse.headers["content-type"] || "application/octet-stream";

    res.setHeader("Content-Type", contentType);

    return res.send(mediaResponse.data);
  } catch (error) {
    console.error(
      "Error obteniendo multimedia:",
      error.response?.data || error.message,
    );

    return res.sendStatus(500);
  }
});

// =========================
// ENVIAR IMAGEN
// =========================

app.post("/api/messages/image", upload.single("image"), async (req, res) => {
  try {
    const { conversationId, caption } = req.body;
    const imageFile = req.file;

    if (!conversationId) {
      return res.status(400).json({
        ok: false,
        message: "Falta conversationId",
      });
    }

    if (!imageFile) {
      return res.status(400).json({
        ok: false,
        message: "No se recibió ninguna imagen",
      });
    }

    const conversationResult = await db.query(
      `
          SELECT *
          FROM conversations
          WHERE id = $1
        `,
      [Number(conversationId)],
    );

    const conversation = conversationResult.rows[0];

    if (!conversation) {
      return res.status(404).json({
        ok: false,
        message: "Conversación no encontrada",
      });
    }

    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const apiVersion = process.env.WHATSAPP_API_VERSION;

    if (!token || !phoneNumberId || !apiVersion) {
      return res.status(500).json({
        ok: false,
        message: "Faltan credenciales de WhatsApp en el archivo .env",
      });
    }

    const recipient = conversation.whatsapp_number.replace(/\D/g, "");

    // 1. Subir imagen a Meta
    const formData = new FormData();

    formData.append(
      "file",
      new Blob([imageFile.buffer], {
        type: imageFile.mimetype,
      }),
      imageFile.originalname,
    );

    formData.append("messaging_product", "whatsapp");

    const uploadResponse = await axios.post(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const mediaId = uploadResponse.data.id;

    // 2. Enviar imagen por WhatsApp
    const imageData = {
      id: mediaId,
    };

    if (caption?.trim()) {
      imageData.caption = caption.trim();
    }

    const whatsappResponse = await axios.post(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "image",
        image: imageData,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    const whatsappMessageId = whatsappResponse.data.messages?.[0]?.id || null;

    const timestamp = Date.now();

    // 3. Guardar en PostgreSQL
    await db.query(
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
            media_type
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
      [
        whatsappMessageId,
        Number(conversation.id),
        "sent",
        "image",
        caption?.trim() || "",
        timestamp,
        "sent",
        mediaId,
        "image",
      ],
    );

    await db.query(
      `
          UPDATE conversations
          SET
            last_message = $1,
            last_message_at = $2
          WHERE id = $3
        `,
      [caption?.trim() || "[imagen]", timestamp, Number(conversation.id)],
    );

    io.emit("new-message", {
      conversationId: Number(conversation.id),
    });

    return res.status(201).json({
      ok: true,
      mediaId,
      whatsappMessageId,
    });
  } catch (error) {
    console.error("Error enviando imagen:", error.response?.data || error);

    return res.status(500).json({
      ok: false,
      message: "No se pudo enviar la imagen",
    });
  }
});

// =========================
// DESCARGAR MULTIMEDIA
// =========================

app.get("/api/media/:mediaId/download", async (req, res) => {
  try {
    const { mediaId } = req.params;

    const token = process.env.WHATSAPP_TOKEN;
    const apiVersion = process.env.WHATSAPP_API_VERSION;

    const mediaInfo = await axios.get(
      `https://graph.facebook.com/${apiVersion}/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const mediaUrl = mediaInfo.data.url;

    const mediaResponse = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const contentType =
      mediaResponse.headers["content-type"] || "application/octet-stream";

    let extension = "jpg";

    if (contentType.includes("png")) {
      extension = "png";
    } else if (contentType.includes("webp")) {
      extension = "webp";
    } else if (contentType.includes("jpeg")) {
      extension = "jpg";
    }

    res.setHeader("Content-Type", contentType);

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="imagen-whatsapp-${Date.now()}.${extension}"`,
    );

    return res.send(mediaResponse.data);
  } catch (error) {
    console.error(
      "Error descargando imagen:",
      error.response?.data || error.message,
    );

    return res.status(500).send("No se pudo descargar la imagen");
  }
});

// =========================
// INICIAR SERVIDOR
// =========================

async function startServer() {
  try {
    await initializeDatabase();

    server.listen(PORT, () => {
      console.log(`Servidor iniciado en http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("No se pudo iniciar el servidor:", error);

    process.exit(1);
  }
}

startServer();
