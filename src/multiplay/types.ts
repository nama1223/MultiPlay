export interface MpMarker {
  time: number
  label: string
}

export interface MpTrack {
  id: string
  name: string
  url: string
  offsetMs?: number
  gain?: number
  /** 波形の先行表示用ピーク（480点、0..1）。アップロード時 or 編集保存時に記録 */
  peaks?: number[]
  /** トラック単体の長さ（秒）。先行表示と総時間の早期表示に使う */
  durationSec?: number
}

export interface MpSongManifest {
  id: string
  title: string
  groupId: string
  groupName?: string
  tracks: MpTrack[]
  markers: MpMarker[]
}

export interface MpSongSummary {
  id: string
  title: string
  trackCount?: number
}

export interface MpGroup {
  id: string
  name: string
  songs: MpSongSummary[]
}

export interface MpIndex {
  groups: MpGroup[]
}

/** Worker の /api/admin/storage の返り値（B2 の実データからの集計） */
export interface MpStorageSong {
  id: string
  title: string
  bytes: number
  objects: number
}

export interface MpStorageGroup {
  id: string
  name: string
  bytes: number
  songs: MpStorageSong[]
}

export interface MpStorageReport {
  totalBytes: number
  totalObjects: number
  groups: MpStorageGroup[]
  /** index に載っていない曲フォルダ（丸ごと孤立） */
  orphanSongs: { id: string; bytes: number; objects: number }[]
  /** 曲は在るが manifest から参照されていないファイル */
  orphanFiles: { key: string; bytes: number }[]
  otherBytes: number
  otherObjects: number
}
