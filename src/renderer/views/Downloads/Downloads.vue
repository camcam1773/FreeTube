<template>
  <div>
    <FtCard class="card">
      <FtFlexBox class="header-row">
        <h2>
          <FontAwesomeIcon
            :icon="['fas', 'download']"
            class="headingIcon"
          />
          {{ t('Settings.Download Settings.Download Settings') }}
          <span
            v-if="queue.length > 0"
            class="badge"
          >
            {{ activeCount }} / {{ queue.length }}
          </span>
        </h2>

        <FtFlexBox class="header-actions">
          <FtButton
            v-if="hasCompletedOrFailed"
            :label="t('Settings.Download Settings.Clear Completed')"
            background-color="var(--bg-color-3)"
            text-color="var(--main-text-color)"
            :icon="['fas', 'check']"
            class="action-btn"
            @click="clearCompleted"
          />
          <FtButton
            v-if="queue.length > 0"
            :label="t('Settings.Download Settings.Clear All')"
            background-color="var(--bg-color-3)"
            text-color="var(--main-text-color)"
            :icon="['fas', 'trash']"
            class="action-btn"
            @click="clearAll"
          />
        </FtFlexBox>
      </FtFlexBox>

      <div
        v-if="queue.length === 0"
        class="empty-state"
      >
        <div class="empty-icon-container">
          <FontAwesomeIcon
            :icon="['fas', 'download']"
            class="empty-icon"
          />
        </div>
        <p class="empty-text">
          {{ t('Settings.Download Settings.Empty Queue') }}
        </p>
        <p class="empty-subtext">
          {{ t('Settings.Download Settings.Empty Queue Subtext') }}
        </p>
      </div>

      <div
        v-else
        class="queue-list"
      >
        <div
          v-for="item in queue"
          :key="item.videoUrl"
          class="download-card"
          :class="item.status"
        >
          <div class="card-left">
            <div
              class="status-icon-wrapper"
              :class="item.status"
            >
              <FontAwesomeIcon
                v-if="item.status === 'pending'"
                :icon="['fas', 'clock']"
                class="status-icon"
              />
              <FontAwesomeIcon
                v-else-if="item.status === 'downloading'"
                :icon="['fas', 'bars-progress']"
                class="status-icon spin-anim"
              />
              <FontAwesomeIcon
                v-else-if="item.status === 'completed'"
                :icon="['fas', 'circle-check']"
                class="status-icon"
              />
              <FontAwesomeIcon
                v-else-if="item.status === 'error'"
                :icon="['fas', 'circle-exclamation']"
                class="status-icon"
              />
            </div>
          </div>

          <div class="card-center">
            <div class="item-title-row">
              <router-link
                :to="`/watch/${item.videoId}`"
                class="item-title"
                :title="item.title"
              >
                {{ item.title }}
              </router-link>
              <span class="format-badge">
                {{ item.audioOnly ? t('Settings.Download Settings.Audio Only') : t('Settings.Download Settings.Video') }}
                {{ t('Settings.Download Settings.DotSeparator') }}
                {{ item.quality === 'best' ? t('Settings.Download Settings.Best Quality') : item.quality }}
              </span>
            </div>

            <!-- Progress Info -->
            <div class="progress-section">
              <div class="progress-bar-track">
                <div
                  class="progress-bar-fill"
                  :style="{ width: item.percent + '%' }"
                  :class="item.status"
                />
              </div>

              <FtFlexBox class="progress-details">
                <div class="progress-left">
                  <span
                    class="status-label"
                    :class="item.status"
                  >
                    <template v-if="item.status === 'pending'">{{ t('Settings.Download Settings.Pending') }}</template>
                    <template v-if="item.status === 'downloading'">{{ t('Settings.Download Settings.Downloading Status') }}</template>
                    <template v-if="item.status === 'completed'">{{ t('Settings.Download Settings.Completed') }}</template>
                    <template v-if="item.status === 'error'">{{ t('Settings.Download Settings.Failed') }}</template>
                  </span>
                  <span
                    v-if="item.status === 'downloading'"
                    class="stats-divider"
                  >{{ t('Settings.Download Settings.DotSeparator') }}</span>
                  <span
                    v-if="item.status === 'downloading'"
                    class="download-speed"
                  >{{ item.speed }}</span>
                  <span
                    v-if="item.status === 'downloading'"
                    class="stats-divider"
                  >{{ t('Settings.Download Settings.DotSeparator') }}</span>
                  <span
                    v-if="item.status === 'downloading'"
                    class="download-eta"
                  >{{ `${t('Settings.Download Settings.ETA')}: ${item.eta}` }}</span>
                </div>
                <span class="progress-percent">{{ `${item.percent}%` }}</span>
              </FtFlexBox>
            </div>

            <!-- Error message if failed -->
            <div
              v-if="item.status === 'error'"
              class="error-msg"
              :title="item.errorMsg"
            >
              {{ item.errorMsg }}
            </div>

            <div class="destination-path">
              {{ `${t('Settings.Download Settings.Saved To')}: ${item.downloadDir || t('Settings.Download Settings.Default System Downloads')}` }}
            </div>

            <div class="command-section">
              <button
                class="toggle-command-btn"
                @click="toggleCommand(item.videoUrl)"
              >
                <FontAwesomeIcon
                  :icon="['fas', isCommandVisible(item.videoUrl) ? 'angle-up' : 'angle-down']"
                  class="btn-icon"
                />
                {{ isCommandVisible(item.videoUrl) ? t('Settings.Download Settings.Hide Command') : t('Settings.Download Settings.Show Command') }}
              </button>
              <div
                v-if="isCommandVisible(item.videoUrl)"
                class="command-box-wrapper"
              >
                <code class="command-box">{{ getCommandLine(item) }}</code>
                <button
                  class="copy-command-btn"
                  :title="t('Settings.Download Settings.Copy Command')"
                  @click="copyCommandText(item)"
                >
                  <FontAwesomeIcon :icon="['fas', 'copy']" />
                  {{ t('Settings.Download Settings.Copy Command') }}
                </button>
              </div>
            </div>
          </div>

          <div class="card-right">
            <FtButton
              v-if="item.status === 'error'"
              :label="''"
              :icon="['fas', 'sync']"
              background-color="var(--bg-color-3)"
              text-color="var(--main-text-color)"
              class="icon-action-btn"
              :title="t('Settings.Download Settings.Retry Download')"
              @click="retryDownload(item.videoUrl)"
            />
            <FtButton
              :label="''"
              :icon="['fas', 'times']"
              background-color="var(--bg-color-3)"
              text-color="var(--main-text-color)"
              class="icon-action-btn delete-btn"
              :title="item.status === 'downloading' ? t('Settings.Download Settings.Cancel Download') : t('Settings.Download Settings.Remove From List')"
              @click="cancelOrRemove(item)"
            />
          </div>
        </div>
      </div>
    </FtCard>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { copyToClipboard } from '../../helpers/utils'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { useI18n } from 'vue-i18n'
