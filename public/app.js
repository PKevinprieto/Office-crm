const conversationList = document.querySelector("#conversation-list");
const messagesContainer = document.querySelector("#messages");
const contactName = document.querySelector("#contact-name");
const contactNumber = document.querySelector("#contact-number");
const messageForm = document.querySelector("#message-form");
const messageActionButton = document.getElementById("messageActionButton");

const messageActionContent = document.getElementById("messageActionContent");

const audioRecordingStatus = document.getElementById("audioRecordingStatus");

const audioRecordingTime = document.getElementById("audioRecordingTime");
let audioRecorder = null;
let audioStream = null;
let audioChunks = [];

let isRecordingAudio = false;

let recordingStartedAt = null;
let recordingTimer = null;
function updateMessageActionButton() {
  const hasText = messageInput.value.trim().length > 0;

  if (isRecordingAudio) {
    messageActionContent.textContent = "Enviar";

    messageActionButton.classList.remove("is-microphone");

    messageActionButton.title = "Enviar audio";

    return;
  }

  if (hasText) {
    messageActionContent.textContent = "Enviar";

    messageActionButton.classList.remove("is-microphone");

    messageActionButton.title = "Enviar mensaje";
  } else {
    messageActionContent.textContent = "🎤";

    messageActionButton.classList.add("is-microphone");

    messageActionButton.title = "Grabar audio";
  }
}

async function startAudioRecording() {
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    let mimeType = "";

    const preferredTypes = [
      "audio/ogg;codecs=opus",
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/webm",
    ];

    for (const type of preferredTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }

    audioChunks = [];

    audioRecorder = mimeType
      ? new MediaRecorder(audioStream, {
          mimeType,
        })
      : new MediaRecorder(audioStream);

    audioRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    });

    audioRecorder.addEventListener("stop", sendRecordedAudio);

    audioRecorder.start();

    isRecordingAudio = true;

    recordingStartedAt = Date.now();

    messageInput.hidden = true;
    audioRecordingStatus.hidden = false;

    updateRecordingTime();

    recordingTimer = setInterval(updateRecordingTime, 500);

    updateMessageActionButton();
  } catch (error) {
    console.error("No se pudo acceder al micrófono:", error);

    alert("Office CRM no pudo acceder al micrófono.");
  }
}

function updateRecordingTime() {
  if (!recordingStartedAt) {
    return;
  }

  const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);

  const minutes = Math.floor(seconds / 60);

  const remainingSeconds = seconds % 60;

  audioRecordingTime.textContent = `${minutes}:${String(
    remainingSeconds,
  ).padStart(2, "0")}`;
}
function stopAudioRecording() {
  if (!audioRecorder || audioRecorder.state === "inactive") {
    return;
  }

  isRecordingAudio = false;

  clearInterval(recordingTimer);

  recordingTimer = null;

  audioRecorder.stop();

  audioStream?.getTracks().forEach((track) => track.stop());

  audioStream = null;

  messageInput.hidden = false;
  audioRecordingStatus.hidden = true;

  updateMessageActionButton();
}

async function sendRecordedAudio() {
  const conversationId = Number(activeConversationId);

  if (!audioChunks.length || !conversationId) {
    return;
  }

  const mimeType = audioRecorder?.mimeType || "audio/mp4";

  const audioBlob = new Blob(audioChunks, {
    type: mimeType,
  });

  const previewUrl = URL.createObjectURL(audioBlob);

  const tempId = `temp-audio-${Date.now()}-${Math.random()}`;

  const now = Date.now();

  // =========================
  // MOSTRAR AUDIO INMEDIATAMENTE
  // =========================

  appendOptimisticAudio({
    id: tempId,
    type: "sent",
    previewUrl,
    time: new Date(now).toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  });

  try {
    const arrayBuffer = await audioBlob.arrayBuffer();

    const response = await window.officeCRM.sendAudio({
      conversationId,

      fileName: `audio-${Date.now()}.mp4`,

      mimeType,

      fileBuffer: arrayBuffer,
    });

    if (!response.ok) {
      throw new Error(response.data?.message || "No se pudo enviar el audio");
    }

    // Cambia ◷ por ✓
    updateOptimisticMessageStatus(tempId, "sent");

    await loadConversations();

    updateConversationInBackground(conversationId);

    setTimeout(() => {
      URL.revokeObjectURL(previewUrl);
    }, 60000);
  } catch (error) {
    console.error("Error enviando audio:", error);

    updateOptimisticMessageStatus(tempId, "failed");
  } finally {
    audioChunks = [];
    audioRecorder = null;
    recordingStartedAt = null;

    messageInput.focus();
  }
}

