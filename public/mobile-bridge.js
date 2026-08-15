const MOBILE_BACKEND_URL = "https://office-crm-72fv.onrender.com";

const MOBILE_CLIENT_KEY =
  "0a21a0f7aefae166d375f1cbba073839b68ee8c18ef3d9e8df59531dc31a0925dec69f657ff7f732d95fbdedb79c772d";

async function mobileApi({ path, method = "GET", body = null }) {
  try {
    const response = await fetch(`${MOBILE_BACKEND_URL}${path}`, {
      method,

      headers: {
        Authorization: `Bearer ${MOBILE_CLIENT_KEY}`,

        ...(body !== null
          ? {
              "Content-Type": "application/json",
            }
          : {}),
      },

      body: body !== null ? JSON.stringify(body) : undefined,
    });

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
    console.error("Error API Android:", error);

    return {
      ok: false,
      status: 500,
      data: {
        message: error.message,
      },
    };
  }
}

async function mobileSendMedia(endpoint, fieldName, data) {
  try {
    const formData = new FormData();

    const blob = new Blob([data.fileBuffer], {
      type: data.mimeType,
    });

    formData.append(fieldName, blob, data.fileName);

    formData.append("conversationId", String(data.conversationId));

    if (data.caption?.trim()) {
      formData.append("caption", data.caption.trim());
    }

    const response = await fetch(`${MOBILE_BACKEND_URL}${endpoint}`, {
      method: "POST",

      headers: {
        Authorization: `Bearer ${MOBILE_CLIENT_KEY}`,
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
    console.error("Error enviando multimedia:", error);

    return {
      ok: false,
      status: 500,
      data: {
        message: error.message,
      },
    };
  }
}

async function arrayBufferToDataUrl(arrayBuffer, contentType) {
  const bytes = new Uint8Array(arrayBuffer);

  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return `data:${contentType};base64,` + btoa(binary);
}

window.officeCRM = {
  // =========================
  // API NORMAL
  // =========================

  api: mobileApi,

  // =========================
  // OBTENER MEDIA
  // =========================

  media: async (mediaId) => {
    try {
      const response = await fetch(
        `${MOBILE_BACKEND_URL}/api/media/${mediaId}`,
        {
          headers: {
            Authorization: `Bearer ${MOBILE_CLIENT_KEY}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Error media: ${response.status}`);
      }

      const contentType =
        response.headers.get("content-type") || "application/octet-stream";

      const arrayBuffer = await response.arrayBuffer();

      const dataUrl = await arrayBufferToDataUrl(arrayBuffer, contentType);

      return {
        ok: true,
        dataUrl,
      };
    } catch (error) {
      console.error("Error obteniendo media:", error);

      return {
        ok: false,
        dataUrl: null,
      };
    }
  },

  // =========================
  // IMAGEN
  // =========================

  sendImage: (data) => mobileSendMedia("/api/messages/image", "image", data),

  // =========================
  // VIDEO
  // =========================

  sendVideo: (data) => mobileSendMedia("/api/messages/video", "video", data),

  // =========================
  // AUDIO
  // =========================

  sendAudio: (data) => mobileSendMedia("/api/messages/audio", "audio", data),

  // =========================
  // SOCKET
  // =========================

  onNewMessage: (callback) => {
    if (!window.__officeSocket) {
      window.__officeSocket = io(MOBILE_BACKEND_URL, {
        transports: ["websocket", "polling"],

        auth: {
          clientKey: MOBILE_CLIENT_KEY,
        },
      });

      window.__officeSocket.on("connect", () => {
        console.log("Socket Android conectado:", window.__officeSocket.id);
      });

      window.__officeSocket.on("connect_error", (error) => {
        console.error("Error Socket Android:", error);
      });
    }

    window.__officeSocket.on("new-message", callback);
  },
};
