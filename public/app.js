const conversationList = document.querySelector("#conversation-list");
const messagesContainer = document.querySelector("#messages");
const contactName = document.querySelector("#contact-name");
const contactNumber = document.querySelector("#contact-number");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const searchInput = document.querySelector("#search");

const emptyChat = document.querySelector("#empty-chat");
const activeChat = document.querySelector("#active-chat");

const imageInput = document.querySelector("#imageInput");
imageInput.addEventListener("change", async () => {
  const file = imageInput.files[0];

  if (!file || !activeConversationId) {
    return;
  }

  const formData = new FormData();

  formData.append("image", file);
  formData.append("conversationId", activeConversationId);

  const caption = messageInput.value.trim();

  if (caption) {
    formData.append("caption", caption);
  }

  try {
    const response = await fetch("/api/messages/image", {
      method: "POST",
      body: formData,
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "No se pudo enviar la imagen");
    }

    messageInput.value = "";
    imageInput.value = "";

    await loadConversations();
    await loadActiveConversation();
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
});
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
    const response = await fetch(
      `/api/conversations/${activeConversationId}/contact`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
        }),
      },
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "No se pudo guardar el contacto");
    }

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
const notificationSound = new Audio("/sounds/notification.mp3");
notificationSound.volume = 0.7;
const socket = io();
let conversations = [];
let activeConversationId = null;
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
    const response = await fetch("/api/conversations");

    if (!response.ok) {
      throw new Error("No se pudieron cargar las conversaciones");
    }

    conversations = await response.json();

    renderConversations();

    // Si hay un chat seleccionado, lo mostramos.
    if (activeConversationId) {
      showActiveChat();
      await loadActiveConversation();
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
    });

    conversationList.appendChild(article);
  });
}

async function loadActiveConversation() {
  if (!activeConversationId) {
    return;
  }

  try {
    const response = await fetch(
      `/api/conversations/${activeConversationId}/messages`,
    );

    if (!response.ok) {
      throw new Error("No se pudieron cargar los mensajes");
    }

    const conversation = await response.json();

    contactName.textContent = conversation.name;
    contactNumber.textContent = conversation.number;

    messagesContainer.innerHTML = "";

    conversation.messages.forEach((message) => {
      const messageElement = document.createElement("article");

      messageElement.className = `message ${message.type}`;

      if (message.mediaType === "image" && message.mediaId) {
        messageElement.innerHTML = `
          <div class="message-image-container">

            <img
              class="message-image"
              src="/api/media/${message.mediaId}"
              alt="Imagen recibida"
            >

            <a
              class="download-image-button"
              href="/api/media/${message.mediaId}/download"
              title="Descargar imagen"
            >
              ↓
            </a>

          </div>

          ${message.text ? `<p class="message-text">${message.text}</p>` : ""}

          ${
            message.reaction
              ? `<span class="message-reaction">${message.reaction}</span>`
              : ""
          }

          <span class="message-time">
            ${message.time}
          </span>
        `;
      } else {
        messageElement.innerHTML = `
          <p class="message-text">
            ${message.text}
          </p>

          ${
            message.reaction
              ? `<span class="message-reaction">${message.reaction}</span>`
              : ""
          }

          <span class="message-time">
            ${message.time}
          </span>
        `;
      }

      messagesContainer.appendChild(messageElement);
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } catch (error) {
    console.error(error);

    messagesContainer.innerHTML = `
      <p class="error-message">
        No se pudieron cargar los mensajes.
      </p>
    `;
  }
}
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

  const text = messageInput.value.trim();

  if (!text || !activeConversationId) {
    return;
  }

  const submitButton = messageForm.querySelector("button");

  submitButton.disabled = true;
  messageInput.disabled = true;

  try {
    const response = await fetch("/api/messages", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        conversationId: activeConversationId,
        text,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "No se pudo enviar el mensaje");
    }

    messageInput.value = "";

    await loadConversations();

    messageInput.focus();
  } catch (error) {
    console.error(error);
    alert(error.message);
  } finally {
    submitButton.disabled = false;
    messageInput.disabled = false;
  }
});

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
socket.on("connect", () => {
  console.log("Conectado a Socket.IO:", socket.id);
});

socket.on("new-message", async (data) => {
  console.log("Nuevo WhatsApp recibido:", data);

  const incomingConversationId = Number(data.conversationId);

  // Si el mensaje llegó a un chat que NO está abierto
  if (incomingConversationId !== Number(activeConversationId)) {
    // Marcar ese chat como no leído
    unreadChats.add(incomingConversationId);

    // Reproducir sonido
    notificationSound.currentTime = 0;

    notificationSound.play().catch((error) => {
      console.log("No se pudo reproducir el sonido:", error);
    });
  }

  await loadConversations();
});
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

loadConversations();
