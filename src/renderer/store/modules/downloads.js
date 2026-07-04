const state = {
  queue: []
}

const getters = {
  downloadsQueue: (state) => state.queue,
  activeDownload: (state) => state.queue.find((d) => d.status === 'downloading'),
  nextPendingDownload: (state) => state.queue.find((d) => d.status === 'pending')
}

const mutations = {
  ADD_DOWNLOAD(state, download) {
    state.queue.push(download)
  },
  UPDATE_DOWNLOAD(state, { videoUrl, updates }) {
    const idx = state.queue.findIndex((d) => d.videoUrl === videoUrl)
    if (idx !== -1) {
      state.queue.splice(idx, 1, { ...state.queue[idx], ...updates })
    }
  },
  REMOVE_DOWNLOAD(state, videoUrl) {
    state.queue = state.queue.filter((d) => d.videoUrl !== videoUrl)
  },
  CLEAR_ALL(state) {
    state.queue = []
  }
}

const actions = {
  addDownload({ commit, dispatch }, download) {
    commit('ADD_DOWNLOAD', download)
    dispatch('processQueue')
  },
  cancelDownload({ commit, dispatch, state }, videoUrl) {
    const item = state.queue.find((d) => d.videoUrl === videoUrl)
    if (item) {
      if (item.status === 'downloading') {
        if (process.env.IS_ELECTRON) {
          window.ftElectron.cancelDownload(videoUrl)
        }
      }
      commit('REMOVE_DOWNLOAD', videoUrl)
      dispatch('processQueue')
    }
  },
  removeDownload({ commit, dispatch }, videoUrl) {
    commit('REMOVE_DOWNLOAD', videoUrl)
    dispatch('processQueue')
  },
  clearAll({ commit, state }) {
    state.queue.forEach((d) => {
      if (d.status === 'downloading') {
        if (process.env.IS_ELECTRON) {
          window.ftElectron.cancelDownload(d.videoUrl)
        }
      }
    })
    commit('CLEAR_ALL')
  },
  clearCompleted({ commit, state }) {
    const toRemove = state.queue.filter((d) => d.status === 'completed' || d.status === 'error')
    toRemove.forEach((d) => {
      commit('REMOVE_DOWNLOAD', d.videoUrl)
    })
  },
  retryDownload({ commit, dispatch }, videoUrl) {
    commit('UPDATE_DOWNLOAD', {
      videoUrl,
      updates: {
        status: 'pending',
        percent: '0',
        speed: '',
        eta: '',
        errorMsg: ''
      }
    })
    dispatch('processQueue')
  },
  processQueue({ dispatch, getters }) {
    const active = getters.activeDownload
    if (active) {
      return
    }
    const next = getters.nextPendingDownload
    if (next) {
      dispatch('startDownloadItem', next.videoUrl)
    }
  },
  startDownloadItem({ commit, state }, videoUrl) {
    const item = state.queue.find((d) => d.videoUrl === videoUrl)
    if (!item) return

    commit('UPDATE_DOWNLOAD', {
      videoUrl,
      updates: { status: 'downloading' }
    })

    if (process.env.IS_ELECTRON) {
      window.ftElectron.startDownload({
        videoUrl: item.videoUrl,
        quality: item.quality,
        audioOnly: item.audioOnly,
        downloadDir: item.downloadDir,
        ytdlpPath: item.ytdlpPath
      })
    }
  }
}

export default {
  state,
  getters,
  mutations,
  actions
}
