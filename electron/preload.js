const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("officeCRM", {
  api: (options) => ipcRenderer.invoke("office-api", options),

  media: (mediaId) => ipcRenderer.invoke("office-media", mediaId),

  downloadMedia: (mediaId) =>
    ipcRenderer.invoke("office-download-media", mediaId),

  sendImage: (data) => ipcRenderer.invoke("office-send-image", data),

  sendVideo: (data) => ipcRenderer.invoke("office-send-video", data),

  sendAudio: (data) => ipcRenderer.invoke("office-send-audio", data),

  onNewMessage: (callback) => {
    ipcRenderer.on("new-message", (event, data) => {
      callback(data);
    });
  },
});
