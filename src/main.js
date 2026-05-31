// src/main.js
import { App } from './ui/app.js';
import { inject } from '@vercel/analytics';

// Initialize Vercel Analytics
inject();

document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  window.app = app; // Expose for debugging if needed
});

// PWA Service Worker Registration
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(
      (registration) => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
      },
      (err) => {
        console.log('ServiceWorker registration failed: ', err);
      }
    );
  });
}
