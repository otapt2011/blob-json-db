const KeyEncryptor = (function() {
  'use strict';
  
  function _arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  
  function _base64ToArrayBuffer(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  async function _deriveKey(password, salt) {
    var enc = new TextEncoder();
    var keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({
      name: 'PBKDF2',
      salt: salt,
      iterations: 600000,
      hash: 'SHA-256'
    }, keyMaterial, {
      name: 'AES-GCM',
      length: 256
    }, false, ['encrypt', 'decrypt']);
  }
  
  async function encrypt(plaintext, password) {
    if (!plaintext || !password) {
      throw new Error('Plaintext and password are required.');
    }
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await _deriveKey(password, salt);
    var encoded = new TextEncoder().encode(plaintext);
    var cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, encoded);
    return {
      iv: _arrayBufferToBase64(iv),
      salt: _arrayBufferToBase64(salt),
      ciphertext: _arrayBufferToBase64(cipherBuffer)
    };
  }
  
  async function decrypt(bundle, password) {
    if (!bundle || !password) {
      throw new Error('Bundle and password are required.');
    }
    var iv = new Uint8Array(_base64ToArrayBuffer(bundle.iv));
    var salt = new Uint8Array(_base64ToArrayBuffer(bundle.salt));
    var cipherBuffer = _base64ToArrayBuffer(bundle.ciphertext);
    var key = await _deriveKey(password, salt);
    var decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, cipherBuffer);
    return new TextDecoder().decode(decrypted);
  }
  
  return { encrypt, decrypt };
})();
window.KeyEncryptor = KeyEncryptor;