<template>
  <FtPrompt
    :label="t('Settings.Download Settings.Download Video/Audio')"
    @click="closePrompt"
  >
    <div class="downloader-container">
      <template v-if="state === 'form'">
        <p class="video-title"><strong>{{ title }}</strong></p>

        <!-- Format Type Selection -->
        <FtFlexBox class="form-row">
          <p class="row-label">{{ t('Settings.Download Settings.Download Type') }}</p>
          <div class="toggle-group">
            <button
              :class="['toggle-btn', { active: !audioOnly }]"
              @click="audioOnly = false"
            >
              {{ t('Settings.Download Settings.Video') }}
            </button>
            <button
              :class="['toggle-btn', { active: audioOnly }]"
              @click="audioOnly = true"
            >
              {{ t('Settings.Download Settings.Audio Only') }}
            </button>
          </div>
        </FtFlexBox>

        <!-- Quality Selector -->
        <FtFlexBox class="form-row">
          <p class="row-label">{{ t('Settings.Download Settings.Quality') }}</p>
          <select v-model="selectedQuality" class="quality-select">
            <template v-if="!audioOnly">
              <option value="best">{{ t('Settings.Download Settings.Best Quality') }}</option>
              <option value="2160p">2160p (4K)</option>
              <option value="1440p">1440p (2K)</option>
              <option value="1080p">1080p</option>
              <option value="720p">720p</option>
              <option value="480p">480p</option>
              <option value="360p">360p</option>
            </template>
            <template v-else>
              <option value="best">{{ t('Settings.Download Settings.Best Quality') }} (M4A/WebM)</option>
              <option value="mp3">MP3</option>
            </template>
          </select>
        </FtFlexBox>

        <!-- Destination Directory selection -->
        <FtFlexBox class="form-row folder-row">
          <p class="row-label">{{ t('Settings.Download Settings.Save Folder') }}</p>
          <span class="folder-path" :title="downloadFolderPath">{{ displayFolder }}</span>
          <button class="change-folder-btn" @click="changeFolder">
            {{ t('Settings.Download Settings.Browse Folder Button') }}
          </button>
        </FtFlexBox>

        <FtFlexBox class="action-row">
          <FtButton
            :label="t('Settings.Download Settings.Start Download')"
            @click="startDownload"
          />
          <FtButton
            :label="t('Settings.Download Settings.Cancel')"
            theme="secondary"
            @click="closePrompt"
          />
        </FtFlexBox>
      </template>

      <!-- Downloading State -->
      <template v-else-if="state === 'downloading'">
        <p class="video-title"><strong>{{ title }}</strong></p>
        <p class="download-status">{{ t('Settings.Download Settings.Downloading') }}</p>
        
        <div class="progress-bar-container">
          <div class="progress-bar-fill" :style="{ width: percent + '%' }"></div>
        </div>

        <FtFlexBox class="progress-stats">
          <span>{{ percent }}%</span>
          <span v-if="speed">{{ speed }}</span>
          <span v-if="eta">{{ t('Settings.Download Settings.ETA') }}: {{ eta }}</span>
        </FtFlexBox>
      </template>

      <!-- Success State -->
      <template v-else-if="state === 'success'">
        <div class="status-icon success-icon">
          <FontAwesomeIcon :icon="['fas', 'circle-check']" />
        </div>
        <p class="download-status success-text">{{ t('Settings.Download Settings.Download Complete') }}</p>
        <p class="file-destination">{{ t('Settings.Download Settings.Saved To') }}: {{ downloadFolderPath || t('Settings.Download Settings.Download Settings') }}</p>
        
        <FtFlexBox class="action-row center-row">
          <FtButton
            :label="t('Close')"
            @click="closePrompt"
          />
        </FtFlexBox>
      </template>

      <!-- Error State -->
      <template v-else-if="state === 'error'">
        <div class="status-icon error-icon">
          <FontAwesomeIcon :icon="['fas', 'circle-exclamation']" />
        </div>
        <p class="download-status error-text">{{ t('Settings.Download Settings.Download Failed') }}</p>
        <div class="error-details">
          {{ errorMsg }}
        </div>
        
        <FtFlexBox class="action-row center-row">
          <FtButton
            :label="t('Settings.Download Settings.Retry')"
            @click="state = 'form'"
          />
          <FtButton
            :label="t('Close')"
            theme="secondary"
            @click="closePrompt"
          />
        </FtFlexBox>
      </template>
    </div>
  </FtPrompt>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { useI18n } from '../../composables/use-i18n-polyfill'
import store from '../../store/index'

import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'

const { t } = useI18n()

// Retrieve state from store
const videoObject = computed(() => store.getters.getDownloadPromptVideoObject)
const title = computed(() => videoObject.value?.title || '')
const videoId = computed(() => videoObject.value?.videoId || '')

