'use strict';

/**
 * araterm preload — جسر آمن بين النافذة والعملية الرئيسية.
 * CommonJS (متطلب sandbox في Electron).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('araterm', {
  /** يستقبل إطارًا بصريًا كاملًا: { rows: [{parts}], cursor } */
  onFrame: (cb) => ipcRenderer.on('frame', (_e, frame) => cb(frame)),
  /** إشعار خروج الصدفة */
  onExit: (cb) => ipcRenderer.on('exit', (_e, info) => cb(info)),
  /** خطأ في العملية الرئيسية (تشخيص) */
  onError: (cb) => ipcRenderer.on('frame-error', (_e, msg) => cb(msg)),
  /** إرسال مدخلات (بايتات/حروف) إلى الصدفة */
  sendInput: (data) => ipcRenderer.send('input', data),
  /** تغيير مقاس الشاشة بالخلايا */
  resize: (cols, rows) => ipcRenderer.send('resize', { cols, rows }),
  /** تمرير السجل (سطور موجبة/سالبة) */
  scroll: (delta) => ipcRenderer.send('scroll', delta),
  /** النافذة جاهزة */
  ready: () => ipcRenderer.send('ready'),
});