function appendOptimisticAudio(message) {
  const messageElement = document.createElement("article");

  messageElement.className = `message ${message.type}`;

  messageElement.dataset.tempId = message.id;

  messageElement.innerHTML = `
    <div class="whatsapp-audio">

      <button
        class="audio-play"
        type="button"
      >
        ▶
      </button>

      <div class="audio-center">

        <input
          class="audio-progress"
          type="range"
          min="0"
          max="100"
          value="0"
          step="0.1"
        >

        <span class="audio-duration">
          0:00
        </span>

      </div>

      <button
        class="audio-speed"
        type="button"
      >
        1x
      </button>

      <audio
        src="${message.previewUrl}"
        preload="metadata"
      ></audio>

    </div>

    <div class="message-meta">

      <span class="message-time">
        ${message.time}
      </span>

      <span class="message-send-status">
        ◷
      </span>

    </div>
  `;

  messagesContainer.appendChild(messageElement);

  initializeOptimisticAudioPlayer(messageElement);

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function initializeOptimisticAudioPlayer(messageElement) {
  const audio = messageElement.querySelector("audio");

  const playButton = messageElement.querySelector(".audio-play");

  const progress = messageElement.querySelector(".audio-progress");

  const durationElement = messageElement.querySelector(".audio-duration");

  const speedButton = messageElement.querySelector(".audio-speed");

  function formatAudioTime(seconds) {
    if (!Number.isFinite(seconds)) {
      return "0:00";
    }

    const minutes = Math.floor(seconds / 60);

    const secs = Math.floor(seconds % 60);

    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  audio.addEventListener("loadedmetadata", () => {
    durationElement.textContent = formatAudioTime(audio.duration);
  });

  playButton.addEventListener("click", async () => {
    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  });

  audio.addEventListener("play", () => {
    playButton.textContent = "❚❚";
  });

  audio.addEventListener("pause", () => {
    playButton.textContent = "▶";
  });

  audio.addEventListener("timeupdate", () => {
    if (!audio.duration) {
      return;
    }

    progress.value = (audio.currentTime / audio.duration) * 100;

    durationElement.textContent = formatAudioTime(audio.currentTime);
  });

  progress.addEventListener("input", () => {
    if (!audio.duration) {
      return;
    }

    audio.currentTime = (Number(progress.value) / 100) * audio.duration;
  });

  const speeds = [1, 1.5, 2];
  let speedIndex = 0;

  speedButton.addEventListener("click", () => {
    speedIndex = (speedIndex + 1) % speeds.length;

    const speed = speeds[speedIndex];

    audio.playbackRate = speed;

    speedButton.textContent = `${speed}x`;
  });
}

const screenshotEditor = document.getElementById("screenshotEditor");

const screenshotCanvas = document.getElementById("screenshotCanvas");

const closeScreenshotEditor = document.getElementById("closeScreenshotEditor");

const cancelScreenshot = document.getElementById("cancelScreenshot");

const sendScreenshot = document.getElementById("sendScreenshot");

const clearScreenshotDrawing = document.getElementById(
  "clearScreenshotDrawing",
);
const screenshotCtx = screenshotCanvas.getContext("2d");

let screenshotOriginalImage = null;
let screenshotConversationId = null;
let screenshotCaption = "";

let isDrawingScreenshot = false;
const emojiButton = document.getElementById("emojiButton");

const emojiPicker = document.getElementById("emojiPicker");

const emojiGrid = document.getElementById("emojiGrid");
const messageInput = document.querySelector("#message-input");
messageInput.addEventListener("input", () => {
  updateMessageActionButton();
  messageInput.style.height = "44px";

  const newHeight = Math.min(messageInput.scrollHeight, 140);

  messageInput.style.height = `${newHeight}px`;
  updateMessageActionButton();
});
const searchInput = document.querySelector("#search");
const themeToggle = document.getElementById("themeToggle");
const emptyChat = document.querySelector("#empty-chat");
const activeChat = document.querySelector("#active-chat");

const imageInput = document.querySelector("#imageInput");
imageInput.addEventListener("change", async () => {
  const file = imageInput.files[0];

  if (!file || !activeConversationId) {
    return;
  }

  const conversationId = Number(activeConversationId);
  const caption = messageInput.value.trim();

  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");

  if (!isImage && !isVideo) {
    alert("El archivo seleccionado no es compatible");
    imageInput.value = "";
    return;
  }

  // =========================
  // PREVIEW INMEDIATO
  // =========================

  const tempId = `temp-media-${Date.now()}-${Math.random()}`;

  const previewUrl = URL.createObjectURL(file);

  const now = Date.now();

  const optimisticMedia = {
    id: tempId,
    type: "sent",
    mediaType: isImage ? "image" : "video",
    previewUrl,
    text: caption,
    time: new Date(now).toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };

  // Mostrar INMEDIATAMENTE
  appendOptimisticMedia(optimisticMedia);

  // Limpiamos el input inmediatamente
  messageInput.value = "";
  messageInput.style.height = "44px";
  imageInput.value = "";

  try {
    // =========================
    // ENVÍO REAL EN SEGUNDO PLANO
    // =========================

    const arrayBuffer = await file.arrayBuffer();

    let response;

    if (isImage) {
      response = await window.officeCRM.sendImage({
        conversationId,
        caption,
        fileName: file.name,
        mimeType: file.type,
        fileBuffer: arrayBuffer,
      });
    }

    if (isVideo) {
      response = await window.officeCRM.sendVideo({
        conversationId,
        caption,
        fileName: file.name,
        mimeType: file.type,
        fileBuffer: arrayBuffer,
      });
    }

    if (!response.ok) {
      throw new Error(response.data?.message || "No se pudo enviar el archivo");
    }

    // ✓ enviado
    updateOptimisticMessageStatus(tempId, "sent");

    // Actualizamos solamente la lista izquierda
    await loadConversations();

    // Actualizamos caché sin tocar visualmente el chat
    updateConversationInBackground(conversationId);

    // Liberamos la URL temporal más adelante
    setTimeout(() => {
      URL.revokeObjectURL(previewUrl);
    }, 60000);
  } catch (error) {
    console.error(error);

    // Dejamos el archivo visible pero marcado con error
    updateOptimisticMessageStatus(tempId, "failed");
  }
});
// =========================
// PEGAR CAPTURA
// =========================

document.addEventListener("paste", (event) => {
  if (!activeConversationId) {
    return;
  }

  const items = event.clipboardData?.items;

  if (!items) {
    return;
  }

  const imageItem = Array.from(items).find((item) =>
    item.type.startsWith("image/"),
  );

  // Si es texto, Ctrl + V sigue funcionando normalmente
  if (!imageItem) {
    return;
  }

  event.preventDefault();

  const file = imageItem.getAsFile();

  if (!file) {
    return;
  }

  openScreenshotEditor(file);
});

function openScreenshotEditor(file) {
  const image = new Image();

  const imageUrl = URL.createObjectURL(file);

  image.onload = () => {
    screenshotOriginalImage = image;

    screenshotConversationId = Number(activeConversationId);

    screenshotCaption = messageInput.value.trim();

    screenshotCanvas.width = image.naturalWidth;

    screenshotCanvas.height = image.naturalHeight;

    screenshotCtx.clearRect(
      0,
      0,
      screenshotCanvas.width,
      screenshotCanvas.height,
    );

    screenshotCtx.drawImage(image, 0, 0);

    screenshotEditor.classList.add("active");

    URL.revokeObjectURL(imageUrl);
  };

  image.src = imageUrl;
}

screenshotCanvas.addEventListener("mousedown", (event) => {
  isDrawingScreenshot = true;

  const point = getScreenshotCanvasPoint(event);

  screenshotCtx.beginPath();

  screenshotCtx.moveTo(point.x, point.y);
});

screenshotCanvas.addEventListener("mousemove", (event) => {
  if (!isDrawingScreenshot) {
    return;
  }

  const point = getScreenshotCanvasPoint(event);

  screenshotCtx.lineTo(point.x, point.y);

  screenshotCtx.strokeStyle = "#ff0000";
  screenshotCtx.lineWidth = 5;
  screenshotCtx.lineCap = "round";
  screenshotCtx.lineJoin = "round";

  screenshotCtx.stroke();
});

document.addEventListener("mouseup", () => {
  isDrawingScreenshot = false;
});

function getScreenshotCanvasPoint(event) {
  const rect = screenshotCanvas.getBoundingClientRect();

  const scaleX = screenshotCanvas.width / rect.width;

  const scaleY = screenshotCanvas.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,

    y: (event.clientY - rect.top) * scaleY,
  };
}

clearScreenshotDrawing.addEventListener("click", () => {
  if (!screenshotOriginalImage) {
    return;
  }

  screenshotCtx.clearRect(
    0,
    0,
    screenshotCanvas.width,
    screenshotCanvas.height,
  );

  screenshotCtx.drawImage(screenshotOriginalImage, 0, 0);
});

function closeScreenshotEditorWindow() {
  screenshotEditor.classList.remove("active");

  screenshotOriginalImage = null;
  screenshotConversationId = null;
  screenshotCaption = "";
}

closeScreenshotEditor.addEventListener("click", closeScreenshotEditorWindow);

cancelScreenshot.addEventListener("click", closeScreenshotEditorWindow);

sendScreenshot.addEventListener("click", async () => {
  if (!screenshotConversationId) {
    return;
  }

  // Convertimos el canvas ya editado a PNG
  screenshotCanvas.toBlob(
    async (blob) => {
      if (!blob) {
        return;
      }

      const conversationId = screenshotConversationId;

      const caption = screenshotCaption;

      const file = new File([blob], `captura-${Date.now()}.png`, {
        type: "image/png",
      });

      // Cerramos editor inmediatamente
      closeScreenshotEditorWindow();

      // Limpiamos textarea
      messageInput.value = "";
      messageInput.style.height = "44px";

      // Preview instantáneo
      const previewUrl = URL.createObjectURL(file);

      const tempId = `temp-screenshot-${Date.now()}-${Math.random()}`;

      appendOptimisticMedia({
        id: tempId,
        type: "sent",
        mediaType: "image",
        previewUrl,
        text: caption,

        time: new Date().toLocaleTimeString("es-AR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });

      try {
        const arrayBuffer = await file.arrayBuffer();

        const response = await window.officeCRM.sendImage({
          conversationId,
          caption,
          fileName: file.name,
          mimeType: file.type,
          fileBuffer: arrayBuffer,
        });

        if (!response.ok) {
          throw new Error(
            response.data?.message || "No se pudo enviar la captura",
          );
        }

        updateOptimisticMessageStatus(tempId, "sent");

        await loadConversations();

        updateConversationInBackground(conversationId);

        setTimeout(() => {
          URL.revokeObjectURL(previewUrl);
        }, 60000);
      } catch (error) {
        console.error("Error enviando captura:", error);

        updateOptimisticMessageStatus(tempId, "failed");
      }
    },

    "image/png",
  );
});

function appendOptimisticMedia(message) {
  const messageElement = document.createElement("article");

  messageElement.className = `message ${message.type}`;

  messageElement.dataset.tempId = message.id;

  // =========================
  // IMAGEN
  // =========================

  if (message.mediaType === "image") {
    messageElement.innerHTML = `
      <div class="message-image-container">

        <img
          class="message-image"
          src="${message.previewUrl}"
          alt="Imagen enviando"
        >

      </div>

      ${message.text ? `<p class="message-text">${message.text}</p>` : ""}

      <div class="message-meta">

        <span class="message-time">
          ${message.time}
        </span>

        <span class="message-send-status">
          ◷
        </span>

      </div>
    `;
  }

  // =========================
  // VIDEO
  // =========================

  if (message.mediaType === "video") {
    messageElement.innerHTML = `
      <video
        class="message-video"
        src="${message.previewUrl}"
        controls
        preload="metadata"
      ></video>

      ${message.text ? `<p class="message-text">${message.text}</p>` : ""}

      <div class="message-meta">

        <span class="message-time">
          ${message.time}
        </span>

        <span class="message-send-status">
          ◷
        </span>

      </div>
    `;
  }

  messagesContainer.appendChild(messageElement);

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

const attachImageButton = document.querySelector("#attachImageButton");
attachImageButton.addEventListener("click", () => {
  imageInput.click();
});
const editContactButton = document.querySelector("#edit-contact-button");
editContactButton.addEventListener("click", () => {
  if (!activeConversationId) {
    return;
  }

  contactNameInput.value = contactName.textContent.trim();

  contactModal.classList.add("active");

  contactNameInput.focus();
});
const contactModal = document.querySelector("#contactModal");
contactModal.addEventListener("click", (event) => {
  if (event.target === contactModal) {
    contactModal.classList.remove("active");
  }
});
const contactNameInput = document.querySelector("#contactNameInput");

const cancelContactEdit = document.querySelector("#cancelContactEdit");
cancelContactEdit.addEventListener("click", () => {
  contactModal.classList.remove("active");
});

// Cerrar tocando afuera del modal
contactModal.addEventListener("click", (event) => {
  if (event.target === contactModal) {
    contactModal.classList.remove("active");
  }
});

// Cerrar presionando Escape
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && contactModal.classList.contains("active")) {
    contactModal.classList.remove("active");
  }
});
const saveContactEdit = document.querySelector("#saveContactEdit");
async function saveContact() {
  const name = contactNameInput.value.trim();

  if (!name || !activeConversationId) {
    return;
  }

  try {
    const response = await window.officeCRM.api({
      path: `/api/conversations/${activeConversationId}/contact`,
      method: "PATCH",
      body: {
        name,
      },
    });

    if (!response.ok) {
      throw new Error(
        response.data?.message || "No se pudo guardar el contacto",
      );
    }

    const result = response.data;

    contactModal.classList.remove("active");

    await loadConversations();
    await loadActiveConversation();
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}
// Guardar haciendo click
saveContactEdit.addEventListener("click", saveContact);

// Guardar presionando Enter
contactNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveContact();
  }
});
const notificationSound = new Audio("./sounds/notification.mp3");
notificationSound.volume = 0.5;
// const keypressSound = new Audio("./sounds/keypress.mp3");
// keypressSound.volume = 0.1;
// const keypressSoundSrc = "./sounds/keypress.mp3";

