// src/utils/helpers.js

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  const randomArray = new Uint8Array(6);
  window.crypto.getRandomValues(randomArray);
  
  for (let i = 0; i < 6; i++) {
    result += chars[randomArray[i] % chars.length];
  }
  return result;
}

export function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function inferMimeType(filename, currentMime) {
  if (currentMime && currentMime !== 'application/octet-stream' && currentMime !== '') {
    return currentMime;
  }
  
  const extMatch = filename.match(/\.([^.]+)$/);
  if (!extMatch) return currentMime || 'application/octet-stream';
  
  const ext = extMatch[1].toLowerCase();
  
  const mimeTypes = {
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'm4a': 'audio/mp4',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'mov': 'video/quicktime',
    'zip': 'application/zip',
    'rar': 'application/x-rar-compressed',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'json': 'application/json',
    'apk': 'application/vnd.android.package-archive'
  };
  
  return mimeTypes[ext] || currentMime || 'application/octet-stream';
}
