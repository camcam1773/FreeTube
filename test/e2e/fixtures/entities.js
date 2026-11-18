// Stable, fake YouTube data used by every mocked response.
// Keep IDs/titles fixed so assertions never depend on live YouTube.

export const CHANNEL = {
  id: 'UCe2echannel0000000000001',
  name: 'E2E Test Channel',
  subscribers: '12,345 subscribers',
  avatar: 'https://i.ytimg.com/vi/e2e-channel/avatar.jpg',
}

export const VIDEO_ONE = {
  id: 'e2e-video-000001',
  title: 'First E2E Video',
  author: CHANNEL.name,
  channelId: CHANNEL.id,
  durationSeconds: 600,
  durationText: '10:00',
  views: 1234,
  viewsText: '1,234 views',
  publishedText: '2 days ago',
  description: 'A deterministic video used by the end-to-end tests.',
}

export const VIDEO_TWO = {
  id: 'e2e-video-000002',
  title: 'Second E2E Video',
  author: CHANNEL.name,
  channelId: CHANNEL.id,
  durationSeconds: 125,
  durationText: '2:05',
  views: 56,
  viewsText: '56 views',
  publishedText: '1 week ago',
  description: 'Another deterministic video used by the end-to-end tests.',
}

export const VIDEOS = [VIDEO_ONE, VIDEO_TWO]

export const USER_PLAYLIST = {
  _id: 'e2e-user-playlist',
  name: 'E2E Playlist',
  videos: [],
}