// document.addEventListener("keydown", (event) => {
//   const silentKeys = ["Shift", "Control", "Alt", "Meta", "CapsLock"];

//   if (silentKeys.includes(event.key)) {
//     return;
//   }

//   const sound = new Audio(keypressSoundSrc);
//   sound.volume = 0.15;

//   sound.play().catch(() => {});
// });
let conversations = [];
let activeConversationId = null;
const conversationCache = new Map();
const mediaCache = new Map();
const unreadChats = new Set();

const imageViewer = document.getElementById("imageViewer");
const imageViewerImg = document.getElementById("imageViewerImg");
const closeImageViewer = document.getElementById("closeImageViewer");

document.addEventListener("DOMContentLoaded", () => {
  const imageViewer = document.getElementById("imageViewer");
  const imageViewerImg = document.getElementById("imageViewerImg");
  const closeImageViewer = document.getElementById("closeImageViewer");

  if (!imageViewer || !imageViewerImg || !closeImageViewer) {
    console.warn("El visor de imágenes no está presente en el HTML.");
    return;
  }

  document.addEventListener("click", (event) => {
    if (event.target.classList.contains("message-image")) {
      imageViewerImg.src = event.target.src;
      imageViewer.classList.add("active");
    }
  });

  closeImageViewer.addEventListener("click", () => {
    imageViewer.classList.remove("active");
    imageViewerImg.src = "";
  });

  imageViewer.addEventListener("click", (event) => {
    if (event.target === imageViewer) {
      imageViewer.classList.remove("active");
      imageViewerImg.src = "";
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && imageViewer.classList.contains("active")) {
      imageViewer.classList.remove("active");
      imageViewerImg.src = "";
    }
  });
});
function showEmptyChat() {
  emptyChat.style.display = "flex";
  activeChat.style.display = "none";
}

