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

        <!-- File Size Display -->
        <FtFlexBox class="form-row">
          <p class="row-label">{{ t('Settings.Download Settings.File Size') }}</p>
          <span class="file-size-value">
            <template v-if="metadataLoading">
              <span class="loading-spinner-small"></span>
              {{ t('Settings.Download Settings.Calculating') }}
            </template>
            <template v-else-if="metadataError">
              <span class="error-text" :title="metadataError">{{ t('Settings.Download Settings.Unknown Size') }}</span>
            </template>
            <template v-else-if="estimatedSize">
              <strong>{{ estimatedSize }}</strong>
            </template>
            <template v-else>
              {{ t('Settings.Download Settings.Unknown Size') }}
            </template>
          </span>
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

function getActiveSponsorBlockCategories() {
  const categories = []
  if (store.getters.getSponsorBlockSponsor?.skip !== 'doNothing') categories.push('sponsor')
  if (store.getters.getSponsorBlockSelfPromo?.skip !== 'doNothing') categories.push('selfpromo')
  if (store.getters.getSponsorBlockInteraction?.skip !== 'doNothing') categories.push('interaction')
  if (store.getters.getSponsorBlockIntro?.skip !== 'doNothing') categories.push('intro')
  if (store.getters.getSponsorBlockOutro?.skip !== 'doNothing') categories.push('outro')
  if (store.getters.getSponsorBlockRecap?.skip !== 'doNothing') categories.push('preview')
  if (store.getters.getSponsorBlockMusicOffTopic?.skip !== 'doNothing') categories.push('music_offtopic')
  if (store.getters.getSponsorBlockFiller?.skip !== 'doNothing') categories.push('filler')
  return categories.join(',')
}

function startDownload() {
  let sponsorBlockRemove = undefined
  let sponsorBlockApi = undefined

  // Check if SponsorBlock is enabled in FreeTube settings
  if (store.getters.getUseSponsorBlock) {
    sponsorBlockRemove = getActiveSponsorBlockCategories()

    // Only pass custom SponsorBlock API URL if configured
    const configuredApi = store.getters.getSponsorBlockUrl
    if (configuredApi && configuredApi !== 'https://sponsor.ajay.app') {
      sponsorBlockApi = configuredApi
    }
  }

  const downloadObj = {
    videoId: videoId.value,
    title: title.value,
    videoUrl: videoUrl.value,
    quality: selectedQuality.value,
    audioOnly: audioOnly.value,
    downloadDir: downloadFolderPath.value,
    ytdlpPath: ytdlpPath.value,
    sponsorBlockRemove,
    sponsorBlockApi,
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

// Metadata state
const metadata = ref(null)
const metadataLoading = ref(false)
const metadataError = ref('')

async function fetchMetadata() {
  if (!videoUrl.value) return
  metadataLoading.value = true
  metadataError.value = ''
  metadata.value = null
  try {
    const result = await window.ftElectron.getDownloadMetadata({
      videoUrl: videoUrl.value,
      ytdlpPath: ytdlpPath.value
    })
    if (result && result.success) {
      metadata.value = result.metadata
    } else {
      metadataError.value = result?.error || 'Failed to fetch metadata'
    }
  } catch (err) {
    metadataError.value = err.message
  } finally {
    metadataLoading.value = false
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const estimatedSize = computed(() => {
  if (!metadata.value || !metadata.value.formats) {
    return null
  }

  const formats = metadata.value.formats
  let sizeBytes = 0

  if (audioOnly.value) {
    // Audio Only: best or mp3
    const audioFormats = formats.filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
    if (audioFormats.length > 0) {
      audioFormats.sort((a, b) => {
        const sizeA = a.filesize || a.filesize_approx || 0
        const sizeB = b.filesize || b.filesize_approx || 0
        return sizeB - sizeA
      })
      const bestAudio = audioFormats[0]
      sizeBytes = bestAudio.filesize || bestAudio.filesize_approx || 0
    }
  } else {
    // Video + Audio
    let videoStreamSize = 0
    let videoFormats = formats.filter((f) => f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none'))

    if (selectedQuality.value !== 'best') {
      const targetHeight = parseInt(selectedQuality.value)
      if (!isNaN(targetHeight)) {
        videoFormats = videoFormats.filter((f) => f.height <= targetHeight)
      }
    }

    if (videoFormats.length > 0) {
      videoFormats.sort((a, b) => {
        if (a.height !== b.height) {
          return b.height - a.height
        }
        const sizeA = a.filesize || a.filesize_approx || 0
        const sizeB = b.filesize || b.filesize_approx || 0
        return sizeB - sizeA
      })
      const bestVideo = videoFormats[0]
      videoStreamSize = bestVideo.filesize || bestVideo.filesize_approx || 0
    } else {
      const anyVideoFormats = formats.filter((f) => f.vcodec && f.vcodec !== 'none')
      if (anyVideoFormats.length > 0) {
        anyVideoFormats.sort((a, b) => {
          const sizeA = a.filesize || a.filesize_approx || 0
          const sizeB = b.filesize || b.filesize_approx || 0
          return sizeB - sizeA
        })
        videoStreamSize = anyVideoFormats[0].filesize || anyVideoFormats[0].filesize_approx || 0
      }
    }

    let audioStreamSize = 0
    const audioFormats = formats.filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
    if (audioFormats.length > 0) {
      audioFormats.sort((a, b) => {
        const sizeA = a.filesize || a.filesize_approx || 0
        const sizeB = b.filesize || b.filesize_approx || 0
        return sizeB - sizeA
      })
      const bestAudio = audioFormats[0]
      audioStreamSize = bestAudio.filesize || bestAudio.filesize_approx || 0
    }

    sizeBytes = videoStreamSize + audioStreamSize
  }

  if (sizeBytes === 0) return null

  return `~${formatBytes(sizeBytes)}`
})

onMounted(() => {
  fetchMetadata()
})
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

.file-size-value {
  font-size: 0.95rem;
  color: var(--main-text-color);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.loading-spinner-small {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-color);
  border-top-color: var(--main-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