import store from '../../store'

import FtCard from '../../components/ft-card/ft-card.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'

const { t } = useI18n()

const queue = computed(() => store.getters.downloadsQueue)

const activeCount = computed(() => {
  return queue.value.filter(d => d.status === 'downloading' || d.status === 'pending').length
})

const hasCompletedOrFailed = computed(() => {
  return queue.value.some(d => d.status === 'completed' || d.status === 'error')
})

function cancelOrRemove(item) {
  if (item.status === 'downloading') {
    store.dispatch('cancelDownload', item.videoUrl)
  } else {
    store.dispatch('removeDownload', item.videoUrl)
  }
}

function retryDownload(videoUrl) {
  store.dispatch('retryDownload', videoUrl)
}

function clearCompleted() {
  store.dispatch('clearCompleted')
}

function clearAll() {
  store.dispatch('clearAll')
}

const visibleCommands = ref(new Set())

function toggleCommand(videoUrl) {
  if (visibleCommands.value.has(videoUrl)) {
    visibleCommands.value.delete(videoUrl)
  } else {
    visibleCommands.value.add(videoUrl)
  }
}

function isCommandVisible(videoUrl) {
  return visibleCommands.value.has(videoUrl)
}

function quote(str) {
  if (!str) return '""'
  return `"${str.replaceAll('"', '\\"')}"`
}

