var AuthModule = (function() {
  'use strict';
  const CONFIG = {
    apiBase: 'https://blob-json-db.vercel.app/api',
    encryptedKeyEndpoint: '/encrypted-key',
    blobdbEndpoint: '/blob',
    storageKey: 'blob-db-storage-key'
  };
  let cachedJfrKey = null;
  let jfrKeyPromise = null;
  
  function fetchEncryptedKey() {
    if (cachedJfrKey) {
      return Promise.resolve(cachedJfrKey);
    }
    if (jfrKeyPromise) {
      return jfrKeyPromise;
    }
    jfrKeyPromise = fetch(`${CONFIG.apiBase}${CONFIG.encryptedKeyEndpoint}`).then(res => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to fetch encrypted key`);
      }
      return res.json();
    }).then(data => {
      if (!data.jfrKey) {
        throw new Error('Invalid response: missing jfrKey');
      }
      cachedJfrKey = data.jfrKey;
      jfrKeyPromise = null;
      return cachedJfrKey;
    }).catch(err => {
      console.error('Error fetching encrypted key:', err);
      jfrKeyPromise = null;
      throw err;
    });
    return jfrKeyPromise;
  }
  
  function clearCache() {
    cachedJfrKey = null;
    jfrKeyPromise = null;
  }
  
  async function unlockWithPassword(password) {
    try {
      const jfrKey = await fetchEncryptedKey();
      const decryptedKey = await KeyEncryptor.decrypt(jfrKey, password);
      return decryptedKey;
    } catch (err) {
      throw new Error(`Unlock failed: ${err.message}`);
    }
  }
  
  function hasStoredKey(storageKey) {
    return !!localStorage.getItem(storageKey);
  }
  
  function getStoredKey(storageKey) {
    return localStorage.getItem(storageKey);
  }
  
  function storeKey(storageKey, apiKey) {
    localStorage.setItem(storageKey, apiKey);
  }
  
  function removeKey(storageKey) {
    localStorage.removeItem(storageKey);
  }
  
  async function encrypt(plaintext, password) {
    try {
      return await KeyEncryptor.encrypt(plaintext, password);
    } catch (err) {
      throw new Error(`Encryption failed: ${err.message}`);
    }
  }
  
  async function decrypt(bundle, password) {
    try {
      return await KeyEncryptor.decrypt(bundle, password);
    } catch (err) {
      throw new Error(`Decryption failed: ${err.message}`);
    }
  }
  
  return {
    fetchEncryptedKey,
    unlockWithPassword,
    hasStoredKey,
    getStoredKey,
    storeKey,
    removeKey,
    clearCache,
    encrypt,
    decrypt,
    config: CONFIG
  };
})();
window.AuthModule = AuthModule;