function showActiveChat() {
  emptyChat.style.display = "none";
  activeChat.style.display = "flex";
}
async function loadConversations() {
  try {
    const response = await window.officeCRM.api({
      path: "/api/conversations",
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(
        response.data?.message || "No se pudieron cargar las conversaciones",
      );
    }

    conversations = response.data;

    renderConversations();

    // Si hay un chat seleccionado, lo mostramos.
    if (activeConversationId) {
      showActiveChat();
    } else {
      // Si no hay ninguno seleccionado, mostramos Office.
      showEmptyChat();
    }
  } catch (error) {
    console.error(error);

    conversationList.innerHTML = `
      <p class="error-message">
        No se pudieron cargar las conversaciones.
      </p>
    `;
  }
}

function renderConversations(list = conversations) {
  conversationList.innerHTML = "";

  if (list.length === 0) {
    conversationList.innerHTML = `
      <p class="empty-message">
        No se encontraron conversaciones.
      </p>
    `;

    return;
  }

  list.forEach((conversation) => {
    const article = document.createElement("article");

    article.className = "conversation";
    article.dataset.id = conversation.id;

    if (conversation.id === activeConversationId) {
      article.classList.add("active");
    }

    article.innerHTML = `
      <div class="avatar">
        ${conversation.initials}
      </div>

      <div class="conversation-content">
        <div class="conversation-top">
  <strong>${conversation.name}</strong>

  <span class="conversation-time">
    ${conversation.time}
  </span>
</div>

<div class="conversation-bottom">

  <p class="conversation-message">
    ${conversation.lastMessage}
  </p>

  ${
    unreadChats.has(Number(conversation.id))
      ? `<span class="unread-dot"></span>`
      : ""
  }

</div>
    `;

    article.addEventListener("click", async () => {
      activeConversationId = conversation.id;

      // Ya abrimos el chat: deja de estar "no leído"
      unreadChats.delete(Number(conversation.id));

      showActiveChat();

      renderConversations();
      await loadActiveConversation();
      messageInput.focus();
    });

    conversationList.appendChild(article);
  });
}

async function loadActiveConversation() {
  if (!activeConversationId) {
    return;
  }

  const conversationId = Number(activeConversationId);

  // Si ya cargamos este chat antes,
  // lo mostramos inmediatamente desde memoria.
  if (conversationCache.has(conversationId)) {
    const cachedConversation = conversationCache.get(conversationId);

    await renderActiveConversation(cachedConversation);

    // Actualizamos los datos silenciosamente,
    // PERO NO volvemos a dibujar el chat.
    updateConversationInBackground(conversationId);

    return;
  }

  // Primera vez que abrimos este chat:
  // ahí sí lo cargamos normalmente.
  try {
    const response = await window.officeCRM.api({
      path: `/api/conversations/${conversationId}/messages`,
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(
        response.data?.message || "No se pudieron cargar los mensajes",
      );
    }

    const conversation = response.data;

    conversationCache.set(conversationId, conversation);

    // Solo dibujamos si seguimos en ese mismo chat.
    if (Number(activeConversationId) !== conversationId) {
      return;
    }

    await renderActiveConversation(conversation);
  } catch (error) {
    console.error(error);

    messagesContainer.innerHTML = `
      <p class="error-message">
        No se pudieron cargar los mensajes.
      </p>
    `;
  }
}

async function updateConversationInBackground(conversationId) {
  try {
    const response = await window.officeCRM.api({
      path: `/api/conversations/${conversationId}/messages`,
      method: "GET",
    });

    if (!response.ok) {
      return;
    }

    // Actualizamos solamente la memoria.
    // NO tocamos el HTML del chat.
    conversationCache.set(conversationId, response.data);
  } catch (error) {
    console.error("Error actualizando conversación en segundo plano:", error);
  }
}

async function renderActiveConversation(conversation) {
  contactName.textContent = conversation.name;
  contactNumber.textContent = conversation.number;

  messagesContainer.innerHTML = "";

  for (const message of conversation.messages) {
    const messageElement = document.createElement("article");

    messageElement.className = `message ${message.type}`;

    if (message.mediaType === "image" && message.mediaId) {
      const cachedImage = mediaCache.get(message.mediaId);

      messageElement.innerHTML = `
        <div class="message-image-container">

          ${
            cachedImage
              ? `
                <img
                  class="message-image"
                  src="${cachedImage}"
                  alt="Imagen recibida"
                >
              `
              : `
                <div
                  class="image-loading"
                  data-media-id="${message.mediaId}"
                >
                  Cargando imagen...
                </div>
              `
          }

          <button
            class="download-image-button"
            data-media-id="${message.mediaId}"
            type="button"
            title="Descargar imagen"
          >
            ↓
          </button>

        </div>

        ${message.text ? `<p class="message-text">${message.text}</p>` : ""}

        ${
          message.reaction
            ? `<span class="message-reaction">${message.reaction}</span>`
            : ""
        }

      <div class="message-meta">
  <span class="message-time">
    ${message.time}
  </span>

  ${message.type === "sent" ? `<span class="message-send-status">✓</span>` : ""}
</div>
      `;

      messagesContainer.appendChild(messageElement);

      // La imagen se carga DESPUÉS,
      // sin frenar el resto del chat.
      if (!cachedImage) {
        loadMessageImage(message.mediaId, messageElement);
      }
    } else if (message.mediaType === "audio" && message.mediaId) {
      messageElement.innerHTML = `
    <div
      class="audio-loading"
      data-media-id="${message.mediaId}"
    >
      Cargando audio...
    </div>

    ${
      message.reaction
        ? `<span class="message-reaction">${message.reaction}</span>`
        : ""
    }

    <div class="message-meta">
      <span class="message-time">
        ${message.time}
      </span>

      ${
        message.type === "sent"
          ? `<span class="message-send-status">✓</span>`
          : ""
      }
    </div>
  `;

      messagesContainer.appendChild(messageElement);

      loadMessageAudio(message.mediaId, messageElement);
    } else if (message.mediaType === "video" && message.mediaId) {
      messageElement.innerHTML = `
    <div
      class="video-loading"
      data-media-id="${message.mediaId}"
    >
      Cargando video...
    </div>

    ${message.text ? `<p class="message-text">${message.text}</p>` : ""}

    ${
      message.reaction
        ? `<span class="message-reaction">${message.reaction}</span>`
        : ""
    }

    <div class="message-meta">
      <span class="message-time">
        ${message.time}
      </span>

      ${
        message.type === "sent"
          ? `<span class="message-send-status">✓</span>`
          : ""
      }
    </div>
  `;

      messagesContainer.appendChild(messageElement);

      loadMessageVideo(message.mediaId, messageElement);
    } else {
      messageElement.innerHTML = `
        <p class="message-text">${message.text}</p>

        ${
          message.reaction
            ? `<span class="message-reaction">${message.reaction}</span>`
            : ""
        }

        <div class="message-meta">
  <span class="message-time">
    ${message.time}
  </span>

  ${message.type === "sent" ? `<span class="message-send-status">✓</span>` : ""}
</div>
      `;

      messagesContainer.appendChild(messageElement);
    }
  }

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function loadMessageImage(mediaId, messageElement) {
  try {
    const mediaResponse = await window.officeCRM.media(mediaId);

    if (!mediaResponse.ok) {
      throw new Error("No se pudo cargar la imagen");
    }

    const imageSrc = mediaResponse.dataUrl;

    mediaCache.set(mediaId, imageSrc);

    const loadingElement = messageElement.querySelector(
      `.image-loading[data-media-id="${mediaId}"]`,
    );

    if (!loadingElement) {
      return;
    }

    const img = document.createElement("img");

    img.className = "message-image";
    img.src = imageSrc;
    img.alt = "Imagen recibida";

    loadingElement.replaceWith(img);
  } catch (error) {
    console.error("Error cargando imagen:", error);

    const loadingElement = messageElement.querySelector(
      `.image-loading[data-media-id="${mediaId}"]`,
    );

    if (loadingElement) {
      loadingElement.textContent = "No se pudo cargar la imagen";
    }
  }
}

async function loadMessageAudio(mediaId, messageElement) {
  try {
    const mediaResponse = await window.officeCRM.media(mediaId);

    if (!mediaResponse.ok) {
      throw new Error("No se pudo cargar el audio");
    }

    const loadingElement = messageElement.querySelector(
      `.audio-loading[data-media-id="${mediaId}"]`,
    );

    if (!loadingElement) return;

    const player = document.createElement("div");
    player.className = "whatsapp-audio";

    player.innerHTML = `
      <button class="audio-play" type="button">
        ▶
      </button>

      <div class="audio-center">
        <input
          class="audio-progress"
          type="range"
          min="0"
          max="100"
          value="0"
          step="0.1"
        >

        <span class="audio-duration">0:00</span>
      </div>

      <button class="audio-speed" type="button">
        1x
      </button>

      <audio preload="metadata"></audio>
    `;

    loadingElement.replaceWith(player);

    const audio = player.querySelector("audio");
    const playButton = player.querySelector(".audio-play");
    const progress = player.querySelector(".audio-progress");
    const durationElement = player.querySelector(".audio-duration");
    const speedButton = player.querySelector(".audio-speed");

    audio.src = mediaResponse.dataUrl;

    function formatAudioTime(seconds) {
      if (!Number.isFinite(seconds)) return "0:00";

      const minutes = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);

      return `${minutes}:${String(secs).padStart(2, "0")}`;
    }

    audio.addEventListener("loadedmetadata", () => {
      durationElement.textContent = formatAudioTime(audio.duration);
    });

    playButton.addEventListener("click", async () => {
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
    });

    audio.addEventListener("play", () => {
      playButton.textContent = "❚❚";
    });

    audio.addEventListener("pause", () => {
      playButton.textContent = "▶";
    });

    audio.addEventListener("ended", () => {
      playButton.textContent = "▶";
      progress.value = 0;
    });

    audio.addEventListener("timeupdate", () => {
      if (!audio.duration) return;

      progress.value = (audio.currentTime / audio.duration) * 100;

      durationElement.textContent = formatAudioTime(audio.currentTime);
    });

    progress.addEventListener("input", () => {
      if (!audio.duration) return;

      audio.currentTime = (Number(progress.value) / 100) * audio.duration;
    });

    const speeds = [1, 1.5, 2];
    let speedIndex = 0;

    speedButton.addEventListener("click", () => {
      speedIndex = (speedIndex + 1) % speeds.length;

      const speed = speeds[speedIndex];

      audio.playbackRate = speed;
      speedButton.textContent = `${speed}x`;
    });
  } catch (error) {
    console.error("Error cargando audio:", error);

    const loadingElement = messageElement.querySelector(
      `.audio-loading[data-media-id="${mediaId}"]`,
    );

    if (loadingElement) {
      loadingElement.textContent = "No se pudo cargar el audio";
    }
  }
}

async function loadMessageVideo(mediaId, messageElement) {
  try {
    const mediaResponse = await window.officeCRM.media(mediaId);

    if (!mediaResponse.ok) {
      throw new Error("No se pudo cargar el video");
    }

    const loadingElement = messageElement.querySelector(
      `.video-loading[data-media-id="${mediaId}"]`,
    );

    if (!loadingElement) {
      return;
    }

    const video = document.createElement("video");

    video.className = "message-video";
    video.src = mediaResponse.dataUrl;
    video.controls = true;
    video.preload = "metadata";

    loadingElement.replaceWith(video);
  } catch (error) {
    console.error("Error cargando video:", error);

    const loadingElement = messageElement.querySelector(
      `.video-loading[data-media-id="${mediaId}"]`,
    );

    if (loadingElement) {
      loadingElement.textContent = "No se pudo cargar el video";
    }
  }
}

document.addEventListener("click", async (event) => {
  const downloadButton = event.target.closest(".download-image-button");

  if (!downloadButton) {
    return;
  }

  event.stopPropagation();

  const mediaId = downloadButton.dataset.mediaId;

  if (!mediaId) {
    return;
  }

  const result = await window.officeCRM.downloadMedia(mediaId);

  if (!result.ok && !result.canceled) {
    alert(result.message || "No se pudo descargar la imagen");
  }
});
messageInput.addEventListener("keydown", (event) => {
  // Ctrl + Enter = salto de línea
  if (event.key === "Enter" && event.ctrlKey) {
    event.preventDefault();

    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;

    const text = messageInput.value;

    messageInput.value = text.substring(0, start) + "\n" + text.substring(end);

    // Dejar el cursor después del salto
    messageInput.selectionStart = messageInput.selectionEnd = start + 1;

    return;
  }

  // Enter solo = enviar mensaje
  if (event.key === "Enter") {
    event.preventDefault();

    // Disparamos el submit del formulario
    messageForm.requestSubmit();
  }
});
messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isRecordingAudio) {
    stopAudioRecording();
    return;
  }

  const text = messageInput.value.trim();

  // Si no hay texto,
  // el botón funciona como micrófono.
  if (!text) {
    await startAudioRecording();
    return;
  }

  if (!activeConversationId) {
    return;
  }

  const conversationId = Number(activeConversationId);

  // Limpiamos el input INMEDIATAMENTE
  messageInput.value = "";
  messageInput.focus();

  // =========================
  // MENSAJE OPTIMISTA
  // =========================

  const tempId = `temp-${Date.now()}-${Math.random()}`;

  const now = Date.now();

  const optimisticMessage = {
    id: tempId,
    type: "sent",
    text,
    timestamp: now,
    time: new Date(now).toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    status: "sending",
    mediaId: null,
    mediaType: null,
    reaction: null,
  };

  // Mostrarlo AHORA
  appendOptimisticMessage(optimisticMessage);

  // Actualizar cache local
  const cachedConversation = conversationCache.get(conversationId);

  if (cachedConversation) {
    cachedConversation.messages.push(optimisticMessage);

    cachedConversation.lastMessage = text;
  }

  try {
    // =========================
    // ENVÍO REAL EN SEGUNDO PLANO
    // =========================

    const response = await window.officeCRM.api({
      path: "/api/messages",
      method: "POST",

      body: {
        conversationId,
        text,
      },
    });

    if (!response.ok) {
      throw new Error(response.data?.message || "No se pudo enviar el mensaje");
    }

    // Marcamos visualmente como enviado
    updateOptimisticMessageStatus(tempId, "sent");

    // Actualizamos solo la lista izquierda
    await loadConversations();

    // Actualizamos caché silenciosamente
    updateConversationInBackground(conversationId);
  } catch (error) {
    console.error(error);

    // No borramos el mensaje:
    // mostramos que falló.
    updateOptimisticMessageStatus(tempId, "failed");
  }
});