function getCommandLine(item) {
  const exe = item.ytdlpPath && item.ytdlpPath.trim() !== '' ? quote(item.ytdlpPath.trim()) : 'yt-dlp'
  const parts = [
    exe,
    '--ignore-config',
    '--newline',
    '--progress',
    quote(item.videoUrl)
  ]

  if (item.audioOnly) {
    parts.push('-f', 'bestaudio/best')
    if (item.quality === 'mp3') {
      parts.push('-x', '--audio-format', 'mp3')
    }
  } else {
    let formatStr = 'bestvideo+bestaudio/best'
    if (item.quality === '2160p') {
      formatStr = 'bestvideo[height<=2160]+bestaudio/best'
    } else if (item.quality === '1440p') {
      formatStr = 'bestvideo[height<=1440]+bestaudio/best'
    } else if (item.quality === '1080p') {
      formatStr = 'bestvideo[height<=1080]+bestaudio/best'
    } else if (item.quality === '720p') {
      formatStr = 'bestvideo[height<=720]+bestaudio/best'
    } else if (item.quality === '480p') {
      formatStr = 'bestvideo[height<=480]+bestaudio/best'
    } else if (item.quality === '360p') {
      formatStr = 'bestvideo[height<=360]+bestaudio/best'
    }
    parts.push('-f', quote(formatStr), '--merge-output-format', 'mp4')
  }

  const targetDir = item.downloadDir && item.downloadDir.trim() !== '' ? item.downloadDir.trim() : '<Downloads>'
  parts.push('-o', quote(`${targetDir}/%(title)s.%(ext)s`))

  if (item.sponsorBlockRemove) {
    parts.push('--sponsorblock-remove', quote(item.sponsorBlockRemove))
  }
  if (item.sponsorBlockApi) {
    parts.push('--sponsorblock-api', quote(item.sponsorBlockApi))
  }

  return parts.join(' ')
}

function copyCommandText(item) {
  const cmd = getCommandLine(item)
  copyToClipboard(cmd, {
    messageOnSuccess: t('Settings.Download Settings.Command Copied')
  })
}
</script>

<style scoped>
.card {
  inline-size: 85%;
  margin-block: 0 60px;
  margin-inline: auto;
  padding: 1.5rem;
}

.header-row {
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 1rem;
}

.headingIcon {
  color: var(--primary-color);
  margin-right: 0.5rem;
}

.badge {
  font-size: 0.9rem;
  background-color: var(--bg-color-3);
  color: var(--secondary-text-color);
  padding: 0.2rem 0.6rem;
  border-radius: 12px;
  margin-left: 0.8rem;
  font-weight: normal;
  vertical-align: middle;
}

.header-actions {
  gap: 0.8rem;
}

.action-btn {
  font-size: 0.85rem;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: bold;
}
.action-btn:hover {
  background-color: var(--bg-color-4) !important;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  text-align: center;
}

.empty-icon-container {
  font-size: 4rem;
  color: var(--tertiary-text-color);
  margin-bottom: 1.5rem;
  background-color: var(--bg-color-2);
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px dashed var(--border-color);
}

.empty-text {
  font-size: 1.25rem;
  font-weight: bold;
  color: var(--main-text-color);
  margin-bottom: 0.5rem;
}

.empty-subtext {
  font-size: 0.95rem;
  color: var(--secondary-text-color);
}

/* Queue List & Cards */
.queue-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.download-card {
  display: flex;
  background-color: var(--bg-color-2);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1rem;
  align-items: center;
  transition: transform 0.2s, box-shadow 0.2s;
}

.download-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.card-left {
  margin-right: 1.2rem;
}

