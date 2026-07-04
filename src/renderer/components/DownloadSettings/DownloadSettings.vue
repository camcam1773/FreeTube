<template>
  <FtSettingsSection
    :title="t('Settings.Download Settings.Download Settings')"
  >
    <FtFlexBox class="screenshotFolderContainer">
      <p class="screenshotFolderLabel">
        {{ t('Settings.Download Settings.Download Folder Label') }}
      </p>
      <FtInput
        class="screenshotFolderPath"
        :placeholder="downloadFolderPlaceholder"
        :show-action-button="false"
        :show-label="false"
        :disabled="true"
      />
      <FtButton
        :label="t('Settings.Download Settings.Browse Folder Button')"
        class="screenshotFolderButton"
        @click="chooseDownloadFolder"
      />
    </FtFlexBox>

    <FtFlexBox class="screenshotFolderContainer">
      <p class="screenshotFolderLabel">
        {{ t('Settings.Download Settings.Ytdlp Path Label') }}
      </p>
      <FtInput
        class="screenshotFolderPath"
        :placeholder="ytdlpPathPlaceholder"
        :show-action-button="false"
        :show-label="false"
        :disabled="true"
      />
      <FtButton
        :label="t('Settings.Download Settings.Browse File Button')"
        class="screenshotFolderButton"
        @click="chooseYtdlpFile"
      />
      <FtButton
        v-if="ytdlpPath !== ''"
        :label="t('Settings.Download Settings.Clear')"
        theme="secondary"
        @click="clearYtdlpFile"
      />
    </FtFlexBox>
    <p class="description">
      {{ t('Settings.Download Settings.Ytdlp Description') }}
    </p>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from '../../composables/use-i18n-polyfill'
import store from '../../store/index'

import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'

const { t } = useI18n()

const downloadFolderPath = computed(() => store.getters.getDownloadFolderPath)
const ytdlpPath = computed(() => store.getters.getYtdlpPath)

const downloadFolderPlaceholder = computed(() => {
  return downloadFolderPath.value || t('Settings.Download Settings.Default System Downloads')
})

const ytdlpPathPlaceholder = computed(() => {
  return ytdlpPath.value || t('Settings.Download Settings.Default System Path')
})

async function chooseDownloadFolder() {
  if (process.env.IS_ELECTRON) {
    const selected = await window.ftElectron.chooseDirectory(downloadFolderPath.value)
    if (selected) {
      store.dispatch('updateDownloadFolderPath', selected)
    }
  }
}

async function chooseYtdlpFile() {
  if (process.env.IS_ELECTRON) {
    const selected = await window.ftElectron.chooseFile(ytdlpPath.value)
    if (selected) {
      store.dispatch('updateYtdlpPath', selected)
    }
  }
}

function clearYtdlpFile() {
  store.dispatch('updateYtdlpPath', '')
}
</script>

<style scoped>
.screenshotFolderContainer {
  align-items: center;
  margin-bottom: 1rem;
}
.screenshotFolderLabel {
  width: 200px;
  font-weight: bold;
}
.screenshotFolderPath {
  flex-grow: 1;
  margin-right: 0.5rem;
}
.screenshotFolderButton {
  margin-right: 0.5rem;
}
.description {
  margin-top: 1rem;
  font-size: 0.9rem;
  color: var(--secondary-text-color);
  line-height: 1.4;
}
</style>