function appendOptimisticMessage(message) {
  const messageElement = document.createElement("article");

  messageElement.className = `message ${message.type}`;

  messageElement.dataset.tempId = message.id;

  messageElement.innerHTML = `
    <p class="message-text">${message.text}</p>

    <div class="message-meta">
  <span class="message-time">
    ${message.time}
  </span>

  <span class="message-send-status">
    ◷
  </span>
</div>
  `;

  messagesContainer.appendChild(messageElement);

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateOptimisticMessageStatus(tempId, status) {
  const messageElement = messagesContainer.querySelector(
    `[data-temp-id="${tempId}"]`,
  );

  if (!messageElement) {
    return;
  }

  const statusElement = messageElement.querySelector(".message-send-status");

  if (!statusElement) {
    return;
  }

  if (status === "sent") {
    statusElement.textContent = "✓";
    statusElement.title = "Enviado";
  }

  if (status === "failed") {
    statusElement.textContent = "⚠";

    statusElement.title = "No se pudo enviar el mensaje";

    messageElement.classList.add("message-failed");
  }
}

searchInput.addEventListener("input", () => {
  const search = searchInput.value.toLowerCase().trim();

  const filteredConversations = conversations.filter((conversation) => {
    return (
      conversation.name.toLowerCase().includes(search) ||
      conversation.number.toLowerCase().includes(search)
    );
  });

  renderConversations(filteredConversations);
});
window.officeCRM.onNewMessage(async (data) => {
  console.log("Nuevo mensaje recibido en Electron:", data);

  const incomingConversationId = Number(data.conversationId);

  // Si llegó a otro chat
  if (incomingConversationId !== Number(activeConversationId)) {
    unreadChats.add(incomingConversationId);

    conversationCache.delete(incomingConversationId);

    notificationSound.currentTime = 0;

    notificationSound.play().catch((error) => {
      console.log("No se pudo reproducir el sonido:", error);
    });
  }

  // Actualizar lista izquierda
  await loadConversations();

  // Si el mensaje pertenece al chat que estamos mirando,
  // traemos su versión nueva.
  if (incomingConversationId === Number(activeConversationId)) {
    await refreshActiveConversation(incomingConversationId);
  }
});
async function refreshActiveConversation(conversationId) {
  try {
    const response = await window.officeCRM.api({
      path: `/api/conversations/${conversationId}/messages`,
      method: "GET",
    });

    if (!response.ok) {
      return;
    }

    const conversation = response.data;

    conversationCache.set(Number(conversationId), conversation);

    // Si seguimos mirando ese chat,
    // actualizarlo.
    if (Number(activeConversationId) === Number(conversationId)) {
      await renderActiveConversation(conversation);
    }
  } catch (error) {
    console.error("Error actualizando chat en tiempo real:", error);
  }
}
function closeActiveConversation() {
  activeConversationId = null;

  contactName.textContent = "";
  contactNumber.textContent = "";

  messagesContainer.innerHTML = "";
  messageInput.value = "";

  showEmptyChat();

  renderConversations();
}
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  // 1. Si está abierto el modal de contacto, cerrar solo eso
  if (contactModal?.classList.contains("active")) {
    contactModal.classList.remove("active");
    return;
  }

  // 2. Si está abierto el visor de imagen, cerrar solo eso
  if (imageViewer?.classList.contains("active")) {
    imageViewer.classList.remove("active");
    imageViewerImg.src = "";
    return;
  }

  // 3. Si no hay nada abierto, cerrar el chat
  closeActiveConversation();
});
// =========================
// EMOJIS
// =========================

