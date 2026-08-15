if (require("electron-squirrel-startup")) {
  return;
}
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("fs");
const { io } = require("socket.io-client");
const path = require("path");
require("dotenv").config();

let mainWindow;
let socket;

const BACKEND_URL = "https://office-crm-72fv.onrender.com";

let OFFICE_CLIENT_KEY = process.env.OFFICE_CLIENT_KEY;

if (!OFFICE_CLIENT_KEY) {
  try {
    const configPath = path.join(process.resourcesPath, "client-config.json");

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

    OFFICE_CLIENT_KEY = config.OFFICE_CLIENT_KEY;
  } catch (error) {
    console.error("No se pudo cargar OFFICE_CLIENT_KEY:", error);
  }
}

ipcMain.handle("office-api", async (event, options) => {
  console.log("IPC API recibido:", options);
  try {
    const { path: apiPath, method = "GET", body = null } = options;

    const response = await fetch(`${BACKEND_URL}${apiPath}`, {
      method,

      headers: {
        Authorization: `Bearer ${OFFICE_CLIENT_KEY}`,

        ...(body
          ? {
              "Content-Type": "application/json",
            }
          : {}),
      },

      body: body !== null ? JSON.stringify(body) : undefined,
    });
    console.log("Respuesta backend:", response.status, response.statusText);

    const contentType = response.headers.get("content-type") || "";

    let data;

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  } catch (error) {
    console.error("Error llamando a Office API:", error);

    return {
      ok: false,
      status: 500,
      data: {
        message: error.message,
      },
    };
  }
});
ipcMain.handle("office-media", async (event, mediaId) => {
  try {
    const response = await fetch(`${BACKEND_URL}/api/media/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${OFFICE_CLIENT_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Error descargando imagen: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";

    const arrayBuffer = await response.arrayBuffer();

    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return {
      ok: true,
      dataUrl: `data:${contentType};base64,${base64}`,
    };
  } catch (error) {
    console.error("Error obteniendo media:", error);

    return {
      ok: false,
      dataUrl: null,
    };
  }
});
ipcMain.handle("office-download-media", async (event, mediaId) => {
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/media/${mediaId}/download`,
      {
        headers: {
          Authorization: `Bearer ${OFFICE_CLIENT_KEY}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`No se pudo descargar el archivo: ${response.status}`);
    }

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";

    let extension = "jpg";

    if (contentType.includes("png")) {
      extension = "png";
    } else if (contentType.includes("webp")) {
      extension = "webp";
    } else if (contentType.includes("jpeg")) {
      extension = "jpg";
    }

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Guardar imagen",
      defaultPath: `imagen-whatsapp-${Date.now()}.${extension}`,
      filters: [
        {
          name: "Imagen",
          extensions: [extension],
        },
      ],
    });

    if (canceled || !filePath) {
      return {
        ok: false,
        canceled: true,
      };
    }

    const arrayBuffer = await response.arrayBuffer();

    const buffer = Buffer.from(arrayBuffer);

    fs.writeFileSync(filePath, buffer);

    return {
      ok: true,
      filePath,
    };
  } catch (error) {
    console.error("Error descargando archivo:", error);

    return {
      ok: false,
      canceled: false,
      message: error.message,
    };
  }
});

ipcMain.handle("office-send-image", async (event, data) => {
  try {
    const { conversationId, caption, fileName, mimeType, fileBuffer } = data;

    const formData = new FormData();

    const blob = new Blob([Buffer.from(fileBuffer)], {
      type: mimeType,
    });

    formData.append("image", blob, fileName);

    formData.append("conversationId", String(conversationId));

    if (caption?.trim()) {
      formData.append("caption", caption.trim());
    }

    const response = await fetch(`${BACKEND_URL}/api/messages/image`, {
      method: "POST",

      headers: {
        Authorization: `Bearer ${OFFICE_CLIENT_KEY}`,
      },

      body: formData,
    });

    const result = await response.json();

    return {
      ok: response.ok,
      status: response.status,
      data: result,
    };
  } catch (error) {
    console.error("Error enviando imagen desde Electron:", error);

    return {
      ok: false,
      status: 500,
      data: {
        message: "No se pudo enviar la imagen",
      },
    };
  }
});

ipcMain.handle("office-send-video", async (event, data) => {
  try {
    const { conversationId, caption, fileName, mimeType, fileBuffer } = data;

    const formData = new FormData();

    const blob = new Blob([Buffer.from(fileBuffer)], {
      type: mimeType,
    });

    formData.append("video", blob, fileName);

    formData.append("conversationId", String(conversationId));

    if (caption?.trim()) {
      formData.append("caption", caption.trim());
    }

    const response = await fetch(`${BACKEND_URL}/api/messages/video`, {
      method: "POST",

      headers: {
        Authorization: `Bearer ${OFFICE_CLIENT_KEY}`,
      },

      body: formData,
    });

    const result = await response.json();

    return {
      ok: response.ok,
      status: response.status,
      data: result,
    };
  } catch (error) {
    console.error("Error enviando video desde Electron:", error);

    return {
      ok: false,
      status: 500,
      data: {
        message: "No se pudo enviar el video",
      },
    };
  }
});

ipcMain.handle("office-send-audio", async (event, data) => {
  try {
    const { conversationId, fileName, mimeType, fileBuffer } = data;

    const formData = new FormData();

    const cleanMimeType = mimeType.split(";")[0];

    const blob = new Blob([Buffer.from(fileBuffer)], {
      type: cleanMimeType,
    });
    formData.append("audio", blob, fileName);

    formData.append("conversationId", String(conversationId));

    const response = await fetch(`${BACKEND_URL}/api/messages/audio`, {
      method: "POST",

      headers: {
        Authorization: `Bearer ${OFFICE_CLIENT_KEY}`,
      },

      body: formData,
    });

    const result = await response.json();

    return {
      ok: response.ok,
      status: response.status,
      data: result,
    };
  } catch (error) {
    console.error("Error enviando audio desde Electron:", error);

    return {
      ok: false,
      status: 500,
      data: {
        message: "No se pudo enviar el audio",
      },
    };
  }
});

function connectSocket() {
  socket = io(BACKEND_URL, {
    auth: {
      clientKey: OFFICE_CLIENT_KEY,
    },
  });

  socket.on("connect", () => {
    console.log("Socket.IO conectado a Render:", socket.id);
  });

  socket.on("connect_error", (error) => {
    console.error("Error Socket.IO:", error.message);
  });

  socket.on("new-message", (data) => {
    console.log("Nuevo mensaje recibido por Socket.IO:", data);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("new-message", data);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    icon: path.join(__dirname, "../assets/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "../public/index.html"));
}

app.whenReady().then(() => {
  createWindow();
  connectSocket();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