const customDownloadFolderPath = computed(() => store.getters.getDownloadFolderPath)
const ytdlpPath = computed(() => store.getters.getYtdlpPath)

const downloadFolderPath = ref(customDownloadFolderPath.value)

const displayFolder = computed(() => {
  return downloadFolderPath.value || t('Settings.Download Settings.Default System Downloads')
})

// UI state
const audioOnly = ref(false)
const selectedQuality = ref('best')
const state = ref('form') // form, downloading, success, error

// Download stats
const percent = ref('0')
const speed = ref('')
const eta = ref('')
const errorMsg = ref('')

const videoUrl = computed(() => `https://www.youtube.com/watch?v=${videoId.value}`)

async function changeFolder() {
  if (process.env.IS_ELECTRON) {
    const selected = await window.ftElectron.chooseDirectory(downloadFolderPath.value)
    if (selected) {
      downloadFolderPath.value = selected
    }
  }
}

function startDownload() {
  const downloadObj = {
    videoId: videoId.value,
    title: title.value,
    videoUrl: videoUrl.value,
    quality: selectedQuality.value,
    audioOnly: audioOnly.value,
    downloadDir: downloadFolderPath.value,
    ytdlpPath: ytdlpPath.value,
    status: 'pending',
    percent: '0',
    speed: '',
    eta: '',
    errorMsg: ''
  }

  store.dispatch('addDownload', downloadObj)
  closePrompt()
}

function closePrompt() {
  store.dispatch('hideDownloadPrompt')
}
</script>

<style scoped>
.downloader-container {
  min-width: 420px;
  max-width: 500px;
  padding: 0.5rem 1rem;
}
.video-title {
  font-size: 1.1rem;
  margin-bottom: 1.5rem;
  word-break: break-word;
  color: var(--main-text-color);
}
.form-row {
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.2rem;
}
.row-label {
  font-weight: bold;
  font-size: 0.95rem;
  color: var(--secondary-text-color);
  margin-right: 1.5rem;
}
.toggle-group {
  display: flex;
  background-color: var(--bg-color-2);
  border-radius: 6px;
  padding: 3px;
}
.toggle-btn {
  border: none;
  background: none;
  padding: 0.4rem 1.2rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  color: var(--secondary-text-color);
  transition: all 0.2s ease;
}
.toggle-btn.active {
  background-color: var(--main-color);
  color: var(--main-color-text);
}
.quality-select {
  padding: 0.4rem 1rem;
  border-radius: 6px;
  background-color: var(--bg-color-2);
  color: var(--main-text-color);
  border: 1px solid var(--border-color);
  font-size: 0.95rem;
  outline: none;
}
.folder-row {
  background-color: var(--bg-color-2);
  padding: 0.6rem 0.8rem;
  border-radius: 6px;
  border: 1px solid var(--border-color);
}
.folder-path {
  flex-grow: 1;
  font-family: monospace;
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 0.8rem;
  color: var(--secondary-text-color);
}
.change-folder-btn {
  border: none;
  background-color: var(--bg-color-3);
  color: var(--main-text-color);
  padding: 0.3rem 0.6rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: bold;
}
.change-folder-btn:hover {
  background-color: var(--bg-color-4);
}
.action-row {
  margin-top: 1.8rem;
  justify-content: flex-end;
  gap: 0.8rem;
}
.center-row {
  justify-content: center;
}

/* Downloading & Progress Styles */
.download-status {
  font-size: 1.2rem;
  font-weight: bold;
  margin-bottom: 1rem;
  text-align: center;
  color: var(--main-color);
}
.progress-bar-container {
  height: 8px;
  background-color: var(--bg-color-3);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.8rem;
}
.progress-bar-fill {
  height: 100%;
  background-color: var(--main-color);
  border-radius: 4px;
  transition: width 0.2s ease-out;
}
.progress-stats {
  justify-content: space-between;
  font-size: 0.9rem;
  color: var(--secondary-text-color);
}

/* Status Icons */
.status-icon {
  font-size: 3.5rem;
  text-align: center;
  margin: 1.5rem 0 1rem;
}
.success-icon {
  color: #2ec4b6;
}
.error-icon {
  color: #e71d36;
}
.success-text {
  color: #2ec4b6;
}
.error-text {
  color: #e71d36;
}
.file-destination {
  font-size: 0.9rem;
  color: var(--secondary-text-color);
  text-align: center;
  margin-bottom: 1.5rem;
}
.error-details {
  background-color: var(--bg-color-2);
  color: var(--secondary-text-color);
  border: 1px solid var(--border-color);
  padding: 0.8rem;
  border-radius: 6px;
  font-family: monospace;
  font-size: 0.85rem;
  max-height: 150px;
  overflow-y: auto;
  margin-bottom: 1.5rem;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
