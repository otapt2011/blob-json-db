(function() {
  'use strict';
  
  function initUploader(apiKey) {
    jsonBlobUploader.configure({
      apiSecretKey: apiKey,
      storageKey: AuthModule.config.storageKey
    });
    return jsonBlobUploader;
  }
  
  function showUnlockModal() {
    document.getElementById('unlock-modal').classList.remove('hidden');
    document.getElementById('unlock-password').focus();
  }
  
  function hideUnlockModal() {
    document.getElementById('unlock-modal').classList.add('hidden');
    document.getElementById('unlock-error').classList.add('hidden');
    document.getElementById('unlock-password').value = '';
  }
  
  async function handleUnlock(password) {
    const unlockBtn = document.getElementById('unlock-btn');
    const unlockError = document.getElementById('unlock-error');
    const unlockErrorMsg = document.getElementById('unlock-error-msg');
    unlockBtn.disabled = true;
    unlockBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Unlocking...';
    unlockError.classList.add('hidden');
    try {
      const apiKey = await AuthModule.unlockWithPassword(password);
      AuthModule.storeKey(AuthModule.config.storageKey, apiKey);
      const uploader = initUploader(apiKey);
      hideUnlockModal();
      window.dispatchEvent(new CustomEvent('auth:ready', { detail: { uploader } }));
      testConnection();
    } catch (err) {
      unlockErrorMsg.textContent = err.message || 'Invalid password';
      unlockError.classList.remove('hidden');
      document.getElementById('unlock-password').select();
    } finally {
      unlockBtn.disabled = false;
      unlockBtn.innerHTML = '<i class="fa-solid fa-key"></i> Unlock';
    }
  }
  
  async function testConnection() {
    const testResultSpan = document.getElementById('test-result');
    const conn = document.getElementById('conn');
    testResultSpan.textContent = 'Testing...';
    testResultSpan.className = 'hidden text-[9px] text-cyan-300';
    try {
      const storedKey = AuthModule.getStoredKey(AuthModule.config.storageKey);
      if (!storedKey) throw new Error('No API key. Please unlock first.');
      const url = `${AuthModule.config.apiBase}${AuthModule.config.blobdbEndpoint}?limit=1`;
      const res = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + storedKey }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      testResultSpan.textContent = `Connected! Store: ${data.storeId || 'N/A'}`;
      conn.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse';
      testResultSpan.className = 'hidden text-[9px] text-green-400';
    } catch (err) {
      testResultSpan.textContent = 'Connection failed: ' + err.message;
      testResultSpan.className = 'hidden text-[9px] text-red-400';
      conn.className = 'w-1.5 h-1.5 rounded-full bg-red-800 animate-pulse';
    }
  }
  
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('unlock-btn').addEventListener('click', () => {
      const password = document.getElementById('unlock-password').value;
      if (password) handleUnlock(password);
    });
    document.getElementById('unlock-password').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const password = document.getElementById('unlock-password').value;
        if (password) handleUnlock(password);
      }
    });
    document.getElementById('test-connection-btn').addEventListener('click', testConnection);
    
    const storedKey = AuthModule.getStoredKey(AuthModule.config.storageKey);
    if (storedKey) {
      const uploader = initUploader(storedKey);
      window.dispatchEvent(new CustomEvent('auth:ready', { detail: { uploader } }));
      testConnection();
    } else {
      showUnlockModal();
    }
  });
})();