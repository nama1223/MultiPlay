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