const emojis = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😆",
  "😅",
  "😂",
  "🤣",
  "😊",
  "😇",
  "🙂",
  "🙃",
  "😉",
  "😌",
  "😍",
  "🥰",
  "😘",
  "😗",
  "😙",
  "😚",
  "😋",
  "😛",
  "😝",
  "😜",
  "🤪",
  "🤨",
  "🧐",
  "🤓",
  "😎",
  "🥸",
  "🤩",
  "🥳",
  "😏",
  "😒",
  "😞",
  "😔",
  "😟",
  "😕",
  "🙁",
  "☹️",
  "😣",
  "😖",
  "😫",
  "😩",
  "🥺",
  "😢",
  "😭",
  "😤",
  "😠",
  "😡",
  "🤬",
  "🤯",
  "😳",
  "🥵",
  "🥶",
  "😱",
  "😨",
  "😰",
  "😥",
  "😓",
  "🤗",
  "🤔",
  "🫣",
  "🤭",
  "🤫",
  "🤥",
  "😶",
  "😐",
  "😑",
  "😬",
  "🙄",
  "😯",

  "👍",
  "👎",
  "👌",
  "✌️",
  "🤞",
  "🤟",
  "🤘",
  "🤙",
  "👈",
  "👉",
  "👆",
  "👇",
  "☝️",
  "✋",
  "🤚",
  "🖐️",
  "👋",
  "👏",
  "🙌",
  "🫶",
  "🤝",
  "🙏",
  "💪",
  "🫵",

  "❤️",
  "🧡",
  "💛",
  "💚",
  "💙",
  "💜",
  "🖤",
  "🤍",
  "🤎",
  "💔",
  "❤️‍🔥",
  "❤️‍🩹",
  "💕",
  "💞",
  "💓",
  "💗",

  "🔥",
  "✨",
  "⭐",
  "🌟",
  "💫",
  "💥",
  "💯",
  "💢",
  "🎉",
  "🎊",
  "🎁",
  "🏆",
  "🥇",
  "⚽",
  "🎮",
  "🚀",

  "🐶",
  "🐱",
  "🐭",
  "🐹",
  "🐰",
  "🦊",
  "🐻",
  "🐼",
  "🐨",
  "🐯",
  "🦁",
  "🐮",
  "🐷",
  "🐸",
  "🐵",
  "🐔",

  "🍕",
  "🍔",
  "🍟",
  "🌭",
  "🍿",
  "🍩",
  "🍪",
  "🎂",
  "🍺",
  "🍻",
  "🥂",
  "☕",
  "🧉",
  "🍎",
  "🍓",
  "🍉",

  "✅",
  "❌",
  "⚠️",
  "❗",
  "❓",
  "💬",
  "📞",
  "📱",
  "💻",
  "📎",
  "📌",
  "📍",
  "💰",
  "💵",
  "🛒",
  "📦",
];

