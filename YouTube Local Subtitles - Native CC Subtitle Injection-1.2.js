// ==UserScript==
// @name         YouTube Local Subtitles - Native CC Subtitle Injection
// @name:en      YouTube Local Subtitles - Native CC Subtitle Injection
// @name:zh-CN   YouTube 本地字幕 - 注入原生CC字幕
// @name:zh-TW   YouTube 本地字幕 - 注入原生CC字幕
// @namespace    https://github.com/FaQxD233/YouTube-Local-Subtitle-Loader-for-Tampermonkey
// @version      1.2
// @description  从本地加载 SRT/VTT 字幕，并将其注入为 YouTube 原生 CC 字幕轨道，不创建独立字幕层，也不隐藏原生字幕层。
// @description:en  Load local SRT/VTT subtitles and inject them as a YouTube native CC track without creating a separate subtitle layer or hiding the native subtitle layer.
// @description:zh-CN  从本地加载 SRT/VTT 字幕，并将其注入为 YouTube 原生 CC 字幕轨道，不创建独立字幕层，也不隐藏原生字幕层。
// @description:zh-TW  載入本地 SRT/VTT 字幕，並將其注入為 YouTube 原生 CC 字幕軌道，不建立獨立字幕層，也不隱藏原生字幕層。
// @match        https://www.youtube.com/watch*
// @match        https://www.youtube.com/*&v=*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const TRACK_VSS_ID = '.yt-local-subtitle';
  const TRACK_LANG = 'yt-local';
  const MENU_CLASS = 'tm-local-native-cc-menuitem';
  const STATE_KEY = '__ytLocalNativeCcState';

  const MESSAGES = {
    zh: {
      trackName: '本地字幕',
      uploadLabel: '上传本地字幕',
      notLoaded: '未加载',
      countSuffix: '条',
      loadedLog: '[本地字幕] 已作为 YouTube 原生 CC 轨道注入:',
      countLog: '条目数:',
      emptyWarn: '[本地字幕] 没有解析到有效字幕:',
      debugPrefix: '[本地字幕:debug]',
    },
    en: {
      trackName: 'Local subtitles',
      uploadLabel: 'Upload local subtitles',
      notLoaded: 'Not loaded',
      countSuffix: 'cues',
      loadedLog: '[Local subtitles] Injected as a YouTube native CC track:',
      countLog: 'cues:',
      emptyWarn: '[Local subtitles] No valid subtitles parsed:',
      debugPrefix: '[Local subtitles:debug]',
    },
  };

  const state = window[STATE_KEY] || {
    cues: [],
    filename: '',
    version: 0,
    track: null,
    retryTimer: null,
    fileInput: null,
    settingsObserverAttached: false,
    initialResponsePatched: false,
    xhrPatched: false,
    fetchPatched: false,
    initTimer: null,
    adBypassTimer: null,
  };
  window[STATE_KEY] = state;

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function init() {
    ensureLocalTrack();
    ensureFileInput();
    patchLocalTimedtextXhr();
    patchLocalTimedtextFetch();
    patchInitialPlayerResponseSetter();
    injectKnownPlayerResponses();
    setupSettingsObserver();
    setupAdBypass();
  }

  function setupAdBypass() {
    if (state.adBypassTimer) return;

    state.adBypassTimer = setInterval(() => {
      const player = getPlayer();
      if (!player || !player.classList || !player.classList.contains('ad-showing')) return;

      clickSkipAdButton(player);
      fastForwardCurrentAd();
    }, 250);
  }

  function clickSkipAdButton(player) {
    const skipButton = player.querySelector(
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button[class*="skip"]'
    );
    if (skipButton && !skipButton.disabled) skipButton.click();
  }

  function fastForwardCurrentAd() {
    const video = document.querySelector('video.html5-main-video');
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;

    try { video.playbackRate = Math.max(video.playbackRate || 1, 16); } catch (err) {}

    try {
      if (video.duration - video.currentTime > 0.5) {
        video.currentTime = Math.max(0, video.duration - 0.1);
      }
    } catch (err) {}
  }

  function ensureLocalTrack() {
    if (!state.track || isLegacyLocalTrack(state.track)) state.track = createLocalCaptionTrack();
    if ('captionDataUrl' in state) delete state.captionDataUrl;
  }

  function isLegacyLocalTrack(track) {
    return !!(track && typeof track.baseUrl === 'string' && track.baseUrl.startsWith('data:'));
  }

  function ensureFileInput() {
    if (state.fileInput && document.body && document.body.contains(state.fileInput)) return;
    if (!document.body) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.srt,.vtt,.txt';
    input.style.display = 'none';
    input.addEventListener('change', handleFileChange);
    document.body.appendChild(input);
    state.fileInput = input;
  }

  function handleFileChange(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (ev) {
      const text = ev.target && ev.target.result ? String(ev.target.result) : '';
      loadLocalSubtitles(text, file.name);
    };
    reader.readAsText(file, 'utf-8');
  }

  function loadLocalSubtitles(text, filename) {
    const cues = /^\s*WEBVTT/i.test(text) ? parseVtt(text) : parseSrt(text);
    cues.sort((a, b) => a.start - b.start);

    state.cues = cues;
    state.filename = filename || msg('trackName');
    state.version += 1;
    ensureLocalTrack();
    state.track = createLocalCaptionTrack();

    injectKnownPlayerResponses();
    refreshNativeCaptionTracklist();
    updateMenuStatus();

    if (cues.length) {
      selectLocalTrackWithRetry(4);
      console.log(msg('loadedLog'), filename, msg('countLog'), cues.length);
    } else {
      console.warn(msg('emptyWarn'), filename);
    }
  }

  function createLocalCaptionTrack() {
    const displayName = getTrackDisplayName();
    return {
      baseUrl: getLocalCaptionBaseUrl(),
      name: { simpleText: displayName, runs: [{ text: displayName }] },
      vssId: TRACK_VSS_ID,
      languageCode: TRACK_LANG,
      languageName: { simpleText: displayName, runs: [{ text: displayName }] },
      isTranslatable: false,
      isDefault: false,
      trackName: msg('trackName'),
      displayName,
      rtl: false,
    };
  }

  function createCaptionsBaseUrl() {
    const videoId = getVideoId();
    const baseUrl = new URL('/api/timedtext', location.origin);
    baseUrl.searchParams.set('v', videoId || 'local');
    baseUrl.searchParams.set('type', 'track');
    return baseUrl.toString();
  }

  function getLocalCaptionBaseUrl() {
    const videoId = getVideoId();
    const url = new URL('/api/timedtext', location.origin);
    url.searchParams.set('v', videoId || 'local');
    url.searchParams.set('lang', TRACK_LANG);
    url.searchParams.set('name', msg('trackName'));
    url.searchParams.set('fmt', 'json3');
    url.searchParams.set('local_subtitle', '1');
    url.searchParams.set('version', String(state.version));
    return url.toString();
  }

  function patchLocalTimedtextXhr() {
    if (state.xhrPatched || typeof XMLHttpRequest === 'undefined') return;

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this._tmLocalSubtitleUrl = isLocalTimedtextUrl(url) ? String(url) : '';
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function patchedSend() {
      if (!this._tmLocalSubtitleUrl) return originalSend.apply(this, arguments);

      const xhr = this;
      const body = makeLocalTimedtextResponse(xhr._tmLocalSubtitleUrl);
      defineGetter(xhr, 'readyState', 4);
      defineGetter(xhr, 'status', 200);
      defineGetter(xhr, 'statusText', 'OK');
      defineGetter(xhr, 'responseURL', xhr._tmLocalSubtitleUrl);
      defineGetter(xhr, 'responseText', body);
      defineGetter(xhr, 'response', body);

      setTimeout(() => {
        fireXhrEvent(xhr, 'readystatechange');
        fireXhrEvent(xhr, 'load');
        fireXhrEvent(xhr, 'loadend');
      }, 0);
      return undefined;
    };

    state.xhrPatched = true;
  }

  function patchLocalTimedtextFetch() {
    if (state.fetchPatched || typeof window.fetch !== 'function') return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = function patchedFetch(input, initOptions) {
      const rawUrl = typeof input === 'string' ? input : input && input.url;
      if (isLocalTimedtextUrl(rawUrl)) {
        const body = makeLocalTimedtextResponse(rawUrl);
        return Promise.resolve(new Response(body, {
          status: 200,
          headers: {
            'content-type': getLocalTimedtextMimeType(rawUrl) + '; charset=utf-8',
          },
        }));
      }
      return originalFetch(input, initOptions);
    };

    state.fetchPatched = true;
  }

  function isLocalTimedtextUrl(rawUrl) {
    if (!rawUrl) return false;
    try {
      const url = new URL(String(rawUrl), location.origin);
      return url.origin === location.origin && url.pathname === '/api/timedtext' && url.searchParams.get('local_subtitle') === '1';
    } catch (err) {
      return false;
    }
  }

  function makeLocalTimedtextResponse(rawUrl) {
    let fmt = 'json3';
    try {
      fmt = (new URL(String(rawUrl), location.origin).searchParams.get('fmt') || 'json3').toLowerCase();
    } catch (err) {}

    if (fmt === 'srv3' || fmt === 'ttml' || fmt === 'xml') return toYouTubeTranscriptXml(state.cues);
    if (fmt === 'vtt' || fmt === 'webvtt') return toWebVtt(state.cues);
    return JSON.stringify(toYouTubeJson3(state.cues));
  }

  function getLocalTimedtextMimeType(rawUrl) {
    let fmt = 'json3';
    try {
      fmt = (new URL(String(rawUrl), location.origin).searchParams.get('fmt') || 'json3').toLowerCase();
    } catch (err) {}

    if (fmt === 'srv3' || fmt === 'ttml' || fmt === 'xml') return 'text/xml';
    if (fmt === 'vtt' || fmt === 'webvtt') return 'text/vtt';
    return 'application/json';
  }

  function defineGetter(obj, key, value) {
    try {
      Object.defineProperty(obj, key, { configurable: true, get: () => value });
    } catch (err) {}
  }

  function fireXhrEvent(xhr, type) {
    const event = new Event(type);
    const handler = xhr['on' + type];
    if (typeof handler === 'function') handler.call(xhr, event);
    xhr.dispatchEvent(event);
  }

  function getTrackDisplayName() {
    const trackName = msg('trackName');
    return state.filename ? `${trackName} (${state.filename})` : trackName;
  }

  function msg(key) {
    const lang = detectUiLanguage();
    return (MESSAGES[lang] && MESSAGES[lang][key]) || MESSAGES.en[key] || key;
  }

  function detectUiLanguage() {
    const candidates = [
      document.documentElement && document.documentElement.lang,
      document.querySelector('html[lang]') && document.querySelector('html[lang]').getAttribute('lang'),
      navigator.language,
    ];

    return candidates.some((lang) => /^zh/i.test(String(lang || ''))) ? 'zh' : 'en';
  }

  function getVideoId() {
    try {
      return new URL(location.href).searchParams.get('v') || '';
    } catch (err) {
      return '';
    }
  }

  function patchInitialPlayerResponseSetter() {
    if (state.initialResponsePatched) return;

    let currentValue = injectIntoPossiblePlayerResponse(window.ytInitialPlayerResponse);
    try {
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        get: () => currentValue,
        set: (value) => {
          currentValue = injectIntoPossiblePlayerResponse(value);
        },
      });
      state.initialResponsePatched = true;
    } catch (err) {}
  }

  function injectKnownPlayerResponses() {
    injectIntoPossiblePlayerResponse(window.ytInitialPlayerResponse);

    const player = getPlayer();
    if (player && typeof player.getPlayerResponse === 'function') {
      injectIntoPossiblePlayerResponse(player.getPlayerResponse());
    }

    try {
      const ytcfg = window.ytcfg && window.ytcfg.data_;
      if (ytcfg && ytcfg.PLAYER_VARS && ytcfg.PLAYER_VARS.raw_player_response) {
        injectIntoPossiblePlayerResponse(ytcfg.PLAYER_VARS.raw_player_response);
      }
    } catch (err) {}
  }

  function injectIntoPossiblePlayerResponse(value) {
    if (!value || typeof value !== 'object' || !state.track) return value;

    if (value.videoDetails || value.streamingData || value.playabilityStatus || value.captions) {
      ensureCaptionsContainer(value);
      injectTracklistRenderer(value.captions.playerCaptionsTracklistRenderer);
    }

    if (value.playerResponse) {
      ensureCaptionsContainer(value.playerResponse);
      injectTracklistRenderer(value.playerResponse.captions.playerCaptionsTracklistRenderer);
    }

    return value;
  }

  function ensureCaptionsContainer(playerResponse) {
    if (!playerResponse.captions) playerResponse.captions = {};
    if (!playerResponse.captions.playerCaptionsRenderer) {
      playerResponse.captions.playerCaptionsRenderer = { baseUrl: createCaptionsBaseUrl() };
    }
    if (!playerResponse.captions.playerCaptionsTracklistRenderer) {
      playerResponse.captions.playerCaptionsTracklistRenderer = {};
    }
  }

  function injectTracklistRenderer(renderer) {
    if (!renderer || !state.track) return;
    if (!Array.isArray(renderer.captionTracks)) renderer.captionTracks = [];

    const nextTrack = createLocalCaptionTrack();
    state.track = nextTrack;

    const existingIndex = renderer.captionTracks.findIndex((track) => track && track.vssId === TRACK_VSS_ID);
    if (existingIndex >= 0) {
      renderer.captionTracks[existingIndex] = nextTrack;
    } else {
      renderer.captionTracks.push(nextTrack);
    }

    const trackIndex = renderer.captionTracks.findIndex((track) => track && track.vssId === TRACK_VSS_ID);
    ensureAudioTrackReferences(renderer, trackIndex);

    if (!Array.isArray(renderer.translationLanguages)) renderer.translationLanguages = [];
    if (!renderer.defaultAudioTrackIndex) renderer.defaultAudioTrackIndex = 0;
  }

  function ensureAudioTrackReferences(renderer, trackIndex) {
    if (trackIndex < 0) return;
    if (!Array.isArray(renderer.audioTracks) || !renderer.audioTracks.length) {
      renderer.audioTracks = [{ captionTrackIndices: [trackIndex], defaultCaptionTrackIndex: trackIndex }];
      return;
    }

    renderer.audioTracks.forEach((audioTrack) => {
      if (!Array.isArray(audioTrack.captionTrackIndices)) audioTrack.captionTrackIndices = [];
      if (!audioTrack.captionTrackIndices.includes(trackIndex)) audioTrack.captionTrackIndices.push(trackIndex);
      if (audioTrack.defaultCaptionTrackIndex == null && state.cues.length) audioTrack.defaultCaptionTrackIndex = trackIndex;
    });
  }

  function refreshNativeCaptionTracklist() {
    const player = getPlayer();
    if (!player || !state.track) return;

    try { player.loadModule && player.loadModule('captions'); } catch (err) {}

    try {
      const response = typeof player.getPlayerResponse === 'function' ? player.getPlayerResponse() : null;
      injectIntoPossiblePlayerResponse(response);
    } catch (err) {}

    try {
      if (typeof player.getOption === 'function' && typeof player.setOption === 'function') {
        const tracklist = player.getOption('captions', 'tracklist') || { captionTracks: [] };
        injectTracklistRenderer(tracklist);
        player.setOption('captions', 'tracklist', tracklist);
        debugLog('tracklist refreshed', tracklist.captionTracks && tracklist.captionTracks.length);
      }
    } catch (err) {}
  }

  function selectLocalTrackWithRetry(remaining) {
    if (state.retryTimer) {
      clearTimeout(state.retryTimer);
      state.retryTimer = null;
    }

    refreshNativeCaptionTracklist();
    forceCaptionButtonOn();
    clearNativeCaptionTrack();

    setTimeout(() => {
      selectLocalTrack();
      pokeVideoClock();

      if (remaining > 0) {
        state.retryTimer = setTimeout(() => selectLocalTrackWithRetry(remaining - 1), 500);
      }
    }, 80);
  }

  function clearNativeCaptionTrack() {
    const player = getPlayer();
    if (!player) return;

    try {
      if (typeof player.setOption === 'function') {
        player.setOption('captions', 'track', null);
        player.setOption('captions', 'track', {});
      }
    } catch (err) {}

    try {
      if (typeof player.setSubtitlesTrack === 'function') player.setSubtitlesTrack(null);
    } catch (err) {}
  }

  function selectLocalTrack() {
    const player = getPlayer();
    if (!player || !state.track) return;

    const trackForApi = {
      languageCode: TRACK_LANG,
      vssId: TRACK_VSS_ID,
      trackName: msg('trackName'),
      displayName: getTrackDisplayName(),
    };

    try {
      if (typeof player.setOption === 'function') {
        player.setOption('captions', 'captionsInitialState', 'CAPTIONS_INITIAL_STATE_ON');
        player.setOption('captions', 'enabled', true);
        player.setOption('captions', 'track', trackForApi);
        player.setOption('captions', 'track', state.track);
        debugLog('track selected', state.track);
      }
    } catch (err) {}

    try {
      if (typeof player.setSubtitlesTrack === 'function') player.setSubtitlesTrack(state.track);
    } catch (err) {}

  }

  function forceCaptionButtonOn() {
    const button = document.querySelector('.ytp-subtitles-button');
    if (button && button.getAttribute('aria-pressed') !== 'true') button.click();
  }

  function pokeVideoClock() {
    const video = document.querySelector('video.html5-main-video');
    if (!video) return;

    try { video.dispatchEvent(new Event('timeupdate')); } catch (err) {}

    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.seeking) return;

    try {
      const nextTime = Math.min(video.duration - 0.05, video.currentTime + 0.001);
      if (nextTime > 0 && Math.abs(nextTime - video.currentTime) > 0.0001) {
        video.currentTime = nextTime;
      }
    } catch (err) {}
  }

  function getPlayer() {
    return document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
  }

  function debugLog() {
    console.log(msg('debugPrefix'), ...arguments);
  }

  function setupSettingsObserver() {
    const player = getPlayer();
    if (!player) return;
    const settingsMenu = player.querySelector('.ytp-settings-menu');
    if (!settingsMenu || settingsMenu._tmLocalNativeCcObserverAttached) return;

    const observer = new MutationObserver(() => injectUploadMenuItem(settingsMenu));
    observer.observe(settingsMenu, { childList: true, subtree: true });
    settingsMenu._tmLocalNativeCcObserverAttached = true;
    injectUploadMenuItem(settingsMenu);
  }

  function injectUploadMenuItem(settingsMenu) {
    const rootMenu = Array.from(settingsMenu.querySelectorAll('.ytp-panel-menu')).find((menu) => {
      const panel = menu.closest('.ytp-panel');
      return panel && !panel.querySelector('.ytp-panel-header');
    });
    if (!rootMenu || rootMenu.querySelector(`.${MENU_CLASS}`)) return;

    const item = document.createElement('div');
    item.className = `ytp-menuitem ${MENU_CLASS}`;

    const label = document.createElement('div');
    label.className = 'ytp-menuitem-label';
    label.textContent = msg('uploadLabel');

    const content = document.createElement('div');
    content.className = 'ytp-menuitem-content';
    content.textContent = getMenuStatusText();

    item.appendChild(label);
    item.appendChild(content);
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      ensureFileInput();
      state.fileInput && state.fileInput.click();
    });

    rootMenu.appendChild(item);
  }

  function updateMenuStatus() {
    document.querySelectorAll(`.${MENU_CLASS} .ytp-menuitem-label`).forEach((el) => {
      el.textContent = msg('uploadLabel');
    });

    document.querySelectorAll(`.${MENU_CLASS} .ytp-menuitem-content`).forEach((el) => {
      el.textContent = getMenuStatusText();
    });
  }

  function getMenuStatusText() {
    if (!state.cues.length) return msg('notLoaded');
    return `${state.cues.length} ${msg('countSuffix')}`;
  }

  function parseSrt(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const entries = [];
    let i = 0;

    while (i < lines.length) {
      let line = lines[i].trim();
      if (!line) {
        i += 1;
        continue;
      }

      if (/^\d+$/.test(line)) {
        i += 1;
        line = (lines[i] || '').trim();
      }

      const timeMatch = line.match(/(.+?)\s*-->\s*(.+)/);
      if (!timeMatch) {
        i += 1;
        continue;
      }

      const start = parseTime(timeMatch[1]);
      const end = parseTime(timeMatch[2]);
      i += 1;

      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(cleanCueText(lines[i]));
        i += 1;
      }

      if (end > start && textLines.length) entries.push({ start, end, text: textLines.join('\n') });
    }

    return entries;
  }

  function parseVtt(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const entries = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line || /^WEBVTT/i.test(line) || line.startsWith('NOTE')) i += 1;
      else break;
    }

    while (i < lines.length) {
      let line = lines[i].trim();
      if (!line) {
        i += 1;
        continue;
      }

      if (!line.includes('-->')) {
        i += 1;
        line = (lines[i] || '').trim();
      }

      const timeMatch = line.match(/(.+?)\s*-->\s*(.+)/);
      if (!timeMatch) {
        i += 1;
        continue;
      }

      const start = parseTime(timeMatch[1]);
      const end = parseTime(timeMatch[2]);
      i += 1;

      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(cleanCueText(lines[i]));
        i += 1;
      }

      if (end > start && textLines.length) entries.push({ start, end, text: textLines.join('\n') });
    }

    return entries;
  }

  function parseTime(raw) {
    let text = String(raw || '').trim().split(/[ \t]/)[0].replace(',', '.');
    const parts = text.split(':');
    let h = 0;
    let m = 0;
    let s = 0;

    if (parts.length === 3) {
      h = parseInt(parts[0], 10) || 0;
      m = parseInt(parts[1], 10) || 0;
      s = parseFloat(parts[2]) || 0;
    } else if (parts.length === 2) {
      m = parseInt(parts[0], 10) || 0;
      s = parseFloat(parts[1]) || 0;
    } else {
      s = parseFloat(parts[0]) || 0;
    }

    return h * 3600 + m * 60 + s;
  }

  function cleanCueText(text) {
    return String(text)
      .replace(/<\/?(?:font|b|i|u|c|v|ruby|rt|lang)[^>]*>/gi, '')
      .replace(/\{\\[^}]+}/g, '')
      .trimEnd();
  }

  function toYouTubeJson3(cues) {
    return {
      wireMagic: 'pb3',
      pens: [],
      wsWinStyles: [],
      wpWinPositions: [],
      events: cues.map((cue) => ({
        tStartMs: Math.max(0, Math.round(cue.start * 1000)),
        dDurationMs: Math.max(1, Math.round((cue.end - cue.start) * 1000)),
        segs: textToJson3Segs(cue.text),
      })),
    };
  }

  function toYouTubeTranscriptXml(cues) {
    return '<transcript>' + cues.map((cue) => {
      const start = formatXmlNumber(cue.start);
      const dur = formatXmlNumber(Math.max(0.001, cue.end - cue.start));
      return `<text start="${start}" dur="${dur}">${escapeXml(cue.text)}</text>`;
    }).join('') + '</transcript>';
  }

  function formatXmlNumber(value) {
    return Number(value || 0).toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  function escapeXml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '&#10;');
  }

  function textToJson3Segs(text) {
    const lines = String(text || '').split('\n');
    const segs = [];
    lines.forEach((line, index) => {
      if (index > 0) segs.push({ utf8: '\n' });
      segs.push({ utf8: line });
    });
    return segs.length ? segs : [{ utf8: '' }];
  }

  function toWebVtt(cues) {
    return 'WEBVTT\n\n' + cues.map((cue, index) => {
      return `${index + 1}\n${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${cue.text}`;
    }).join('\n\n') + '\n';
  }

  function formatVttTime(seconds) {
    const safe = Math.max(0, seconds || 0);
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = Math.floor(safe % 60);
    const ms = Math.round((safe - Math.floor(safe)) * 1000);
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${String(ms).padStart(3, '0')}`;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  patchLocalTimedtextXhr();
  patchLocalTimedtextFetch();
  patchInitialPlayerResponseSetter();
  injectKnownPlayerResponses();
  setupAdBypass();

  onReady(init);
  window.addEventListener('yt-navigate-start', () => {
    state.cues = [];
    state.filename = '';
    state.track = createLocalCaptionTrack();
    updateMenuStatus();
  }, true);
  window.addEventListener('yt-navigate-finish', () => setTimeout(init, 800), true);
  state.initTimer = state.initTimer || setInterval(init, 3000);
})();