.status-icon-wrapper {
  font-size: 1.8rem;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.status-icon-wrapper.pending {
  color: var(--secondary-text-color);
  background-color: var(--bg-color-3);
}

.status-icon-wrapper.downloading {
  color: var(--accent-color);
  background-color: rgba(58, 134, 200, 0.15);
}

.status-icon-wrapper.completed {
  color: #2ec4b6;
  background-color: rgba(46, 196, 182, 0.15);
}

.status-icon-wrapper.error {
  color: #e71d36;
  background-color: rgba(231, 29, 54, 0.15);
}

.spin-anim {
  animation: pulse 1.5s infinite ease-in-out;
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(1); opacity: 0.8; }
}

.card-center {
  flex-grow: 1;
  min-width: 0;
  overflow: hidden;
  margin-right: 1.2rem;
}

.item-title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.item-title {
  font-size: 1.05rem;
  font-weight: bold;
  color: var(--main-text-color);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-grow: 1;
}

.item-title:hover {
  text-decoration: underline;
  color: var(--accent-color);
}

.format-badge {
  font-size: 0.8rem;
  color: var(--secondary-text-color);
  background-color: var(--bg-color-3);
  padding: 0.1rem 0.5rem;
  border-radius: 4px;
  white-space: nowrap;
}

.progress-section {
  margin-bottom: 0.5rem;
}

.progress-bar-track {
  height: 6px;
  background-color: var(--bg-color-3);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 0.3rem;
}

.progress-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-bar-fill.downloading {
  background-color: var(--accent-color);
}

.progress-bar-fill.completed {
  background-color: #2ec4b6;
}

.progress-bar-fill.error {
  background-color: #e71d36;
}

.progress-bar-fill.pending {
  background-color: var(--secondary-text-color);
}

.progress-details {
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--secondary-text-color);
}

.progress-left {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.status-label {
  font-weight: bold;
}
.status-label.downloading { color: var(--accent-color); }
.status-label.completed { color: #2ec4b6; }
.status-label.error { color: #e71d36; }
.status-label.pending { color: var(--secondary-text-color); }

.stats-divider {
  color: var(--tertiary-text-color);
}

.error-msg {
  font-size: 0.85rem;
  color: #e71d36;
  background-color: rgba(231, 29, 54, 0.05);
  border: 1px solid rgba(231, 29, 54, 0.2);
  padding: 0.4rem 0.6rem;
  border-radius: 4px;
  font-family: monospace;
  margin-bottom: 0.5rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.destination-path {
  font-size: 0.8rem;
  color: var(--tertiary-text-color);
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-right {
  display: flex;
  gap: 0.5rem;
}

.icon-action-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
}
.icon-action-btn:hover {
  background-color: var(--bg-color-4) !important;
}

.delete-btn:hover {
  color: #e71d36 !important;
}

@media only screen and (width <= 680px) {
  .card {
    inline-size: 95%;
    padding: 1rem;
  }
  .item-title-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
  }
}

.command-section {
  margin-top: 0.5rem;
  min-width: 0;
  max-width: 100%;
}

.toggle-command-btn {
  background: none;
  border: none;
  color: var(--secondary-text-color);
  font-size: 0.8rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0;
  transition: color 0.2s ease;
}

.toggle-command-btn:hover {
  color: var(--accent-color);
}

.btn-icon {
  font-size: 0.7rem;
}

.command-box-wrapper {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  margin-top: 0.4rem;
  background-color: var(--bg-color-3);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
  align-items: stretch;
  max-width: 100%;
}

.command-box {
  display: block;
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--main-text-color);
  padding: 0.5rem 0.8rem;
  overflow-x: auto;
  white-space: nowrap;
  background-color: transparent;
  user-select: all;
  align-self: center;
}

.copy-command-btn {
  background-color: var(--bg-color-4);
  border: none;
  border-left: 1px solid var(--border-color);
  color: var(--main-text-color);
  padding: 0 0.8rem;
  font-size: 0.8rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  transition: background-color 0.2s ease, color 0.2s ease;
  white-space: nowrap;
}

.copy-command-btn:hover {
  background-color: var(--primary-color);
  color: var(--main-color-text);
}
</style>