function renderEmojiPicker() {
  emojiGrid.innerHTML = "";

  emojis.forEach((emoji) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "emoji-item";
    button.textContent = emoji;

    button.addEventListener("click", () => {
      insertEmoji(emoji);
    });

    emojiGrid.appendChild(button);
  });
}

function insertEmoji(emoji) {
  const start = messageInput.selectionStart;

  const end = messageInput.selectionEnd;

  const currentText = messageInput.value;

  messageInput.value =
    currentText.slice(0, start) + emoji + currentText.slice(end);

  const newPosition = start + emoji.length;

  messageInput.focus();

  messageInput.setSelectionRange(newPosition, newPosition);

  // Disparamos input para que también
  // funcione tu auto-height del textarea.
  messageInput.dispatchEvent(new Event("input"));
}

emojiButton.addEventListener("click", (event) => {
  event.stopPropagation();

  emojiPicker.hidden = !emojiPicker.hidden;
});

emojiPicker.addEventListener("click", (event) => {
  event.stopPropagation();
});

document.addEventListener("click", () => {
  emojiPicker.hidden = true;
});

renderEmojiPicker();

// =========================
// TEMA CLARO / OSCURO
// =========================

function applyTheme(theme) {
  document.body.classList.toggle("dark-theme", theme === "dark");

  themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";

  themeToggle.title =
    theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
}

const savedTheme = localStorage.getItem("office-theme") || "light";

applyTheme(savedTheme);

themeToggle.addEventListener("click", () => {
  const isDark = document.body.classList.contains("dark-theme");

  const newTheme = isDark ? "light" : "dark";

  localStorage.setItem("office-theme", newTheme);

  applyTheme(newTheme);
});
loadConversations();
