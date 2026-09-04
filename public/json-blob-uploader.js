var jsonBlobUploader = (function() {
  'use strict';
  let _apiBase = AuthModule.config.apiBase;
  let _blobdbEndpoint = AuthModule.config.blobdbEndpoint;
  let _uploadCategory = 'others';
  let _apiSecretKey = null;
  let _storageKey = null;
  let _workerUrl = null;
  
  function _getApiKey() {
    if (_apiSecretKey) return _apiSecretKey;
    if (_storageKey) {
      const stored = AuthModule.getStoredKey(_storageKey);
      if (stored) {
        _apiSecretKey = stored;
        return stored;
      }
    }
    return null;
  }
  
  function configure(options) {
    if (!options || typeof options !== 'object') return;
    if (typeof options.apiBase === 'string' && options.apiBase.length > 0) {
      _apiBase = options.apiBase.replace(/\/+$/, '');
    }
    if (typeof options.blobdbEndpoint === 'string' && options.blobdbEndpoint.length > 0) {
      _blobdbEndpoint = options.blobdbEndpoint;
    }
    if (typeof options.uploadCategory === 'string' && options.uploadCategory.length > 0) {
      _uploadCategory = options.uploadCategory;
    }
    if (typeof options.apiSecretKey === 'string') {
      _apiSecretKey = options.apiSecretKey;
    }
    if (typeof options.storageKey === 'string' && options.storageKey.length > 0) {
      _storageKey = options.storageKey;
      if (!_apiSecretKey) {
        _apiSecretKey = AuthModule.getStoredKey(_storageKey) || null;
      }
    }
  }
  
  // Core XHR upload – now with speed calculation
  function _uploadSingleFile(formData, category, onProgress) {
    return new Promise((resolve, reject) => {
      const timestamp = formData.get('lastModified') || Date.now();
      formData.set('lastModified', timestamp);
      const queryUrl = `${_apiBase}${_blobdbEndpoint}?category=${encodeURIComponent(category)}&lastModified=${timestamp}`;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', queryUrl, true);
      const authKey = _getApiKey();
      if (authKey) xhr.setRequestHeader('Authorization', 'Bearer ' + authKey);
      
      let lastLoaded = 0;
      let lastTime = Date.now();
      
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          
          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000; // seconds
          const bytesDiff = e.loaded - lastLoaded;
          let speedMbps = 0;
          if (timeDiff > 0 && bytesDiff > 0) {
            speedMbps = (bytesDiff * 8) / (timeDiff * 1_000_000);
          }
          
          lastLoaded = e.loaded;
          lastTime = now;
          
          if (typeof onProgress === 'function') {
            onProgress(percent, speedMbps);
          }
        }
      };
      
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 201) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            reject(new Error('Invalid response'));
          }
        } else {
          reject(new Error('HTTP ' + xhr.status + ' ' + xhr.statusText));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Timeout'));
      xhr.timeout = 0;
      xhr.send(formData);
    });
  }
  
  function uploadFile(file, onProgress, category, extraFields) {
    if (!file) return Promise.reject(new Error('File is required'));
    const cat = category || _uploadCategory;
    const formData = new FormData();
    formData.append('image', file);
    formData.append('lastModified', file.lastModified || Date.now());
    if (extraFields && typeof extraFields === 'object') {
      Object.entries(extraFields).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }
    return _uploadSingleFile(formData, cat, onProgress);
  }
  
  function uploadFileChunked(file, onProgress, category, extraFields, chunkSize = 4 * 1024 * 1024) {
    if (!file) return Promise.reject(new Error('File is required'));
    const cat = category || _uploadCategory;
    const totalChunks = Math.ceil(file.size / chunkSize);
    const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fileName = file.name;
    const lastModified = file.lastModified || Date.now();
    
    async function uploadNextChunk(chunkIndex) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      
      const formData = new FormData();
      formData.append('chunk', chunk);
      formData.append('fileId', fileId);
      formData.append('chunkIndex', chunkIndex.toString());
      formData.append('totalChunks', totalChunks.toString());
      formData.append('fileName', fileName);
      formData.append('category', cat);
      formData.append('lastModified', lastModified.toString());
      
      if (extraFields && typeof extraFields === 'object') {
        Object.entries(extraFields).forEach(([key, value]) => {
          formData.append(key, value);
        });
      }
      
      const result = await _uploadSingleFile(formData, cat, (chunkPercent, speedMbps) => {
        if (onProgress) {
          const overall = ((chunkIndex + chunkPercent / 100) / totalChunks) * 100;
          onProgress(Math.round(overall), speedMbps);
        }
      });
      return result;
    }
    
    const executeChunks = async () => {
      let finalResult;
      for (let i = 0; i < totalChunks; i++) {
        finalResult = await uploadNextChunk(i);
      }
      return finalResult;
    };
    return executeChunks();
  }
  
  function uploadJson(data, filename, onProgress, category) {
    if (data === undefined || data === null) {
      return Promise.reject(new Error('Data is required'));
    }
    const jsonString = typeof data === 'string' ? data : JSON.stringify(data);
    const file = new File([jsonString], filename || 'data.json', {
      type: 'application/json',
      lastModified: Date.now()
    });
    return uploadFile(file, onProgress, category || 'json');
  }
  
  function readJson(input) {
    if (typeof input === 'string') {
      if (input.startsWith('http://') || input.startsWith('https://')) {
        return _fetchJson(input);
      }
      return _findUrlByPathname(input).then(url => _fetchJson(url));
    }
    if (input && typeof input === 'object' && input.url) {
      return _fetchJson(input.url);
    }
    return Promise.reject(new Error('A URL, pathname, or blob object with url is required'));
  }
  
  function readJsonInWorker(input) {
    if (!_workerUrl) {
      const workerCode = `
                self.onmessage = async function(e) {
                    const url = e.data.url;
                    if (!url) {
                        self.postMessage({ error: 'No URL provided' });
                        return;
                    }
                    try {
                        const response = await fetch(url);
                        if (!response.ok) {
                            throw new Error('HTTP ' + response.status);
                        }
                        const data = await response.json();
                        self.postMessage({ data });
                    } catch (err) {
                        self.postMessage({ error: err.message });
                    }
                };
            `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      _workerUrl = URL.createObjectURL(blob);
    }
    
    return new Promise((resolve, reject) => {
      const worker = new Worker(_workerUrl);
      worker.onmessage = (e) => {
        if (e.data.error) {
          reject(new Error(e.data.error));
        } else {
          resolve(e.data.data);
        }
        worker.terminate();
      };
      worker.onerror = (err) => {
        reject(err);
        worker.terminate();
      };
      
      if (typeof input === 'string') {
        if (input.startsWith('http://') || input.startsWith('https://')) {
          worker.postMessage({ url: input });
        } else {
          _findUrlByPathname(input)
            .then(url => worker.postMessage({ url }))
            .catch(err => {
              reject(err);
              worker.terminate();
            });
        }
      } else if (input && typeof input === 'object' && input.url) {
        worker.postMessage({ url: input.url });
      } else {
        reject(new Error('A URL, pathname, or blob object with url is required'));
        worker.terminate();
      }
    });
  }
  
  function _findUrlByPathname(pathname) {
    const cleanPath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    const url = `${_apiBase}${_blobdbEndpoint}?_=${Date.now()}`;
    const authKey = _getApiKey();
    const headers = {};
    if (authKey) headers['Authorization'] = 'Bearer ' + authKey;
    return fetch(url, { headers })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
      })
      .then(data => {
        const blobs = data.blobs || [];
        const blob = blobs.find(b => b.pathname === cleanPath || b.pathname === '/' + cleanPath);
        if (!blob) throw new Error(`Blob with pathname "${pathname}" not found`);
        return blob.url;
      });
  }
  
  function _fetchJson(url) {
    return fetch(url).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res.json();
    });
  }
  
  function listBlobs() {
    const url = `${_apiBase}${_blobdbEndpoint}?_=${Date.now()}`;
    const authKey = _getApiKey();
    const headers = {};
    if (authKey) headers['Authorization'] = 'Bearer ' + authKey;
    return fetch(url, { headers })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
      })
      .then(data => data.blobs || []);
  }
  
  return {
    configure,
    uploadFile,
    uploadFileChunked,
    uploadJson,
    readJson,
    readJsonInWorker,
    listBlobs,
    getApiBase: () => _apiBase,
    getUploadCategory: () => _uploadCategory
  };
})();
window.jsonBlobUploader = jsonBlobUploader;